import { describe, expect, it } from 'vitest';

import {
  decideQueueAdmission,
  resolveChatQueueResponseMode,
  shouldApplyChatQueueResponseMode,
} from './queue-response-mode';

describe('chat queue response mode isolation', () => {
  it('applies the setting only to desktop-origin builtin chat sends', () => {
    expect(shouldApplyChatQueueResponseMode(true)).toBe(true);
    expect(shouldApplyChatQueueResponseMode(false)).toBe(false);
    expect(shouldApplyChatQueueResponseMode(undefined)).toBe(false);
    expect(resolveChatQueueResponseMode('turn', true)).toBe('turn');
    expect(resolveChatQueueResponseMode('turn', false)).toBe('realtime');
    expect(resolveChatQueueResponseMode('bad', true)).toBe('realtime');
  });

  it('preserves realtime admission and isolates turn-mode admission', () => {
    expect(
      decideQueueAdmission({
        mode: 'realtime',
        busy: false,
        hasInFlight: false,
      }),
    ).toBe('direct');
    expect(
      decideQueueAdmission({
        mode: 'realtime',
        busy: true,
        hasInFlight: false,
      }),
    ).toBe('realtime-inflight');
    expect(
      decideQueueAdmission({
        mode: 'realtime',
        busy: true,
        hasInFlight: true,
      }),
    ).toBe('realtime-buffer');
    expect(
      decideQueueAdmission({
        mode: 'turn',
        busy: true,
        hasInFlight: false,
      }),
    ).toBe('turn-boundary');
    expect(
      decideQueueAdmission({
        mode: 'realtime',
        busy: true,
        hasInFlight: false,
        hasScopedTurnBoundaryQueued: true,
      }),
    ).toBe('turn-boundary');
    expect(
      decideQueueAdmission({
        mode: 'realtime',
        busy: true,
        hasInFlight: false,
        hasScopedTurnBoundaryQueued: false,
      }),
    ).toBe('realtime-inflight');
  });
});
