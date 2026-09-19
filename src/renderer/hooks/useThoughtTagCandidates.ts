// useThoughtTagCandidates — merge thought-history tags with workspace names
// to feed the `#` autocomplete picker in ThoughtInput.
//
// Why workspaces (not Agents): the Launcher's 「Agent 工作区」 panel lists
// every user-visible workspace Project, regardless of whether that project
// has been upgraded to an active IM Agent. The `#` picker MUST stay in
// sync with that visual inventory — if `wishpool` shows as a workspace
// card on the right, pressing `#` should offer `#wishpool` on the left.
// Reading from `config.agents` (which only contains IM-upgraded workspaces)
// dropped plain workspaces from the picker AND leaked internal Agents
// (e.g. the `~/.myagents` diagnostic workspace shown as `MyAgents_诊断`)
// that the Launcher itself filters out.
//
// Output shape matches `ThoughtInput.existingTags` verbatim
// (`Array<[tag, count]>`, sorted desc by count): history tags keep their
// real frequency; workspace-name entries get a virtual count of `0` so
// they sort to the bottom without interfering with the frequency ordering
// of real tags. This `count=0` sentinel is part of the ThoughtInput
// contract (see its `existingTags` JSDoc) — do NOT filter it out in
// consumers.
//
// Contrast with `ThoughtPanel.allTags`: that variant is history-only
// because it drives the search drawer's tag cloud, where phantom
// workspace tags would filter into empty result sets. `tagCandidates`
// is the *picker superset* (history + discovery); `allTags` is the
// *filter inventory* (history only). Keep the two distinct.
//
// Workspace names go through `sanitizeForTag` (shared with the Rust
// parser mirror in `parseThoughtTags.ts`) so inserted `#<name>` round-
// trips through `parse_tags` cleanly — spaces, CJK punct, emoji all
// coerced to `_`; empty results dropped. Case-insensitive dedup against
// history tags so typing `#work` in one place and a workspace named
// `Work` elsewhere don't silently fork the tag namespace (the
// ThoughtPanel tag filter is case-sensitive — `#work` and `#Work` would
// otherwise mean two distinct buckets).

import { useMemo } from 'react';
import type { Thought } from '@/../shared/types/thought';
import { isProjectVisibleToUser, type Project } from '@/config/types';
import { sanitizeForTag } from '@/utils/parseThoughtTags';

/**
 * Build the `#` autocomplete candidate list for ThoughtInput.
 *
 * Pass `projects` as `null`/`undefined` when you only want history tags
 * (e.g. a consumer that doesn't have workspace context). Internal
 * workspaces hidden by the Launcher's own visibility filter are skipped —
 * users should never see a tag for a workspace that's hidden from their own
 * workspace panel.
 */
export function useThoughtTagCandidates(
  thoughts: readonly Thought[] | null | undefined,
  projects: readonly Project[] | null | undefined,
): Array<[string, number]> {
  // Collapse `projects` down to a stable name-signature string — the
  // only thing the merge actually consumes from the workspace side.
  // `loadAppConfig()` fires on IM Bot / Cron / CLI SSE events and hands
  // us a fresh `projects` array each time even when names haven't
  // changed; without this layer the outer useMemo would re-sort and
  // re-allocate on every such event. We also drop non-visible projects here
  // so the inner merge code stays trivial.
  const workspaceNames = useMemo(() => {
    if (!projects) return '';
    return projects
      .filter(isProjectVisibleToUser)
      .map((p) => (p.displayName?.trim() || p.name?.trim() || '').trim())
      .filter(Boolean)
      .sort()
      .join('\n');
  }, [projects]);

  return useMemo(() => {
    const counts = new Map<string, number>();
    // Case-insensitive dedup key → canonical stored form. History wins
    // over workspace-derived entries for two reasons: (1) history carries
    // the real count; (2) history preserves the user's exact casing
    // (Rust tag store is case-preserving), so surfacing the workspace's
    // casing on top would split filter results downstream.
    const lowerToCanonical = new Map<string, string>();

    if (thoughts) {
      for (const t of thoughts) {
        for (const tag of t.tags) {
          const key = tag.toLowerCase();
          const canonical = lowerToCanonical.get(key) ?? tag;
          lowerToCanonical.set(key, canonical);
          counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
        }
      }
    }

    if (workspaceNames) {
      for (const raw of workspaceNames.split('\n')) {
        if (!raw) continue;
        const safe = sanitizeForTag(raw);
        if (!safe) continue;
        const key = safe.toLowerCase();
        // Skip workspace names whose normalized form already exists as a
        // history tag (any casing). Prevents `#work` (history) and
        // `#Work` (workspace) appearing as two rows that filter into
        // different buckets.
        if (lowerToCanonical.has(key)) continue;
        lowerToCanonical.set(key, safe);
        counts.set(safe, 0);
      }
    }

    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [thoughts, workspaceNames]);
}

export default useThoughtTagCandidates;
