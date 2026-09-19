import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import {
  cancelGrokLogin,
  getGrokAuthStatus,
  startGrokLogin,
  verifyGrokAccount,
} from '@/config/services/grokSubscriptionService';
import { openExternal } from '@/utils/openExternal';
import GrokSubscriptionProvider from './GrokSubscriptionProvider';

vi.mock('@/hooks/useCloseLayer', () => ({ useCloseLayer: vi.fn() }));
vi.mock('@/utils/openExternal', () => ({ openExternal: vi.fn(async () => undefined) }));
vi.mock('@/config/services/grokSubscriptionService', async importOriginal => {
  const original = await importOriginal<typeof import('@/config/services/grokSubscriptionService')>();
  return {
    ...original,
    cancelGrokLogin: vi.fn(async () => undefined),
    getGrokAuthStatus: vi.fn(),
    getGrokLoginStatus: vi.fn(),
    logoutGrok: vi.fn(async () => undefined),
    startGrokLogin: vi.fn(),
    verifyGrokAccount: vi.fn(),
  };
});

describe('GrokSubscriptionProvider', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    await i18n.changeLanguage('en-US');
    vi.mocked(getGrokAuthStatus).mockResolvedValue({
      state: 'logged_out',
      hasGrant: false,
      verified: false,
    });
  });

  it('opens the device login URL, shows the code, and cancels an active login on unmount', async () => {
    vi.mocked(startGrokLogin).mockResolvedValue({
      sessionId: 'login-1',
      status: 'waiting',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.x.ai/device',
      verificationUriComplete: 'https://auth.x.ai/device?code=ABCD-EFGH',
      expiresAt: 123,
      pollIntervalSeconds: 30,
    });
    const onAuthChanged = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const view = render(<GrokSubscriptionProvider onAuthChanged={onAuthChanged} />);

    await screen.findByText('Grok account not logged in');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument();
    expect(openExternal).toHaveBeenCalledWith('https://auth.x.ai/device?code=ABCD-EFGH');

    view.unmount();
    await waitFor(() => expect(cancelGrokLogin).toHaveBeenCalledWith('login-1'));
  });

  it('finishes a validating login through the real account verification action', async () => {
    vi.mocked(startGrokLogin).mockResolvedValue({
      sessionId: 'login-2',
      status: 'validating',
      expiresAt: 123,
      pollIntervalSeconds: 5,
    });
    vi.mocked(verifyGrokAccount).mockResolvedValue({
      success: true,
      state: 'valid',
      model: 'grok-4.5',
      account: { email: 'user@example.com' },
    });
    vi.mocked(getGrokAuthStatus)
      .mockResolvedValueOnce({ state: 'logged_out', hasGrant: false, verified: false })
      .mockResolvedValue({
        state: 'valid',
        hasGrant: true,
        verified: true,
        account: { email: 'user@example.com' },
      });
    const onAuthChanged = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<GrokSubscriptionProvider onAuthChanged={onAuthChanged} />);

    await screen.findByText('Grok account not logged in');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(verifyGrokAccount).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(onAuthChanged).toHaveBeenCalled();
  });

  it('cancels a late start result when the dialog was closed while login was preparing', async () => {
    let resolveStart: ((value: Awaited<ReturnType<typeof startGrokLogin>>) => void) | undefined;
    vi.mocked(startGrokLogin).mockReturnValue(new Promise(resolve => { resolveStart = resolve; }));
    const user = userEvent.setup();
    render(<GrokSubscriptionProvider onAuthChanged={vi.fn(async () => undefined)} />);

    await screen.findByText('Grok account not logged in');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByText('Preparing the login link…');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    resolveStart?.({
      sessionId: 'late-session',
      status: 'waiting',
      verificationUriComplete: 'https://auth.x.ai/device?code=LATE',
      expiresAt: 123,
      pollIntervalSeconds: 5,
    });

    await waitFor(() => expect(cancelGrokLogin).toHaveBeenCalledWith('late-session'));
    expect(openExternal).not.toHaveBeenCalled();
    expect(screen.queryByText('LATE')).not.toBeInTheDocument();
  });

  it('keeps login failures visible inside the overlay with a retry action', async () => {
    vi.mocked(startGrokLogin).mockRejectedValue({ message: 'Device login is unavailable' });
    const user = userEvent.setup();
    render(<GrokSubscriptionProvider onAuthChanged={vi.fn(async () => undefined)} />);

    await screen.findByText('Grok account not logged in');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Login did not complete')).toBeInTheDocument();
    expect(screen.getAllByText('Device login is unavailable').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Log in again' })).toBeInTheDocument();
  });

  it('renders an expired device session as a retryable terminal state', async () => {
    vi.mocked(startGrokLogin).mockResolvedValue({
      sessionId: 'expired-session',
      status: 'expired',
      expiresAt: 123,
      pollIntervalSeconds: 5,
      error: { code: 'login_expired', message: 'Device code expired' },
    });
    const user = userEvent.setup();
    render(<GrokSubscriptionProvider onAuthChanged={vi.fn(async () => undefined)} />);

    await screen.findByText('Grok account not logged in');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Login did not complete')).toBeInTheDocument();
    expect(screen.getAllByText('Device code expired').length).toBeGreaterThan(0);
  });

  it('refreshes canonical provider state after a failed manual re-verification', async () => {
    vi.mocked(getGrokAuthStatus)
      .mockResolvedValueOnce({
        state: 'valid',
        hasGrant: true,
        verified: true,
        account: { email: 'old@example.com' },
      })
      .mockResolvedValue({
        state: 'auth_required',
        hasGrant: false,
        verified: false,
        lastError: { code: 'auth_required', message: 'Login expired' },
      });
    vi.mocked(verifyGrokAccount).mockResolvedValue({
      success: false,
      state: 'auth_required',
      error: { code: 'auth_required', message: 'Login expired' },
    });
    const user = userEvent.setup();
    render(<GrokSubscriptionProvider onAuthChanged={vi.fn(async () => undefined)} />);

    await screen.findByText('old@example.com');
    await user.click(screen.getByTitle('Verify again'));

    await waitFor(() => expect(screen.queryByText('Verified')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getAllByText('Login expired').length).toBeGreaterThan(0);
  });
});
