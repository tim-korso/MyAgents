/**
 * Regression: a turn that emits no context-usage snapshot must NOT erase the
 * previously persisted `lastContextUsage` (PRD 0.2.32 review finding).
 *
 * Models the exact contract that produced the bug (mirrors incremental-persist.test.ts'
 * "model the contract directly" approach — no real SessionStore wiring):
 *   1. external-session builds the metadata patch each turn.
 *   2. updateSessionMetadata merges `{ ...existing, ...patch }` then writes JSON —
 *      and JSON.stringify DROPS keys whose value is `undefined`.
 *
 * The bug: `{ lastContextUsage: lastBroadcastContextUsage ?? undefined }` on a no-usage
 * turn (lastBroadcastContextUsage === null) wrote `undefined`, which the merge+stringify
 * silently dropped — erasing the value persisted by an earlier turn.
 *
 * The fix: conditional spread — only include the key when we actually have a snapshot.
 */
import { describe, it, expect } from 'vitest';

import type { ContextUsage } from '../../shared/types/context-usage';

const SNAP: ContextUsage = {
  contextTokens: 94_000, contextWindow: 200_000, usedPercent: 47,
  source: 'codex', windowSource: 'runtime', model: 'gpt-5.4-codex',
};

/** The FIX as implemented in external-session.ts persistTurnResult. */
function buildPatch(lastBroadcastContextUsage: ContextUsage | null): Record<string, unknown> {
  return {
    lastMessagePreview: 'hi',
    ...(lastBroadcastContextUsage ? { lastContextUsage: lastBroadcastContextUsage } : {}),
  };
}

/** The pre-fix BUGGY form, kept only to prove it regresses (documents the hazard). */
function buildPatchBuggy(lastBroadcastContextUsage: ContextUsage | null): Record<string, unknown> {
  return { lastMessagePreview: 'hi', lastContextUsage: lastBroadcastContextUsage ?? undefined };
}

/** Mirror updateSessionMetadata: merge then JSON round-trip (stringify drops `undefined`). */
function applyMetaPatch(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ ...existing, ...patch }));
}

describe('lastContextUsage persistence — no-usage turn must not erase (PRD 0.2.32)', () => {
  it('FIX: a no-usage turn (null snapshot) preserves the previously persisted value', () => {
    const existing = { id: 's1', lastContextUsage: SNAP };
    const after = applyMetaPatch(existing, buildPatch(null));
    expect(after.lastContextUsage).toEqual(SNAP); // preserved, not erased
  });

  it('a turn WITH a snapshot updates the persisted value', () => {
    const next: ContextUsage = { ...SNAP, contextTokens: 120_000, usedPercent: 60 };
    const existing = { id: 's1', lastContextUsage: SNAP };
    const after = applyMetaPatch(existing, buildPatch(next));
    expect(after.lastContextUsage).toEqual(next);
  });

  it('regression guard: the pre-fix `?? undefined` form WOULD erase it', () => {
    const existing = { id: 's1', lastContextUsage: SNAP };
    const after = applyMetaPatch(existing, buildPatchBuggy(null));
    // This is the bug we fixed — documents WHY conditional spread is required.
    expect(after.lastContextUsage).toBeUndefined();
  });

  it('first-ever persist with a snapshot writes it cleanly', () => {
    const after = applyMetaPatch({ id: 's1' }, buildPatch(SNAP));
    expect(after.lastContextUsage).toEqual(SNAP);
  });
});
