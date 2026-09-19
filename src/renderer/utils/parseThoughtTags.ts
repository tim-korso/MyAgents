// Shared tag-parse + boundary rules, kept in lock-step with the Rust parser at
// `src-tauri/src/thought.rs::parse_tags`. The UI uses this to:
//   1. Render inline `#xxx` highlights identical to what the Rust side extracts
//      into `thought.tags` (so the card never shows a highlighted "tag" that
//      the backend disagrees with).
//   2. Let the user click a highlighted tag to filter the thought stream.
//
// Keep the char ranges and boundary set in sync with `is_tag_char` /
// `is_tag_boundary_char` in the Rust module. Cross-review regression guard:
// the Rust parser rejects mid-word `url?x=a#b` and accepts `#维护` after `。` /
// `，`; our `splitWithTagHighlights` below does the same.

/** Characters that may appear inside a tag body. Mirrors `is_tag_char` in Rust. */
export function isTagChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  // ASCII alphanumeric / `_` / `-`
  if (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x2d
  ) {
    return true;
  }
  // CJK Unified Ideographs (U+4E00..U+9FFF)
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  // CJK Extension A (U+3400..U+4DBF)
  if (code >= 0x3400 && code <= 0x4dbf) return true;
  // Hiragana/Katakana (U+3040..U+30FF)
  if (code >= 0x3040 && code <= 0x30ff) return true;
  return false;
}

const BOUNDARY_PUNCT = new Set([
  '(',
  '[',
  '{',
  ',',
  '，',
  '。',
  '、',
  '：',
  ':',
  ';',
  '；',
  '（',
  '【',
]);

export function isBoundaryChar(ch: string): boolean {
  if (/\s/.test(ch)) return true;
  return BOUNDARY_PUNCT.has(ch);
}

/**
 * Given `value` + a cursor position (UTF-16 code unit offset), find the active
 * `#…` hashtag context at the cursor, if any. Returns `{ anchor, query }`
 * where `anchor` is the index of the `#` and `query` is the tag body between
 * `#` and `cursor`. Used by input widgets (autocomplete dropdown).
 *
 * Walks backward from the cursor in codepoint-aware form so emoji / astral
 * plane chars preceding the `#` are recognised as boundary characters.
 */
export function findActiveTagContext(
  value: string,
  cursor: number,
): { anchor: number; query: string } | null {
  // Build a codepoint array of the prefix up to the cursor so indexing is
  // codepoint-safe. `anchor` must be returned as a UTF-16 offset (consumers
  // slice the original string), so we track both.
  const prefix = value.slice(0, cursor);
  const cps = [...prefix];
  for (let i = cps.length - 1; i >= 0; i--) {
    const ch = cps[i];
    if (ch === '#') {
      const prev = i === 0 ? '' : cps[i - 1];
      if (i === 0 || isBoundaryChar(prev)) {
        const bodyCps = cps.slice(i + 1);
        if (bodyCps.length === 0 || bodyCps.every(isTagChar)) {
          // Convert codepoint index back to UTF-16 offset.
          const utf16Anchor = cps.slice(0, i).join('').length;
          return { anchor: utf16Anchor, query: bodyCps.join('') };
        }
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/**
 * Given `value` and a UTF-16 offset pointing at a `#`, scan forward and
 * return the UTF-16 offset just past the tag body (first non-tag-char).
 * Used when a user picks an autocomplete entry while the caret is inside
 * an existing tag — the full body (including what's after the caret)
 * should be replaced.
 */
export function tagBodyEndOffset(value: string, hashIndex: number): number {
  // Walk codepoints from just after `#` until a non-tag-char is hit.
  let cursor = hashIndex + 1;
  while (cursor < value.length) {
    // Handle potential surrogate pair at `cursor`.
    const code = value.charCodeAt(cursor);
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    const ch = isHighSurrogate ? value.slice(cursor, cursor + 2) : value[cursor];
    if (!isTagChar(ch)) break;
    cursor += isHighSurrogate ? 2 : 1;
  }
  return cursor;
}

export interface TagSegment {
  type: 'text' | 'tag';
  value: string;
  /** Tag body (without the leading `#`), only set when `type === 'tag'`. */
  tag?: string;
}

/**
 * Coerce an arbitrary string (e.g. an Agent workspace name) into a shape
 * the Rust `parse_tags` side will accept as a tag body. Companion to
 * `isTagChar` — same char classes, same boundary rules, phrased as
 * "pressure any string into a valid tag".
 *
 * Rules:
 *   - Chars passing `isTagChar` keep their form.
 *   - Everything else (spaces, CJK punct, emoji, symbols) → `_`.
 *   - Runs of `_` collapse to a single `_`.
 *   - Leading / trailing `_` are stripped.
 *
 * Returns `""` if nothing survives — callers should treat that as "drop
 * this entry".
 *
 * Kept here (next to `isTagChar` + `parseThoughtTags` Rust mirror) so the
 * three pieces of the tag contract — what's a tag char, how to pick a
 * cursor context, how to coerce a name — travel together and can't drift
 * without a single-file diff flagging it.
 */
export function sanitizeForTag(raw: string): string {
  const out: string[] = [];
  for (const ch of raw) out.push(isTagChar(ch) ? ch : '_');
  return out
    .join('')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Split `content` into `{type, value}` segments, marking `#xxx` runs as tags
 * when they pass the Rust parser's boundary + char-class rules.
 */
export function splitWithTagHighlights(content: string): TagSegment[] {
  const segments: TagSegment[] = [];
  const chars = [...content]; // splits by codepoint
  let cursor = 0;
  let plainStart = 0;

  while (cursor < chars.length) {
    const ch = chars[cursor];
    if (ch === '#') {
      const prevOk =
        cursor === 0 || isBoundaryChar(chars[cursor - 1]);
      if (prevOk) {
        // Collect tag body
        let j = cursor + 1;
        while (j < chars.length && isTagChar(chars[j])) j += 1;
        if (j > cursor + 1) {
          // Emit preceding plain text.
          if (cursor > plainStart) {
            segments.push({
              type: 'text',
              value: chars.slice(plainStart, cursor).join(''),
            });
          }
          const bodyChars = chars.slice(cursor + 1, j);
          segments.push({
            type: 'tag',
            value: '#' + bodyChars.join(''),
            tag: bodyChars.join(''),
          });
          cursor = j;
          plainStart = j;
          continue;
        }
      }
    }
    cursor += 1;
  }
  if (plainStart < chars.length) {
    segments.push({
      type: 'text',
      value: chars.slice(plainStart).join(''),
    });
  }
  return segments;
}
