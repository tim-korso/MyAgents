import { StrictMode, useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { i18n } from '@/i18n';
import { DEFAULT_CONFIG, PRESET_PROVIDERS, type Provider } from '@/config/types';
import ModelManagementPanel from './ModelManagementPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/hooks/useCloseLayer', () => ({ useCloseLayer: vi.fn() }));
vi.mock('@/config/configService', () => ({
  atomicModifyConfig: vi.fn(async updater => updater(DEFAULT_CONFIG)),
  rebuildAndPersistAvailableProviders: vi.fn(async () => {}),
}));

const deepseek = PRESET_PROVIDERS.find(p => p.id === 'deepseek')!;
const noop = async () => {};
const result = { data: [{ id: 'discovered-model', display_name: 'Discovered Model' }] };
let requests: Array<{ resolve: (body: unknown) => void; reject: (error: unknown) => void }>;

// Settings listens to Rust logs even while its model overlay is open, and
// passes an inline refresh callback. Keep that exact rerender boundary here.
function LogHost({ provider = deepseek, apiKey = 'test-key' }: {
  provider?: Provider;
  apiKey?: string;
}) {
  const [, setLogs] = useState(0);
  useEffect(() => {
    const appendLog = () => setLogs(count => count + 1);
    window.addEventListener('test:rust-log', appendLog);
    return () => window.removeEventListener('test:rust-log', appendLog);
  }, []);
  return <ModelManagementPanel
    provider={provider}
    apiKey={apiKey}
    config={DEFAULT_CONFIG}
    onClose={noop}
    onSaveCustomModels={noop}
    onSetPrimaryModel={noop}
    onRefresh={async () => { await noop(); }}
  />;
}

