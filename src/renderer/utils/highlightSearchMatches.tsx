// Plain substring highlight helpers — used for in-card 搜索关键词 markup
// without going through the full Tantivy / `find_highlights` Rust path.
//
// Scope: simple case-insensitive `String#indexOf` loop. Keeps the renderer
// honest about what we promise (matches what `thought.rs::list({ query })`
// does, which is also `to_lowercase().contains(needle)`). The CJK byte/UTF-16
// dance the Rust `find_highlights` worries about doesn't apply here because
// JS strings are already UTF-16 and the renderer slices with `.slice()`.

import type { ReactNode } from 'react';

/** Pairs of `[startInclusive, endExclusive]` indices (UTF-16 / JS string). */
export type HighlightRange = [number, number];

/**
 * Find every occurrence of `query` in `text`, case-insensitive. Empty / blank
 * `query` returns `[]`. Adjacent overlaps are skipped — a 4-char `"abab"`
 * search in `"ababab"` returns 2 ranges, not 3.
 */
export function findHighlightRanges(text: string, query: string): HighlightRange[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return [];
  const haystack = text.toLowerCase();
  const ranges: HighlightRange[] = [];
  let i = 0;
  while (i <= haystack.length - needle.length) {
    const hit = haystack.indexOf(needle, i);
    if (hit < 0) break;
    ranges.push([hit, hit + needle.length]);
    i = hit + needle.length;
  }
  return ranges;
}

/**
 * Render `text` with `<mark>` spans wrapping each range in `ranges`. Ranges
 * are assumed sorted ascending and non-overlapping (output of
 * `findHighlightRanges`). Each segment is keyed so React reconciles per-mark
 * uniqueness in long lists.
 */
export function renderTextWithHighlights(
  text: string,
  ranges: HighlightRange[],
  markClassName = 'rounded-[2px] bg-[var(--accent-warm-subtle)] px-[1px] text-[var(--accent-warm)]',
): ReactNode {
  if (ranges.length === 0) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  for (let idx = 0; idx < ranges.length; idx += 1) {
    const [s, e] = ranges[idx];
    if (s > cursor) out.push(<span key={`p${cursor}`}>{text.slice(cursor, s)}</span>);
    out.push(
      <mark key={`m${s}`} className={markClassName}>
        {text.slice(s, e)}
      </mark>,
    );
    cursor = e;
  }
  if (cursor < text.length) out.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>);
  return out;
}
