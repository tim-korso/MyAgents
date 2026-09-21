/**
 * Turn-level outline for a conversation.
 *
 * Purpose: make a long session navigable and, more importantly, *greppable by
 * meaning*. A user scrolling a 200-message session is looking for "the turn
 * where I asked about the migration", not for message #147. Deriving the
 * outline from the same data the transcript already has keeps it a pure
 * projection — no extra storage, no drift when a message is edited.
 *
 * Kept runtime-agnostic: only `id`, `role`, and the text/thinking shape are
 * read, so it works for builtin, codex, and external runtimes alike.
 */
import type { Message } from '@/types/chat';

export interface ChatOutlineEntry {
  /** Message id — the anchor a jump scrolls to. */
  id: string;
  /** 1-based position among user turns, so the UI can label "turn 3". */
  turnIndex: number;
  /** Single-line preview of what the user asked. */
  preview: string;
  /** Timestamp when known, used for the secondary label. */
  timestamp?: number;
}

/** Collapse whitespace and clip, so every entry occupies exactly one line. */
function toPreview(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Extract the searchable text of a message.
 *
 * Deliberately excludes thinking and tool payloads: a turn is identified by
 * what the user asked, and folding reasoning into the preview would push the
 * actual question out of the 80-char budget while adding nothing scannable.
 */
export function messageOutlineText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join(' ');
}

/**
 * One entry per user turn — the natural unit of "what was I doing here".
 *
 * Assistant messages are intentionally not listed: they are the answer to a
 * user turn, so listing both would double the index without adding a way to
 * find anything new. Messages with no extractable text are skipped rather than
 * rendered as blank rows.
 */
export function buildChatOutline(messages: readonly Message[]): ChatOutlineEntry[] {
  const entries: ChatOutlineEntry[] = [];
  let turnIndex = 0;
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = messageOutlineText(message);
    const preview = toPreview(text);
    if (!preview) continue;
    turnIndex += 1;
    entries.push({
      id: message.id,
      turnIndex,
      preview,
      ...(message.timestamp ? { timestamp: message.timestamp.getTime?.() ?? undefined } : {}),
    });
  }
  return entries;
}

/**
 * Index of the entry a scroll offset currently sits in, for highlighting the
 * active turn.
 *
 * `tops` are viewport-relative positions aligned with `entries`. The active
 * entry is the last one whose top has passed the reading line — i.e. what the
 * user is reading now — rather than the first fully visible one, which flips
 * a full entry late.
 */
export function activeOutlineIndex(tops: readonly number[], readingLinePx = 160): number {
  let active = -1;
  for (let i = 0; i < tops.length; i += 1) {
    const top = tops[i];
    if (typeof top === 'number' && top < readingLinePx) active = i;
  }
  return active;
}