describe('model discovery request lifecycle (#582)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
    vi.clearAllMocks();
    requests = [];
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve, reject) => {
      requests.push({ resolve, reject });
    }));
  });

  it('does not turn Fetching/Success logs into more HTTP requests, and publishes the result', async () => {
    render(<LogHost />);
    for (let index = 0; index < 8; index++) {
      act(() => window.dispatchEvent(new Event('test:rust-log')));
    }
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => requests[0].resolve(result));
    act(() => window.dispatchEvent(new Event('test:rust-log')));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Discovered Model')).toBeInTheDocument();
    expect(screen.queryByText('Loading models...')).not.toBeInTheDocument();
  });

  it('keeps failure visible through log rerenders until the user explicitly retries', async () => {
    render(<LogHost />);
    await act(async () => requests[0].reject('Network error: test failure'));
    act(() => window.dispatchEvent(new Event('test:rust-log')));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Network error: test failure')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => requests[1].resolve(result));
    expect(screen.getByText('Discovered Model')).toBeInTheDocument();
  });

  it('keeps a custom-provider result when capability persistence refreshes the Provider projection', async () => {
    const custom: Provider = { ...deepseek, id: 'custom', isBuiltin: false, models: [{
      model: 'active-model', modelName: 'My name', modelSeries: 'custom',
    }] };
    const update = vi.fn<(provider: Provider) => Promise<void>>(noop);
    function CustomHost() {
      const [provider, setCurrent] = useState(custom);
      return <ModelManagementPanel provider={provider} apiKey="test-key" config={DEFAULT_CONFIG}
        onClose={noop} onSaveCustomModels={noop} onSetPrimaryModel={noop}
        onUpdateCustomProvider={async next => { await update(next); setCurrent(next); }}
        onRefresh={async () => {}} />;
    }
    render(<CustomHost />);
    await act(async () => requests[0].resolve({ data: [
      { id: 'active-model', context_length: 131072 }, ...result.data,
    ] }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Discovered Model')).toBeInTheDocument();
    expect(screen.queryByText('Loading models...')).not.toBeInTheDocument();
  });

  it('ignores display/model changes but refetches for a changed connection and rejects old completion', async () => {
    const view = render(<LogHost />);
    view.rerender(<LogHost provider={{ ...deepseek, name: 'Renamed', models: [...deepseek.models] }} />);
    expect(invoke).toHaveBeenCalledTimes(1);
    view.rerender(<LogHost provider={{ ...deepseek, modelListUrl: 'https://other.invalid/models' }} />);
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => requests[0].resolve(result));
    expect(screen.queryByText('Discovered Model')).not.toBeInTheDocument();
    await act(async () => requests[1].resolve({ data: [{ id: 'new-model' }] }));
    expect(screen.getByText('new-model')).toBeInTheDocument();
  });

  it('revokes a pending result when credentials are removed, including metadata writes', async () => {
    const update = vi.fn(noop);
    const custom: Provider = { ...deepseek, isBuiltin: false, models: [{
      model: 'active-model', modelName: 'Active', modelSeries: 'custom',
    }] };
    const panel = (apiKey: string | undefined) => <ModelManagementPanel
      provider={custom} apiKey={apiKey} config={DEFAULT_CONFIG}
      onClose={noop} onSaveCustomModels={noop} onSetPrimaryModel={noop}
      onUpdateCustomProvider={update} onRefresh={noop} />;
    const view = render(panel('test-key'));
    view.rerender(panel(undefined));
    await act(async () => requests[0].resolve({ data: [{ id: 'active-model', context_length: 131072 }] }));
    expect(update).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Configure an API Key first')).toBeInTheDocument();
  });

  it('does not duplicate an in-flight request on StrictMode setup replay', async () => {
    render(<StrictMode><LogHost /></StrictMode>);
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => requests[0].resolve(result));
    expect(screen.getByText('Discovered Model')).toBeInTheDocument();
  });

  it('does not persist a result that arrives after closing the panel', async () => {
    const update = vi.fn(noop);
    const view = render(<ModelManagementPanel
      provider={{ ...deepseek, isBuiltin: false, models: [{ model: 'active', modelName: 'Active', modelSeries: 'custom' }] }}
      apiKey="test-key" config={DEFAULT_CONFIG} onClose={noop}
      onSaveCustomModels={noop} onSetPrimaryModel={noop}
      onUpdateCustomProvider={update} onRefresh={noop} />);
    view.unmount();
    await act(async () => requests[0].resolve({ data: [{ id: 'active', context_length: 131072 }] }));
    expect(update).not.toHaveBeenCalled();
  });

  it('allows explicit refresh after a genuinely empty response', async () => {
    render(<LogHost />);
    await act(async () => requests[0].resolve({ data: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => requests[1].resolve(result));
    expect(screen.getByText('Discovered Model')).toBeInTheDocument();
  });

  it('shows invalid responses as failures instead of an empty successful discovery', async () => {
    render(<LogHost />);
    await act(async () => requests[0].resolve({ error: { message: 'upstream rejected request' } }));
    expect(screen.getByText(/Invalid model list response/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('Loading models...')).not.toBeInTheDocument();
  });

  it('uses the latest managed action without using callback identity to restart discovery', async () => {
    let finish!: (models: Array<{ id: string }>) => void;
    const first = vi.fn(() => new Promise<Array<{ id: string }>>(resolve => { finish = resolve; }));
    const second = vi.fn(async () => [{ id: 'managed-next' }]);
    const panel = (action: typeof first | typeof second) => <ModelManagementPanel
      provider={{ ...deepseek, id: 'xai-sub', type: 'subscription' }} apiKey={undefined}
      config={DEFAULT_CONFIG} onClose={noop} onSaveCustomModels={noop}
      onSetPrimaryModel={noop} onRefresh={async () => {}} discoveryAction={action} />;
    const view = render(panel(first));
    view.rerender(panel(second));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    await act(async () => finish([{ id: 'managed-first' }]));
    expect(screen.getByText('managed-first')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));
    expect(second).toHaveBeenCalledTimes(1);
    expect(screen.getByText('managed-next')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('starts a new discovery for a replacement API key and ignores the old credential result', async () => {
    const view = render(<LogHost />);
    view.rerender(<LogHost apiKey="replacement-key" />);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('cmd_fetch_provider_models', expect.objectContaining({
      authHeaderValue: 'Bearer replacement-key',
    }));
    await act(async () => requests[0].resolve(result));
    expect(screen.queryByText('Discovered Model')).not.toBeInTheDocument();
    await act(async () => requests[1].resolve({ data: [{ id: 'new-account-model' }] }));
    expect(screen.getByText('new-account-model')).toBeInTheDocument();
  });

  it('does not tie the Token Dance public catalog to account credentials', async () => {
    const provider = PRESET_PROVIDERS.find(p => p.id === 'tokendance')!;
    const view = render(<LogHost provider={provider} />);
    view.rerender(<LogHost provider={provider} apiKey="different-account-key" />);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('cmd_fetch_provider_models', expect.objectContaining({
      authHeaderName: null, authHeaderValue: null,
    }));
    await act(async () => requests[0].resolve({ data: [{
      id: 'public-chat', supported_protocols: ['openai:chat-completions'],
    }] }));
    expect(screen.getByText('public-chat')).toBeInTheDocument();
  });
});
