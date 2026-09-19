// Sanitize an inbox label before injecting into prompt context (PRD 0.2.18).
//
// **Pit-of-success 集中点**——所有 `<inbox-message from="...">` / `<inbox-reply
// from="...">` 注入前必经此 helper,避免每个注入点各自实现 escape + 截断。
//
// 必须 escape AND 截断(不是 OR):
//   - HTML escape 防 label 内含 `</inbox-message>` 等闭合标签破坏注入结构
//   - 80 字符上限防恶意长 label 占满 prompt 预算
//
// 注意:HTML escape **不能**挡住自然语言 prompt injection
// (例如 label 写 "IGNORE PRIOR INSTRUCTIONS...")——这是 inherent limitation,
// 缓解依赖 AI 自身 instruction following 健壮性,在 PRD 范畴外。
//
// 详见 PRD §4.4。

const HTML_ESCAPE_MAP: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
};

const MAX_LABEL_LENGTH = 80;
const FALLBACK_LABEL = 'a session';

/**
 * Sanitize a raw label string for safe injection into prompt context.
 *
 * Returns `'a session'` if the input is null/undefined/empty after processing.
 *
 * **Order is slice → escape** (not escape → slice). Cross-review CC flagged that
 * the reverse order can mid-truncate an escape sequence (e.g. `&amp;` is 5 chars
 * → if escape grows length past the cap, the trailing chars become `&am` which
 * is an orphaned entity). Slicing raw input first guarantees escape output is
 * well-formed even if longer than the cap.
 */
export function sanitizeInboxLabel(raw: string | undefined | null): string {
  if (!raw) return FALLBACK_LABEL;

  const truncated = raw.slice(0, MAX_LABEL_LENGTH).trim();
  if (!truncated) return FALLBACK_LABEL;
  return truncated.replace(/[<>&"']/g, (c) => HTML_ESCAPE_MAP[c]!) || FALLBACK_LABEL;
}

/**
 * Neutralize structural inbox tags in a message body so the wrapping envelope
 * (`<inbox-message>...</inbox-message>` / `<inbox-reply>...</inbox-reply>`)
 * can't be prematurely closed or a fake sibling envelope injected by the
 * attacker-controlled body. Defense-in-depth — natural-language injection
 * inside the body is still possible (see sanitizeInboxLabel module comment).
 *
 * **Single source of truth.** Both `drain-handler.ts` (inbox path) and
 * `index.ts::buildCronEventPrompt` (cron→IM envelope) MUST import this
 * helper. Inline copies drift on the next defense extension (cross-review CC
 * HIGH #5 + Architecture M1).
 *
 * We don't full HTML-escape the body because that breaks legitimate markdown
 * (`<` `>` in code blocks). Only the structural tags this pipeline introduces
 * get rewritten. A defender can still see literal `&lt;/inbox-message&gt;` in
 * the body if the user really wrote it — that's transparency, not a bug.
 *
 * Defense covers (cross-review Codex Critical #2):
 *   - ASCII `<` / `>` (U+003C / U+003E)
 *   - Fullwidth `＜` / `＞` (U+FF1C / U+FF1E) — some tokenizers normalize
 *     these to ASCII, so the wrapper can be smuggled past a naive regex
 *   - Whitespace before the closing `>` (e.g. `</inbox-message  >`) — the
 *     XML spec tolerates trailing whitespace; a strict-`>` regex doesn't
 */
const TAG_BRACKET_OPEN = '[<\\uFF1C]';
const TAG_BRACKET_CLOSE = '[>\\uFF1E]';

export function neutralizeInboxStructuralTags(body: string): string {
  return body
    .replace(
      new RegExp(`${TAG_BRACKET_OPEN}/inbox-message\\s*${TAG_BRACKET_CLOSE}`, 'gi'),
      '&lt;/inbox-message&gt;',
    )
    .replace(
      new RegExp(`${TAG_BRACKET_OPEN}/inbox-reply\\s*${TAG_BRACKET_CLOSE}`, 'gi'),
      '&lt;/inbox-reply&gt;',
    )
    .replace(
      new RegExp(`${TAG_BRACKET_OPEN}inbox-message\\b`, 'gi'),
      '&lt;inbox-message',
    )
    .replace(
      new RegExp(`${TAG_BRACKET_OPEN}inbox-reply\\b`, 'gi'),
      '&lt;inbox-reply',
    );
}
