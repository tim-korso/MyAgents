/**
 * Pure decision for how the external-runtime `session_complete` handler should
 * treat an *error*-subtype terminal event. See external-session.ts.
 *
 * Three outcomes, in priority order:
 *  - `ignore-idle`        — the persistent process died BETWEEN turns (a turn already
 *                           completed and produced no pending assistant text). Common on
 *                           Codex/Gemini after long idle (SIGKILL exit 137). The next
 *                           send transparently respawns; the user never needed an error.
 *  - `suppress-user-stop` — #307: WE asked the process to stop (user pressed Stop, a
 *                           config-change restart, or a session takeover called
 *                           stopExternalSession). The kill makes the subprocess emit an
 *                           error session_complete, but an abort we initiated is not a
 *                           real failure. Suppress the banner — mirrors the builtin
 *                           path's isAbortedTerminalReason()/isInterruptingResponse gate.
 *  - `surface`            — a genuine runtime failure mid-turn. Show it.
 *
 * Functional Core / Imperative Shell: the shell reads-and-clears the stop flag and
 * performs the broadcasts; this only decides which path to take.
 */
export type SessionCompleteErrorAction = 'ignore-idle' | 'suppress-user-stop' | 'surface';

export function decideSessionCompleteErrorAction(opts: {
  /** A turn already completed this session (so a fresh exit is "between turns"). */
  turnCompleted: boolean;
  /** There is un-flushed assistant text for the current turn. */
  hasAssistantText: boolean;
  /** stopExternalSession() initiated this teardown (read-and-cleared by the shell). */
  userRequestedStop: boolean;
  /**
   * persistTurnResult() for the completed turn is still in flight (cross-review
   * 0.2.32). While it runs, the accumulators still hold the COMPLETED turn's
   * text, so hasAssistantText=true does not mean "interrupted mid-turn" — it
   * means "successful turn being flushed". Without this, a process death in
   * that window surfaced an error banner for a turn that already succeeded,
   * and the shell's accumulator reset raced the in-flight persist.
   */
  finalizationInFlight?: boolean;
}): SessionCompleteErrorAction {
  // Idle-exit wins: a between-turns death is invisible regardless of why it happened.
  // "Between turns" = the turn completed AND its leftover text (if any) is just
  // the in-flight finalization flushing, not an interrupted response.
  if (opts.turnCompleted && (!opts.hasAssistantText || opts.finalizationInFlight)) return 'ignore-idle';
  // #307: an abort we initiated is expected, not a failure.
  if (opts.userRequestedStop) return 'suppress-user-stop';
  return 'surface';
}
