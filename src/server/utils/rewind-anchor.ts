/**
 * Cold-reload boundary inference for historical Sessions without an explicit
 * persisted rewind boundary. The facade captures it at load, before a new user
 * message changes the product tail. Explicit rewind metadata always takes priority.
 */

/** Minimal shape this decision needs — keeps the core decoupled + unit-testable. */
export interface ReloadAnchorMessage {
  role: 'user' | 'assistant';
  /** SDK-assigned UUID (for resumeSessionAt). Absent on rows the SDK hasn't stamped. */
  sdkUuid?: string;
}

/**
 * Derive the cold-reload `resumeSessionAt` anchor, or `undefined` to leave the SDK
 * on a bare resume.
 *
 * Returns the tail message's `sdkUuid` IFF ALL hold:
 *  - the tail is an `assistant` (decision 3 — gate to tail-is-assistant). A tail
 *    `user` row is an UNANSWERED turn (a normal direct-send persists the user row
 *    before the SDK answer exists); anchoring to an earlier assistant would slice
 *    that pending turn out of the SDK history. Explicit rewind can retain a user
 *    tail and supplies its own persisted boundary instead of this inference.
 *  - the tail has an `sdkUuid` (the native chain entry for the displayed message).
 *  - that uuid is known-valid (`currentSessionUuids`) — decision 4, so we don't send
 *    a guaranteed-stale anchor and eat a doomed resume + restart.
 *
 * No-op by construction in the normal case: when the tail == the SDK's newest leaf,
 * slicing the reconstructed chain at the tail returns the whole chain.
 */
export function deriveReloadResumeAnchor(
  messages: readonly ReloadAnchorMessage[],
  currentSessionUuids: ReadonlySet<string>,
): string | undefined {
  if (messages.length === 0) return undefined;
  const tail = messages[messages.length - 1];
  if (tail.role !== 'assistant') return undefined;       // decision 3
  if (!tail.sdkUuid) return undefined;
  if (!currentSessionUuids.has(tail.sdkUuid)) return undefined;  // decision 4
  return tail.sdkUuid;
}

export interface EffectiveResumeAtInputs {
  forkMode: boolean;
  /** Explicit rewind boundary persisted in Session metadata. */
  rewindResumeAt?: string;
  /** Fork-point anchor (only meaningful in fork mode). */
  forkResumeAt?: string;
  /** Cold-reload anchor (deriveReloadResumeAnchor); must already be gated to undefined
   *  in fork mode / when a rewind anchor exists by the caller. */
  reloadAnchor?: string;
}

/**
 * Resolve the single `resumeSessionAt` value sent to the SDK, encoding the fixed
 * priority. Pure so the priority invariant is locked by a test — the fork-migration
 * PRD (prd_0.2.27_fork_standalone_migration.md) is explicitly warned not to regress
 * this fold when it removes `forkResumeAt`.
 *  - fork mode: an explicit rewind wins over the fork point; the cold-reload anchor
 *    is NEVER used (a fork carries its own truncation semantics).
 *  - normal: an explicit rewind wins over the cold-reload anchor (so existing rewind
 *    behavior is byte-for-byte unchanged; reloadAnchor is strictly the lowest priority).
 */
export function resolveEffectiveResumeAt(i: EffectiveResumeAtInputs): string | undefined {
  return i.forkMode
    ? (i.rewindResumeAt ?? i.forkResumeAt)
    : (i.rewindResumeAt ?? i.reloadAnchor);
}
