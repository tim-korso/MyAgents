// Derive a human-readable label for the caller session (PRD 0.2.18 §3.3).
//
// 优先级链:
//   1. Cron task session(metadata.cronTaskId 存在)→ "Cron: <title>"
//   2. IM Bot session(source 非 'desktop')→ "[<platform>] <title>"
//   3. 桌面 session(用户重命名过)→ title 本身
//   4. 桌面 session(未命名,title 仍是 'New Chat')→ "桌面对话"
//      或第一条 user message 摘要前 30 字
//   5. fallback → "a session"
//
// 注意:返回前 **不** 做 sanitize——本 helper 只负责"推导原始 label",
// sanitize 由调用方在注入 prompt 前统一通过 `sanitizeInboxLabel()` 处理。
// 这样 sanitize 集中点只有一个,避免遗漏。

import type { SessionMetadata } from '../types/session';

const FALLBACK_LABEL = 'a session';
const NEW_CHAT_TITLE = 'New Chat';
const UNNAMED_DESKTOP_LABEL = '桌面对话';
const SUMMARY_LENGTH = 30;

/**
 * Derive a label from session metadata + optional first user message snippet.
 *
 * @param meta Session metadata (from `getSessionMetadata(sessionId)`)
 * @param firstUserMessage Optional first user message text — used only for
 *   未命名桌面 session 的 fallback。Caller 在已有数据时传入即可,不传则
 *   未命名桌面 session 一律回 "桌面对话"。
 */
export function deriveSessionLabel(
  meta: SessionMetadata | null | undefined,
  firstUserMessage?: string,
): string {
  if (!meta) return FALLBACK_LABEL;

  // Priority 1: Cron task session
  if (meta.cronTaskId) {
    const cronTitle = meta.title?.trim();
    if (cronTitle && cronTitle !== NEW_CHAT_TITLE) {
      return `Cron: ${cronTitle}`;
    }
    return `Cron task ${meta.cronTaskId.slice(0, 8)}`;
  }

  // Priority 2: IM Bot session (source like 'feishu_private', 'telegram_group', etc.)
  if (meta.source && meta.source !== 'desktop') {
    const [platform] = meta.source.split('_');
    const imTitle = meta.title?.trim();
    if (imTitle && imTitle !== NEW_CHAT_TITLE) {
      return `[${platform}] ${imTitle}`;
    }
    return `[${platform}] session`;
  }

  // Priority 3: 桌面 session — user renamed
  const title = meta.title?.trim();
  if (title && title !== NEW_CHAT_TITLE) {
    return title;
  }

  // Priority 4: 桌面 session — unnamed
  if (firstUserMessage) {
    const snippet = firstUserMessage.trim().slice(0, SUMMARY_LENGTH);
    if (snippet) {
      const suffix = firstUserMessage.length > SUMMARY_LENGTH ? '...' : '';
      return `${snippet}${suffix}`;
    }
  }
  return UNNAMED_DESKTOP_LABEL;
}
