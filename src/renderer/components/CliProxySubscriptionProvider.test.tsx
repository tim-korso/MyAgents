import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CliProxyStatus } from '../../shared/cliproxy';
import { PRESET_PROVIDERS } from '../../shared/config-types';
import CliProxySubscriptionProvider from './CliProxySubscriptionProvider';

const native = vi.hoisted(() => ({ cancelCliProxy: vi.fn(), connectCliProxy: vi.fn(),
  disconnectCliProxy: vi.fn(), discoverCliProxyModels: vi.fn(), retryCliProxyCleanup: vi.fn() }));
vi.mock('@/config/services/cliproxyService', () => native);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => vi.resetAllMocks());
const provider = PRESET_PROVIDERS.find(p => p.id === 'antigravity-sub')!;
const status = (): CliProxyStatus => ({ policy: { mode: 'internal', usable: true, revision: 1 }, component: {},
  update: { phase: 'idle' }, instances: { active: 'running', candidate: 'stopped' },
  active: { generation: 'active', email: 'active@example.test', status: 'connected' },
  models: [{ model: 'approved-model', modelName: 'Approved', modelSeries: 'approved-model' }], modelsStale: false });

it('reads local models on mount and starts discovery only on explicit refresh', async () => {
  render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), instances: { active: 'stopped', candidate: 'stopped' } }} refresh={vi.fn()} />);
  expect(native.discoverCliProxyModels).not.toHaveBeenCalled();
  expect(native.connectCliProxy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('providers.cliproxy.refreshModels'));
  await waitFor(() => expect(native.discoverCliProxyModels).toHaveBeenCalledWith('active'));
});

it('retries the recorded cleanup without disconnecting the active account', async () => {
  render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), cleanup: { scope: 'retired', failed: true } }} refresh={vi.fn()} />);
  fireEvent.click(screen.getByTitle('providers.cliproxy.moreActions'));
  fireEvent.click(screen.getByRole('button', { name: 'providers.cliproxy.retryCleanup' }));
  await waitFor(() => expect(native.retryCliProxyCleanup).toHaveBeenCalledOnce());
  expect(native.disconnectCliProxy).not.toHaveBeenCalled();
  expect(screen.getByText(/active@example.test/)).toBeTruthy();
});

it('cancels only the displayed candidate while keeping the formal account visible', async () => {
  render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), candidate: {
    generation: 'candidate', attemptId: 'attempt', phase: 'authorizing',
  } }} refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'providers.cliproxy.continueConnection' }));
  fireEvent.click(screen.getByRole('button', { name: 'providers.cliproxy.cancel' }));
  await waitFor(() => expect(native.cancelCliProxy).toHaveBeenCalledWith('attempt'));
  expect(native.disconnectCliProxy).not.toHaveBeenCalled();
  expect(screen.getByText(/active@example.test/)).toBeTruthy();
});

it('shows a retained account instead of disconnected while login resumes', () => {
  render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), active: null, candidate: {
    generation: 'candidate', attemptId: 'attempt', phase: 'stored', email: 'candidate@example.test',
  } }} refresh={vi.fn()} />);
  expect(screen.queryByText('providers.cliproxy.disconnected')).toBeNull();
});

it('keeps background update details and actions out of the account card and menu', () => {
  render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(),
    component: { version: '7.2.158' },
    update: { phase: 'failed', error: { code: 'update_unpublished', message: 'Update not published' } },
  }} refresh={vi.fn()} />);
  expect(screen.queryByText('Update not published')).toBeNull();
  expect(screen.queryByText(/7\.2\.158/)).toBeNull();
  fireEvent.click(screen.getByTitle('providers.cliproxy.moreActions'));
  expect(screen.queryByText('providers.cliproxy.componentDetails')).toBeNull();
  expect(screen.queryByText('providers.cliproxy.checkUpdate')).toBeNull();
  expect(screen.getByRole('button', { name: 'providers.cliproxy.disconnect' })).toBeTruthy();
});

it('keeps the same description and login action while updates run in the background', () => {
  const { rerender } = render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), active: null,
    update: { phase: 'checking' },
  }} refresh={vi.fn()} />);
  expect((screen.getByRole('button', { name: 'providers.login' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('providers.cliproxy.description')).toBeTruthy();
  expect(screen.queryByTitle('providers.cliproxy.moreActions')).toBeNull();
  rerender(<CliProxySubscriptionProvider provider={provider} status={status()} refresh={vi.fn()} />);
  expect(screen.getByText('providers.cliproxy.description')).toBeTruthy();
});

it('keeps a Rust-owned candidate on dismissal and never reopens a completed dialog after disconnect', () => {
  const candidate = { generation: 'candidate', attemptId: 'attempt', phase: 'authorizing' as const };
  const { rerender } = render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), candidate }} refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'providers.cliproxy.continueConnection' }));
  fireEvent.click(screen.getByRole('button', { name: 'providers.cliproxy.close' }));
  expect(native.cancelCliProxy).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'providers.cliproxy.continueConnection' }));
  rerender(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), active: { generation: 'candidate', status: 'connected' } }} refresh={vi.fn()} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.cancelCliProxy).not.toHaveBeenCalled();
  rerender(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), active: null }} refresh={vi.fn()} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'providers.login' })).toBeTruthy();
});

it('keeps confirmed login usable with an empty or failed model catalog and has no model verification action', () => {
  render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), models: [], modelsStale: true,
    active: { generation: 'active', status: 'connected', error: { code: 'catalog_unavailable', message: 'Catalog temporarily unavailable' } },
  }} refresh={vi.fn()} />);
  expect(screen.getByText('providers.cliproxy.connected')).toBeTruthy();
  expect(screen.queryByText('providers.cliproxy.verify')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(native.connectCliProxy).not.toHaveBeenCalled();
});

it('resumes a retained native account through connect without requesting a model test', async () => {
  const current = { ...status(), active: null, candidate: { generation: 'retained', attemptId: 'attempt', phase: 'stored' as const } };
  native.connectCliProxy.mockResolvedValue(current);
  render(<CliProxySubscriptionProvider provider={provider} status={current} refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'providers.cliproxy.continueConnection' }));
  await waitFor(() => expect(native.connectCliProxy).toHaveBeenCalledOnce());
  expect(screen.queryByText('providers.cliproxy.verify')).toBeNull();
});

it('never reports logged in when connection fails before an account is created', async () => {
  native.connectCliProxy.mockRejectedValue({ code: 'storage', message: 'Cannot save account' });
  render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), active: null }} refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'providers.login' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Cannot save account'));
  expect(screen.queryByText('providers.cliproxy.connected')).toBeNull();
});

it('closes the dialog when a retained login completes before connect returns', async () => {
  native.connectCliProxy.mockResolvedValue(status());
  render(<CliProxySubscriptionProvider provider={provider} status={{ ...status(), active: null, candidate: {
    generation: 'retained', attemptId: 'attempt', phase: 'stored',
  } }} refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'providers.cliproxy.continueConnection' }));
  await waitFor(() => expect(native.connectCliProxy).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
