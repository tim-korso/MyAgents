import { randomUUID } from 'crypto';

import { getSessionData, getSessionMetadata } from '../SessionStore';
import type { SessionMetadata } from '../types/session';
import { cancellableFetch } from '../utils/cancellation';
import { deriveSessionLabel } from './derive-label';
import { getLatestAssistantResultFromMessages } from './latest-result';
import { renderSessionEventPrompt } from './session-event';
import { sanitizeInboxLabel } from './sanitize-label';
import type { SessionEvent } from './session-event';

export interface AdminSessionWatchRequest {
  targetSessionId: string;
}

export interface AdminSessionWatchResponse {
  watched: boolean;
  watchId?: string;
  targetSessionId?: string;
  targetStateAtRegistration?: string;
  delivery?: 'registered' | 'already_idle' | 'error';
  eventPrompt?: string;
  error?: { code: string; message: string };
}

interface ManagementWatchResult {
  watchId: string;
  targetSessionId: string;
  targetStateAtRegistration: string;
  delivery: 'registered' | 'already_idle' | 'error' | 'not_found';
  finalState?: string;
  terminalReason?: string;
  latestResult?: string;
}

interface ManagementWatchApiResponse {
  ok: boolean;
  result?: ManagementWatchResult;
  error?: string;
}

async function getFirstUserMessageText(sessionId: string): Promise<string> {
  try {
    const data = (await getSessionData(sessionId));
    if (!data) return '';
    for (const msg of data.messages) {
      if (msg.role === 'user') return msg.content;
    }
  } catch {
    // ignore metadata fallback failures
  }
  return '';
}

async function deriveLabel(sessionId: string, meta: SessionMetadata | null): Promise<string> {
  const raw = deriveSessionLabel(
    meta,
    meta ? await getFirstUserMessageText(sessionId) : undefined,
  );
  return sanitizeInboxLabel(raw);
}

async function latestResultForSession(sessionId: string): Promise<string> {
  const data = (await getSessionData(sessionId));
  return data ? getLatestAssistantResultFromMessages(data.messages) : '(no text response)';
}

function buildWatchEventPrompt(params: {
  type: 'watch.already_idle' | 'watch.error';
  watchId: string;
  targetSessionId: string;
  targetLabel: string;
  watcherSessionId: string;
  targetStateAtRegistration: string;
  finalState?: string;
  terminalReason?: string;
  latestResult: string;
}): string {
  const event: SessionEvent = {
    version: 1,
    type: params.type,
    eventId: randomUUID(),
    watchId: params.watchId,
    sourceSessionId: params.targetSessionId,
    sourceLabel: params.targetLabel,
    targetSessionId: params.watcherSessionId,
    targetStateAtRegistration: params.targetStateAtRegistration,
    finalState: params.finalState,
    terminalReason: params.terminalReason,
    createdAt: new Date().toISOString(),
    latestResult: params.latestResult,
  };
  return renderSessionEventPrompt(event);
}

export async function handleAdminSessionWatch(
  watcherSessionId: string,
  body: AdminSessionWatchRequest,
): Promise<{ status: number; response: AdminSessionWatchResponse }> {
  const targetSessionId = body.targetSessionId;
  if (!targetSessionId || typeof targetSessionId !== 'string') {
    return {
      status: 400,
      response: {
        watched: false,
        error: { code: 'invalid_args', message: 'targetSessionId is required' },
      },
    };
  }
  if (!watcherSessionId) {
    return {
      status: 500,
      response: {
        watched: false,
        error: { code: 'watch_failed', message: 'caller sidecar has no session id (not initialized)' },
      },
    };
  }
  if (targetSessionId === watcherSessionId) {
    return {
      status: 400,
      response: {
        watched: false,
        error: { code: 'invalid_args', message: 'cannot watch self' },
      },
    };
  }

  const targetMeta = getSessionMetadata(targetSessionId);
  // Only Rust can decide whether a target owned by another Sidecar exists.
  // Its active V2 metadata may not yet be visible in this process's index.

  const watcherMeta = getSessionMetadata(watcherSessionId);
  const watchId = randomUUID();
  const targetLabel = await deriveLabel(targetSessionId, targetMeta);
  const managementPort = process.env.MYAGENTS_MANAGEMENT_PORT;
  if (!managementPort) {
    return {
      status: 500,
      response: {
        watched: false,
        watchId,
        targetSessionId,
        error: { code: 'watch_failed', message: 'MYAGENTS_MANAGEMENT_PORT not set' },
      },
    };
  }

  let mgmt: ManagementWatchApiResponse | null = null;
  try {
    const resp = await cancellableFetch(
      `http://127.0.0.1:${managementPort}/api/session/watch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          watchId,
          watcherSessionId,
          watcherResumeWorkspacePath: watcherMeta?.agentDir,
          targetSessionId,
          targetLabel,
        }),
      },
      { timeoutMs: 30_000 },
    );
    mgmt = await resp.json().catch(() => null) as ManagementWatchApiResponse | null;
    if (!resp.ok || !mgmt?.ok || !mgmt.result) {
      const message = mgmt?.error ?? `management API ${resp.status}`;
      return {
        status: 502,
        response: {
          watched: false,
          watchId,
          targetSessionId,
          error: { code: 'watch_failed', message },
        },
      };
    }
  } catch (err) {
    return {
      status: 502,
      response: {
        watched: false,
        watchId,
        targetSessionId,
        error: {
          code: 'watch_failed',
          message: `management API unreachable: ${err instanceof Error ? err.message : String(err)}`,
        },
      },
    };
  }

  const result = mgmt.result;
  if (result.delivery === 'not_found') {
    return { status: 404, response: { watched: false, targetSessionId,
      error: { code: 'session_not_found', message: `target session ${targetSessionId} not found` } } };
  }
  if (result.delivery === 'already_idle' || result.delivery === 'error') {
    const latestResult = result.latestResult?.trim() || await latestResultForSession(targetSessionId);
    const eventPrompt = buildWatchEventPrompt({
      type: result.delivery === 'already_idle' ? 'watch.already_idle' : 'watch.error',
      watchId: result.watchId,
      targetSessionId,
      targetLabel,
      watcherSessionId,
      targetStateAtRegistration: result.targetStateAtRegistration,
      finalState: result.finalState,
      terminalReason: result.terminalReason,
      latestResult,
    });
    return {
      status: 200,
      response: {
        watched: result.delivery !== 'error',
        watchId: result.watchId,
        targetSessionId,
        targetStateAtRegistration: result.targetStateAtRegistration,
        delivery: result.delivery,
        eventPrompt,
      },
    };
  }

  return {
    status: 200,
    response: {
      watched: true,
      watchId: result.watchId,
      targetSessionId,
      targetStateAtRegistration: result.targetStateAtRegistration,
      delivery: 'registered',
    },
  };
}
