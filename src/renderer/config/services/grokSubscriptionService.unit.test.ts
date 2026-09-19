import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';
import { discoverGrokModels, getGrokLoginStatus } from './grokSubscriptionService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('grokSubscriptionService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the xAI model directory through the shared OpenAI parser', async () => {
    vi.mocked(invoke).mockResolvedValue({
      data: [
        { id: 'grok-4.5', owned_by: 'xai' },
        { id: 'grok-4.3', context_length: 1_000_000 },
      ],
    });

    await expect(discoverGrokModels()).resolves.toEqual([
      expect.objectContaining({ id: 'grok-4.5', ownedBy: 'xai' }),
      expect.objectContaining({ id: 'grok-4.3', contextLength: 1_000_000 }),
    ]);
    expect(invoke).toHaveBeenCalledWith('cmd_grok_fetch_models');
  });

  it('uses Tauri camelCase command arguments for login polling', async () => {
    vi.mocked(invoke).mockResolvedValue({});
    await getGrokLoginStatus('session-1');
    expect(invoke).toHaveBeenCalledWith('cmd_grok_login_status', { sessionId: 'session-1' });
  });
});
