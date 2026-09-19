// IM-source detection — shared with the renderer's `taskCenterUtils.isImSource`.
//
// The server cannot import renderer code (process boundary), and we don't want
// this single one-line check to grow a `shared/` dependency, so it lives here.
// Keep the suffix conventions in lock-step with renderer / SessionMetadata type
// (`SessionSource = 'desktop' | `${string}_private` | `${string}_group`).

import type { SessionSource } from '../types/session';

export function isImSourcedSession(source: SessionSource | string | undefined | null): boolean {
  if (!source) return false;
  if (source === 'desktop') return false;
  return source.endsWith('_private') || source.endsWith('_group');
}

/**
 * Deprecated guard retained for old call sites/tests. v0.2.39 changed the
 * ownership rule: an explicit desktop PATCH is allowed to promote even a pure
 * IM-sourced session to a self-contained snapshot, so no IM-shaped source is
 * dropped at the server boundary anymore.
 */
export function shouldDropSnapshotPatchOnImSession(
  _existingMeta: { source?: SessionSource | string | null; configSnapshotAt?: string | null } | null | undefined,
): boolean {
  return false;
}
