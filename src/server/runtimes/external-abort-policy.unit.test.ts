import { describe, expect, it } from 'vitest';

import { decideSessionCompleteErrorAction } from './external-abort-policy';

describe('decideSessionCompleteErrorAction — external session_complete error routing', () => {
  it('#307: a user-initiated stop is suppressed, not surfaced', () => {
    // The reported bug: stopping an external Claude Code turn mid-stream killed the
    // process → error session_complete → "Session ended with error" banner.
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: false,
        hasAssistantText: true,
        userRequestedStop: true,
      }),
    ).toBe('suppress-user-stop');

    // Even with no streamed text yet (abort lands early), still suppress.
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: false,
        hasAssistantText: false,
        userRequestedStop: true,
      }),
    ).toBe('suppress-user-stop');
  });

  it('surfaces a genuine mid-turn failure (no stop requested)', () => {
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: false,
        hasAssistantText: true,
        userRequestedStop: false,
      }),
    ).toBe('surface');
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: false,
        hasAssistantText: false,
        userRequestedStop: false,
      }),
    ).toBe('surface');
  });

  it('idle-exit (between turns, no pending text) is ignored regardless of stop flag', () => {
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: true,
        hasAssistantText: false,
        userRequestedStop: false,
      }),
    ).toBe('ignore-idle');
    // Idle-exit takes priority even if a stop was also flagged.
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: true,
        hasAssistantText: false,
        userRequestedStop: true,
      }),
    ).toBe('ignore-idle');
  });

  it('a completed turn with pending text + stop is treated as a stop (not idle)', () => {
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: true,
        hasAssistantText: true,
        userRequestedStop: true,
      }),
    ).toBe('suppress-user-stop');
  });

  it('cross-review 0.2.32: a death while the completed turn is still FINALIZING is idle, not a surfaced error', () => {
    // Repro (Codex state-machine finding): turn_complete fired persistTurnResult
    // fire-and-forget; before it resets the accumulators the process error-exits.
    // currentAssistantText is still non-empty — but that text belongs to the
    // ALREADY-SUCCESSFUL turn being flushed, not to an interrupted one. The old
    // policy read hasAssistantText=true → 'surface': error banner + accumulator
    // reset racing the in-flight persist (dropping the assistant message).
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: true,
        hasAssistantText: true,
        userRequestedStop: false,
        finalizationInFlight: true,
      }),
    ).toBe('ignore-idle');

    // Same death AFTER finalization settled: text would have been reset by
    // persistTurnResult, so hasAssistantText=false → already ignore-idle.
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: true,
        hasAssistantText: false,
        userRequestedStop: false,
        finalizationInFlight: false,
      }),
    ).toBe('ignore-idle');

    // finalizationInFlight must NOT mask a genuine mid-turn failure: if the
    // turn never completed, a pending finalization from some earlier turn
    // cannot downgrade this turn's error.
    expect(
      decideSessionCompleteErrorAction({
        turnCompleted: false,
        hasAssistantText: true,
        userRequestedStop: false,
        finalizationInFlight: true,
      }),
    ).toBe('surface');
  });
});
