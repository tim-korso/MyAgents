// Parse a pasted session id out of the 历史对话 search box so the user can jump
// straight to a session by id (Issue #260). Handles the two shapes a user
// actually pastes:
//   1. a bare UUID            — "6ef8118a-abef-4c61-8b84-0f08e14a25b9"
//   2. the copy-button output — "SessionID: 6ef8118a-abef-4c61-8b84-0f08e14a25b9"
//      (SessionMenuButton.tsx writes exactly `SessionID: ${sessionId}`)
//
// Deliberately PRECISE, not fuzzy: it only matches when the trimmed query is
// *entirely* a session id (optionally behind the `SessionID:` label). A UUID
// merely appearing inside a longer phrase is left to normal full-text search,
// so a content search that happens to contain an id isn't hijacked into a jump.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `SessionID:` / `Session ID：` label, case-insensitive, ASCII or full-width
// colon, flexible spacing. Capture group = whatever follows.
const LABEL_RE = /^session\s*id\s*[:：]\s*(.+)$/i;

/**
 * Returns the lowercased session id if `query` is a pasted session id (bare or
 * `SessionID:`-prefixed), else null. Lowercased because session ids are UUID v4
 * (stored lowercase) — callers can compare exactly.
 */
export function parseSessionIdQuery(query: string): string | null {
    let s = query.trim();
    if (!s) return null;
    const labelled = LABEL_RE.exec(s);
    if (labelled) s = labelled[1].trim();
    return UUID_RE.test(s) ? s.toLowerCase() : null;
}
