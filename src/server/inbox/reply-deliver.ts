// Session Inbox reply pushback (PRD 0.2.18 §5.5).
//
// 由 target sidecar 的 turn-end hook 调用:
//   - Builtin runtime: agent-session.ts SDK `result` event handler
//   - External runtime: external-session.ts persistTurnResult 之后
//   - Builtin abort path: abortPersistentSession() cleanup
//
// 流程:
//   1. 拿 turn-end 累积的 text(+ attachments + 可选 error)
//   2. 构造 PendingInboxMessage(kind=Reply, replyBack=false)
//   3. POST 到 Rust /api/inbox/deliver(同一个跨 sidecar 通道)
//   4. Rust 把 reply 推回 caller sidecar 的 /api/inbox/drain
//   5. Caller sidecar drain handler 用 MyAgents Session Event Protocol v1
//      的 send.result 注入 enqueueUserMessage
//   6. Caller AI 在下一个 turn 看到系统推送结果

import { randomUUID } from 'crypto';
import { cancellableFetch } from '../utils/cancellation';
import { sanitizeInboxLabel } from './sanitize-label';
import { deriveSessionLabel } from './derive-label';
import { getSessionMetadata, getSessionData } from '../SessionStore';
import type { InboxTurnMeta, PendingInboxMessage, DeliverOutcome } from './types';

/// Optional payload pieces to combine into reply text. Caller (turn-end hook)
/// passes what it has; this builder formats them into a single text blob.
export interface ReplyPayload {
  /** Combined text from all assistant text blocks this turn (\n\n joined). May be empty. */
  text: string;
  /** Optional error info — present when turn aborted / failed */
  error?: { code: string; message: string };
  /** Optional attachment hints (file paths or names) to mention in text. */
  attachmentHints?: string[];
}

/// Build the textual body of a result, embedding error + attachment hints inline.
/// This text becomes the payload inside a send.result session event.
export function buildReplyBody(payload: ReplyPayload): string {
  const lines: string[] = [];
  if (payload.error) {
    lines.push(`[ERROR ${payload.error.code}] ${payload.error.message}`);
    if (payload.text) lines.push(payload.text);
  } else if (payload.text) {
    lines.push(payload.text);
  } else {
    // Empty turn — let caller AI know target produced no text (e.g. pure tool-use)
    lines.push('(no text response)');
  }
  if (payload.attachmentHints && payload.attachmentHints.length > 0) {
    lines.push('', `Attachments: ${payload.attachmentHints.join(', ')}`);
  }
  return lines.join('\n');
}

async function getFirstUserMessageText(sessionId: string): Promise<string> {
  try {
    const data = (await getSessionData(sessionId));
    if (!data) return '';
    for (const msg of data.messages) {
      if (msg.role === 'user') {
        const content = msg.content;
        if (typeof content === 'string') return content;
        return '';
      }
    }
  } catch {
    // ignore
  }
  return '';
}

/// Main entry: push a reply back to caller.
///
/// `currentSessionId` is THIS sidecar's session id (the target session that
/// just finished a turn).
///
/// Returns true on successful delivery, false otherwise (errors are logged but
/// not thrown — fire-and-forget design).
export async function deliverInboxReply(
  currentSessionId: string,
  inboxMeta: InboxTurnMeta,
  payload: ReplyPayload,
): Promise<boolean> {
  // Derive reply sender label (= this session, the target that produced the reply)
  const myMeta = getSessionMetadata(currentSessionId) ?? null;
  const rawLabel = deriveSessionLabel(
    myMeta,
    myMeta ? await getFirstUserMessageText(currentSessionId) : undefined,
  );
  const fromLabel = sanitizeInboxLabel(rawLabel);

  const messageId = randomUUID();
  const text = buildReplyBody(payload);
  const createdAt = new Date().toISOString();
  const message: PendingInboxMessage = {
    messageId,
    fromSessionId: currentSessionId,
    fromLabel,
    toSessionId: inboxMeta.fromSessionId,
    text,
    replyBack: false, // 重要:reply 的 replyBack 恒为 false,避免无限往返
    timestampMs: Date.now(),
    kind: 'reply',
    inReplyTo: inboxMeta.originalSnippet,
    sessionEvent: {
      version: 1,
      type: 'send.result',
      eventId: messageId,
      requestEventId: inboxMeta.originalMessageId,
      sourceSessionId: currentSessionId,
      sourceLabel: fromLabel,
      targetSessionId: inboxMeta.fromSessionId,
      status: payload.error ? 'error' : 'ok',
      terminalReason: payload.error ? 'error' : 'completed',
      errorCode: payload.error?.code,
      createdAt,
      payload: text,
    },
  };

  // Resolve caller workspace path for resume (caller may have gone idle)
  const callerMeta = getSessionMetadata(inboxMeta.fromSessionId);
  const resumeWorkspacePath = callerMeta?.agentDir;

  const managementPort = process.env.MYAGENTS_MANAGEMENT_PORT;
  if (!managementPort) {
    console.error('[inbox/reply] MYAGENTS_MANAGEMENT_PORT not set — cannot push reply');
    return false;
  }

  try {
    const resp = await cancellableFetch(
      `http://127.0.0.1:${managementPort}/api/inbox/deliver`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          resumeWorkspacePath,
        }),
      },
      // Match Rust local_http::json_client 30s timeout.
      { timeoutMs: 30_000 },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(
        `[inbox/reply] management API ${resp.status} when pushing reply to ${inboxMeta.fromSessionId}: ${text.slice(0, 200)}`,
      );
      return false;
    }

    const json = (await resp.json().catch(() => null)) as
      | { ok: boolean; outcome?: DeliverOutcome }
      | null;
    if (!json?.ok) {
      console.warn(`[inbox/reply] management API returned ok=false for reply ${message.messageId}`);
      return false;
    }
    const outcome = json.outcome;
    if (outcome?.status === 'delivered') {
      console.log(
        `[inbox/reply] reply delivered to ${inboxMeta.fromSessionId} msg_id=${message.messageId} (in_reply_to msg ${inboxMeta.originalMessageId})`,
      );
      return true;
    }
    console.warn(
      `[inbox/reply] reply to ${inboxMeta.fromSessionId} not delivered: ${JSON.stringify(outcome)}`,
    );
    return false;
  } catch (err) {
    console.error('[inbox/reply] HTTP failure pushing reply:', err);
    return false;
  }
}
