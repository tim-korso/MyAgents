/**
 * Turn-finalization gate for the external runtime session.
 *
 * Why this exists (cross-review 0.2.32, Codex Critical 1+2): `turnCompleted`
 * was overloaded to mean three DIFFERENT states at once —
 *   1. "the runtime emitted its terminal event" (turn_complete arrived),
 *   2. "it is safe to accept the next turn" (sendExternalMessage busy gate),
 *   3. "the assistant response is finalized and readable"
 *      (waitForExternalSessionIdle → getLastExternalAssistantText).
 * But persistTurnResult() runs fire-and-forget AFTER turn_complete flips the
 * flag: the assistant message is only pushed into allSessionMessages after
 * `await awaitInFlightSaves()`. In that window:
 *   - cron /cron/execute-sync and the IM heartbeat saw "idle", read the LAST
 *     assistant text, and could deliver the PREVIOUS turn's reply (or empty);
 *   - a back-to-back sendExternalMessage passed the busy gate (it only checks
 *     `!turnCompleted`) and ran resetTurnAccumulators(), wiping the content
 *     blocks persistTurnResult still had to read — dropping the assistant
 *     message from history/disk entirely;
 *   - the session_complete error branch reset the accumulators / surfaced an
 *     error banner for a turn that had already completed successfully.
 * Each prior fix snapshotted one more module global at persistTurnResult's
 * synchronous entry (inboxMeta, attachment hints, context usage). This gate is
 * the family fix for the remaining consumers: state #1 stays `turnCompleted`;
 * states #2 and #3 must ALSO wait for finalization to settle.
 *
 * Pure core (no module-global access) so the ordering contract is unit-testable;
 * external-session.ts owns the single instance.
 */
export class TurnFinalizationGate {
  private pending = 0;
  private waiters: Array<() => void> = [];

  /**
   * Track a fire-and-forget finalization promise. Settlement (resolve OR
   * reject) releases the gate; rejection handling/logging stays with the
   * caller's own `.catch`.
   */
  track(finalization: Promise<unknown>): void {
    this.pending++;
    const release = () => {
      this.pending--;
      if (this.pending === 0) {
        const ws = this.waiters.splice(0);
        for (const w of ws) w();
      }
    };
    finalization.then(release, release);
  }

  /** Synchronous probe: is a finalization currently in flight? */
  get inFlight(): boolean {
    return this.pending > 0;
  }

  /**
   * Wait until every tracked finalization has settled.
   * - No `timeoutMs`: waits indefinitely (callers with their own deadline
   *   should pass the remaining budget instead).
   * - With `timeoutMs`: resolves `false` if still in flight when it elapses —
   *   the caller decides whether to proceed degraded or report not-idle.
   */
  async settled(timeoutMs?: number): Promise<boolean> {
    if (this.pending === 0) return true;
    if (timeoutMs === undefined) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      return true;
    }
    if (timeoutMs <= 0) return false;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const waiter = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(true);
        }
      };
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          // Remove our own waiter — without this, a finalization that never
          // settles accumulates one dead closure per timed-out settled() call
          // until the next release() finally splices the array.
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          resolve(false);
        }
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}
