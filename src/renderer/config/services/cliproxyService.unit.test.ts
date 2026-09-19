import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { CliProxyStatus } from '../../../shared/cliproxy';
import { cancelCliProxy, discoverCliProxyModels, shouldShowCliProxyProvider } from './cliproxyService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
describe('CLIProxy settings projection', () => {
  beforeEach(() => vi.clearAllMocks());
  it('keeps cleanup and account controls visible after remote disabling', () => {
    const status = { policy: { usable: false }, active: null, candidate: null, cleanup: null } as CliProxyStatus;
    expect(shouldShowCliProxyProvider(status)).toBe(false);
    expect(shouldShowCliProxyProvider({ ...status, cleanup: { scope: 'retired', failed: true } })).toBe(true);
    expect(shouldShowCliProxyProvider({ ...status, active: { generation: 'account', status: 'connected' } })).toBe(true);
    expect(shouldShowCliProxyProvider(null)).toBe(false);
  });
  it('targets cancellation by exact attempt', async () => {
    vi.mocked(invoke).mockResolvedValue({});
    await cancelCliProxy('attempt');
    expect(invoke).toHaveBeenCalledWith('cmd_cliproxy_cancel', { attemptId: 'attempt' });
  });
  it('uses only Rust-projected capabilities for model discovery', async () => {
    vi.mocked(invoke).mockResolvedValue([{ model: 'tested-model', modelName: 'Model', contextLength: 32_000,
      inputModalities: ['text'] }]);
    expect(await discoverCliProxyModels('generation')).toEqual([{ id: 'tested-model', displayName: 'Model', contextLength: 32_000,
      supportsImage: false, supportedProtocols: ['anthropic:messages'] }]);
    expect(invoke).toHaveBeenCalledWith('cmd_cliproxy_models', { accountGeneration: 'generation' });
  });
});
