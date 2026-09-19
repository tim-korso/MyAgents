import { randomUUID } from 'crypto';

import { cancellableFetch } from '../utils/cancellation';
import { buildReplyBody, type ReplyPayload } from './reply-deliver';
import { ackPendingSessionWatch, listPendingSessionWatches } from './watch-registry';
import type { PendingInboxMessage, DeliverOutcome } from './types';

export async function deliverSessionWatchEvents(
  currentSessionId: string,
  payload: ReplyPayload,
): Promise<void> {
  const watches = listPendingSessionWatches();
  if (watches.length === 0) return;

  const managementPort = process.env.MYAGENTS_MANAGEMENT_PORT;
  if (!managementPort) {
    console.error('[session-watch] MYAGENTS_MANAGEMENT_PORT not set — cannot push watch events');
    return;
  }

  const latestResult = buildReplyBody(payload);
  const isError = !!payload.error;

  for (const watch of watches) {
    if (watch.targetSessionId !== currentSessionId) {
      console.warn(
        `[session-watch] dropping watch ${watch.watchId}: target mismatch current=${currentSessionId} watch=${watch.targetSessionId}`,
      );
      ackPendingSessionWatch(watch.watchId);
      continue;
    }

    const eventId = randomUUID();
    const message: PendingInboxMessage = {
      messageId: eventId,
      fromSessionId: currentSessionId,
      fromLabel: watch.targetLabel,
      toSessionId: watch.watcherSessionId,
      text: latestResult,
      replyBack: false,
      timestampMs: Date.now(),
      kind: 'event',
      inReplyTo: null,
      sessionEvent: {
        version: 1,
        type: isError ? 'watch.error' : 'watch.completed',
        eventId,
        watchId: watch.watchId,
        sourceSessionId: currentSessionId,
        sourceLabel: watch.targetLabel,
        targetSessionId: watch.watcherSessionId,
        targetStateAtRegistration: watch.targetStateAtRegistration,
        finalState: isError ? 'error' : 'idle',
        terminalReason: payload.error?.code ?? 'completed',
        createdAt: new Date().toISOString(),
        latestResult,
      },
    };

    try {
      const resp = await cancellableFetch(
        `http://127.0.0.1:${managementPort}/api/inbox/deliver`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            resumeWorkspacePath: watch.watcherResumeWorkspacePath,
          }),
        },
        { timeoutMs: 30_000 },
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.warn(
          `[session-watch] management API ${resp.status} when pushing watch ${watch.watchId}: ${text.slice(0, 200)}`,
        );
        continue;
      }
      const json = (await resp.json().catch(() => null)) as
        | { ok: boolean; outcome?: DeliverOutcome }
        | null;
      if (!json?.ok || json.outcome?.status !== 'delivered') {
        console.warn(
          `[session-watch] watch ${watch.watchId} not delivered: ${JSON.stringify(json?.outcome)}`,
        );
        continue;
      }
      ackPendingSessionWatch(watch.watchId);
    } catch (err) {
      console.error('[session-watch] HTTP failure pushing watch event:', err);
    }
  }
}
