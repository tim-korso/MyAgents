import { describe, expect, it } from 'vitest';

import { shouldAutoSendInitialMessage } from './initialMessageAutoSend';

describe('shouldAutoSendInitialMessage', () => {
  it('allows a launcher handoff to send from an inactive connected tab', () => {
    expect(shouldAutoSendInitialMessage({
      hasInitialMessage: true,
      alreadyConsumed: false,
      hasSessionId: true,
      isConnected: true,
      isActive: false,
      runtimeReady: true,
    })).toBe(true);
  });

  it.each([
    ['missing initial message', { hasInitialMessage: false, alreadyConsumed: false, hasSessionId: true, isConnected: true, isActive: true }],
    ['already consumed', { hasInitialMessage: true, alreadyConsumed: true, hasSessionId: true, isConnected: true, isActive: true }],
    ['missing session id', { hasInitialMessage: true, alreadyConsumed: false, hasSessionId: false, isConnected: true, isActive: true }],
    ['not connected', { hasInitialMessage: true, alreadyConsumed: false, hasSessionId: true, isConnected: false, isActive: true }],
    ['runtime not ready', { hasInitialMessage: true, alreadyConsumed: false, hasSessionId: true, isConnected: true, isActive: true, runtimeReady: false }],
  ])('waits when %s', (_name, gate) => {
    expect(shouldAutoSendInitialMessage(gate)).toBe(false);
  });
});
