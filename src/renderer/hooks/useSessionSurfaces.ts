/**
 * useSessionSurfaces — derive the active "surfaces" (channel + cron) of a session.
 *
 * A surface is anything that can drive messages into a session besides the
 * desktop tab itself: an IM channel binding, a cron task. The hook is pure —
 * caller supplies the data sources (already polled elsewhere via
 * `useAgentStatuses` and the existing `cronState`), the hook just joins them.
 *
 * Used by Chat.tsx top bar to render `●飞书` / `●定时` pills, and by Phase B
 * handover logic to decide button visibility.
 */

import { useMemo } from 'react';

import { extractPlatformDisplay } from '@/utils/taskCenterUtils';
import type { ActiveSessionData, AgentStatusMap, ChannelStatusData } from '@/hooks/useAgentStatuses';
import type { CronTask } from '@/types/cronTask';

export interface ChannelSurface {
    agentId: string;
    agentName: string;
    channelId: string;
    /** Raw channel type, e.g. `feishu`, `telegram`, `openclaw:wecom` */
    channelType: string;
    /** Channel display name (bot username / configured name / platform label) */
    channelName: string;
    /** Original sessionKey from peer_sessions binding (for handover commands) */
    sessionKey: string;
    sourceType: ActiveSessionData['sourceType'];
    sourceId?: string;
    sourceDisplayName?: string;
    /** Localized label, e.g. `飞书`, `Telegram`, `企业微信` */
    platformLabel: string;
    /** Connection status — only `online` and `connecting` produce surfaces */
    status: ChannelStatusData['status'];
}

export interface CronSurface {
    taskId: string;
    /** `running` | `paused` | `pending` etc. */
    status: string;
}

export interface SessionSurfaces {
    channel: ChannelSurface | null;
    cron: CronSurface | null;
}

/**
 * Resolve the channel + cron surfaces of a session.
 *
 * - `channel` is non-null iff some Agent's online/connecting channel currently
 *   has `peer_sessions[*].session_id == sessionId` (looked up via the
 *   `cmd_all_agents_status` snapshot).
 * - `cron` is non-null iff the supplied `cronTask` matches the session by
 *   `sessionId` or `internalSessionId`.
 *
 * Memoized on inputs — safe to call every render.
 */
export function useSessionSurfaces(
    sessionId: string | null,
    agentStatuses: AgentStatusMap,
    cronTask: CronTask | null | undefined,
): SessionSurfaces {
    return useMemo(() => {
        if (!sessionId) return { channel: null, cron: null };

        let channel: ChannelSurface | null = null;
        outer: for (const agent of Object.values(agentStatuses)) {
            for (const ch of agent.channels) {
                if (ch.status !== 'online' && ch.status !== 'connecting') continue;
                for (const sess of ch.activeSessions) {
                    if (sess.sessionId === sessionId) {
                        channel = {
                            agentId: agent.agentId,
                            agentName: agent.agentName,
                            channelId: ch.channelId,
                            channelType: ch.channelType,
                            channelName: ch.botUsername || ch.name || ch.channelType,
                            sessionKey: sess.sessionKey,
                            sourceType: sess.sourceType,
                            sourceId: sess.sourceId,
                            sourceDisplayName: sess.sourceDisplayName,
                            platformLabel: extractPlatformDisplay(sess.sessionKey),
                            status: ch.status,
                        };
                        break outer;
                    }
                }
            }
        }

        const cronSessionMatches = cronTask
            && (cronTask.sessionId === sessionId || cronTask.internalSessionId === sessionId);
        const cron: CronSurface | null = cronSessionMatches
            ? { taskId: cronTask.id, status: cronTask.status }
            : null;

        return { channel, cron };
    }, [sessionId, agentStatuses, cronTask]);
}
