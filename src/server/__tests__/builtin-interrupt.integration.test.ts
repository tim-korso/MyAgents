import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { BuiltinTurnLifecycleDeps, BuiltinTurnLifecycle } from '../builtin-session/turn-lifecycle';

const captured = vi.hoisted(() => ({
  deps: null as BuiltinTurnLifecycleDeps | null,
  lifecycle: null as BuiltinTurnLifecycle | null,
}));
vi.mock('../builtin-session/turn-lifecycle', async importOriginal => {
  const actual = await importOriginal<typeof import('../builtin-session/turn-lifecycle')>();
  return {
    ...actual,
    createBuiltinTurnLifecycle: (deps: BuiltinTurnLifecycleDeps) => {
      captured.deps = deps;
      captured.lifecycle = actual.createBuiltinTurnLifecycle({
        ...deps,
        persistTranscript: vi.fn(async () => undefined),
        trackServer: vi.fn(),
        firePostTurnTitleHook: vi.fn(),
        broadcastBuiltinContextUsage: vi.fn(async () => undefined),
      });
      return captured.lifecycle;
    },
  };
});
vi.mock('../sse', async importOriginal => ({
  ...await importOriginal<typeof import('../sse')>(),
  broadcast: vi.fn(),
  broadcastLive: vi.fn(),
}));

import { interruptCurrentResponse } from '../agent-session';
import { broadcast } from '../sse';
import { resetLifecycleForTest, setQuerySession } from '../builtin-session/lifecycle';
import { resetQueueForTest } from '../builtin-session/queue';
import { resetTurnForTest } from '../builtin-session/turn';
import { resetTranscriptForTest } from '../builtin-session/transcript';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('builtin interrupt facade terminal ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLifecycleForTest();
    resetQueueForTest();
    resetTurnForTest();
    resetTranscriptForTest();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('sends Stop for B after A terminal even while A receipt is pending', async () => {
    const receiptA = deferred<undefined>();
    const receiptB = deferred<undefined>();
    const query = { interrupt: vi.fn()
      .mockReturnValueOnce(receiptA.promise).mockReturnValueOnce(receiptB.promise), close: vi.fn() };
    setQuerySession(query as unknown as Query);
    captured.deps!.setStreamingMessage(true);
    const stopA = interruptCurrentResponse();
    // Same synchronous terminal hook used by the real SDK result owner.
    captured.deps!.claimPostInterruptResultTerminal();
    captured.deps!.setStreamingMessage(true);
    const stopB = interruptCurrentResponse();
    const issued = query.interrupt.mock.calls.length;
    captured.deps!.claimPostInterruptResultTerminal();
    receiptA.resolve(undefined);
    receiptB.resolve(undefined);
    await Promise.all([stopA, stopB]);
    expect(issued).toBe(2);
    expect(query.close).not.toHaveBeenCalled();
  });

  it('does not classify a real SDK execution error as cancellation during Stop', async () => {
    const receipt = deferred<undefined>();
    const query = { interrupt: vi.fn(() => receipt.promise), close: vi.fn() };
    setQuerySession(query as unknown as Query);
    captured.deps!.setStreamingMessage(true);
    const stop = interruptCurrentResponse();
    await captured.lifecycle!.handleSdkResult({
      type: 'result', subtype: 'error_during_execution', is_error: true,
      errors: ['provider unavailable'], terminal_reason: 'failed',
      duration_ms: 10, duration_api_ms: 10, num_turns: 1, session_id: 'test',
    } as never);
    receipt.resolve(undefined);
    await stop;
    expect(vi.mocked(broadcast).mock.calls.some(([event]) => event === 'chat:agent-error')).toBe(true);
    expect(vi.mocked(broadcast).mock.calls.some(([event]) => event === 'chat:message-stopped')).toBe(false);
  });
});
