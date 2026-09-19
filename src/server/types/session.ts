import type { SessionMessage, MessageUsage, SessionSource } from '../../shared/types/session-message';
export type { SessionMessage, MessageAttachment, MessageUsage, ModelUsageEntry, MessageSourceMetadata, SessionSource, TurnAnalyticsSource, RuntimeTurnAnchor } from '../../shared/types/session-message';
import { randomUUID } from 'crypto';
import type { RuntimeSource, RuntimeType } from '../../shared/types/runtime';
import type { ContextUsage } from '../../shared/types/context-usage';
import { deriveSessionTitle } from '../../shared/sessionTitle';
import type { ProviderRoute } from '../../shared/providerRoute';
import type { RuntimeBackedProviderIdentity } from '../../shared/providerExecution';
import type { SessionOrigin } from '../../shared/session-origin';
import type { SystemMaintenanceSessionKind } from '../../shared/managedScheduledJob';

/**
 * Session statistics for tracking usage
 */
export interface SessionStats {
    /** Legacy on-disk key. Counts persisted user-role turns; wire/UI expose turnCount. */
    messageCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens?: number;
    totalCacheCreationTokens?: number;
}

/**
 * Session metadata stored in sessions.json
 */
export interface SessionMetadata {
    id: string;
    /** Set only by the creation owner. Absence is the existing V1 contract. */
    transcriptFormat?: 2;
    agentDir: string;
    title: string;
    createdAt: string;
    lastActiveAt: string;
    /** Claude SDK execution identity. Usually equals id at birth; may diverge after execution-level reset. */
    sdkSessionId?: string;
    /** Legacy birth marker. When sdkSessionId is absent and true, id is the SDK candidate. */
    unifiedSession?: boolean;
    /** Session statistics */
    stats?: SessionStats;
    /** Associated cron task ID (if this session is used by a scheduled task) */
    cronTaskId?: string;
    /** Product-owned hidden maintenance marker. Ordinary automation sessions leave this unset. */
    systemMaintenanceKind?: SystemMaintenanceSessionKind;
    /** Legacy channel/source metadata; use `origin` for product/statistics origin. */
    source?: SessionSource;
    /** Stable product/statistics origin. This is the session birth fact; legacy `source` is channel metadata. */
    origin?: SessionOrigin;
    /** User-pinned to the 收藏 filter view in TaskCenterOverlay /
     *  SessionHistoryDropdown. Only `true` is persisted; absent/false has
     *  identical semantics, so the on-disk size cost is zero for the common
     *  case. */
    favorite?: boolean;
    /** User-pinned ordering inside the owning workspace's sidebar Session list.
     *  The server assigns a strictly increasing ISO timestamp; absent means unpinned. */
    pinnedAt?: string;
    /** User-managed global names used to organize Session history. */
    userTags?: string[];
    /** Preview of the last user message (truncated, for Task Center display) */
    lastMessagePreview?: string;
    /** How the title was set: default (first message truncation), auto (AI-generated), user (manually renamed) */
    titleSource?: 'default' | 'auto' | 'user';
    /** #296 — number of auto-title GENERATION attempts made for this session.
     *  Bounds retries (MAX_TITLE_GEN_ATTEMPTS): a session whose title-gen keeps
     *  failing won't re-fire on every subsequent turn. Absent = 0. Only the
     *  backend Title Service writes this. */
    titleGenAttempts?: number;
    /** Fork source info — consumed on first session startup, then cleared */
    forkFrom?: {
        sourceSessionId: string;  // Source session's SDK session ID (for resume)
        // Fork point: assistant message's sdkUuid (for resumeSessionAt).
        // Optional only for legacy records. New forks materialize native history before publication.
        messageUuid?: string;
    };
    /** Product identity of the exact fork request; retained for response reconciliation. */
    forkOrigin?: { sessionId: string; messageId: string };
    /** Exact builtin continuation boundary until the next successful turn. */
    sdkResumeSessionAt?: string;
    /** Which runtime created this session. Absent = 'builtin' (backward compatible) */
    runtime?: RuntimeType;
    /** Runtime source. Missing external Codex history is treated as 'system-cli'. */
    runtimeSource?: RuntimeSource;
    /** Runtime's own session/thread ID (Codex: threadId, CC: session_id from hook).
     *  Different from our session `id` — used for resume across Sidecar restarts. */
    runtimeSessionId?: string;
    /** Crash-recoverable, bounded commit intent for a conversation rewind. */
    pendingConversationMutation?: PendingConversationMutation;
    /** Runtime-level cumulative usage totals for restore-safe delta calculation. */
    runtimeUsageTotals?: MessageUsage;
    /**
     * PRD 0.2.32 — 上一轮结束时的 context 用量快照（与实时 chat:context-usage 广播同一个
     * 计算结果 = 单一数据源）。每轮末写入；重开会话时随 session metadata 返回，前端 seed 给
     * 指示器 → 环立即显示真实占用、且与会话期间显示的值一致。前端清空只动展示态，不删此持久值。
     */
    lastContextUsage?: ContextUsage;

    // ─── Session config snapshot (v0.1.69 layered-snapshot model) ───
    // Desktop/Cron owned sessions capture these at creation; pure IM sessions leave
    // them undefined on purpose (live-follow AgentConfig + ChannelOverrides).
    // Read path is authority-aware: owned sessions do NOT silently fall back to
    // Agent/Project defaults for missing fields; see resolveSessionConfig().

    /** Snapshot model name. For owned sessions, undefined means "not pinned". */
    model?: string;
    /** #324 — snapshot reasoning effort setting ('default' | level, see
     *  shared/reasoningEffort.ts). For owned sessions, undefined means default.
     *  The literal 'default' is persisted so a session can explicitly revert to
     *  default even when the agent-level value is non-default. */
    reasoningEffort?: string;
    /** Snapshot permission mode. For owned sessions, undefined means "not pinned". */
    permissionMode?: string;
    /** Snapshot MCP enabled list. For owned sessions, undefined means no session-local list. */
    mcpEnabledServers?: string[];
    /** Snapshot Claude cc-plugin enabled list. For owned sessions, undefined means no session-local list. */
    enabledPluginIds?: string[];
    /** Snapshot MyAgents official CLI tool enabled list. Separate from MCP/plugin ids. */
    enabledOfficialToolIds?: import('../../shared/official-tools').OfficialToolId[];
    /** Snapshot providerId. For owned sessions, undefined means "not pinned". */
    providerId?: string;
    /** Snapshot provider/model route identity. This is the canonical builtin provider identity. */
    providerRoute?: ProviderRoute;
    /** Provider-facing identity for runtime-backed providers such as Managed Codex. */
    providerExecutionIdentity?: RuntimeBackedProviderIdentity;
    /** Last time a legacy route was deterministically repaired. Diagnostic only. */
    providerRouteRepairedAt?: string;
    /** Snapshot provider env JSON (credentials). For owned sessions, undefined means re-resolve from providerId. */
    providerEnvJson?: string;
    /** ISO8601 snapshot creation timestamp. Presence marks "this session is locked" — used
     *  by scheduleDeferredRestart guards to skip sessions that own their own config. */
    configSnapshotAt?: string;

    /** Two-phase pending materialization marker. Prepared sessions are hidden
     *  from history until commit clears this marker; rollback/delete removes them. */
    materializationState?: 'prepared';
    /** Pending id that produced this prepared real session. Diagnostic only. */
    materializationSourceSessionId?: string;

    /**
     * Delayed Continue — set ONLY when the inactivity watchdog
     * (`agent-session.ts` setInterval at the watchdog block) aborts a turn
     * that produced at least one SDK event. The owning sidecar schedules an
     * automatic consume after the aborted subprocess terminates; the next
     * user-message enqueue into this session (Chat / IM / inbox / heartbeat /
     * cron-resume — any entry that funnels through `enqueueUserMessage`) can
     * also consume the flag as a crash/restart fallback. Consumption clears it
     * and pre-injects a single `<system-reminder>` turn asking the model to
     * resume from existing context.
     *
     * Clear-on-accept — set to `false` (or removed) after the reminder is
     * accepted into the right session's dispatch path, not after the reminder
     * turn completes. That guarantees **at most one** auto-Continue per abort,
     * even if the reminder turn itself watchdog-aborts. Other abort paths
     * (user ESC, config switch, provider switch, deferred restart, error
     * fallbacks) MUST NOT set this flag — the touchpoint is exactly one line
     * inside the watchdog callback.
     */
    pendingContinueAfterAbort?: boolean;
}

/**
 * Full session data including messages
 */
export interface SessionData extends SessionMetadata {
    messages: SessionMessage[];
    transcriptSaveStatus?: import('../../shared/sessionTranscript').TranscriptSaveStatus;
    transcriptRecovery?: 'incomplete' | 'unavailable';
}

export type PendingConversationMutation =
    | {
        schemaVersion: 1;
        kind: 'codex-rewind';
        sourceRuntimeSessionId: string;
        /** null means the replacement starts fresh on the next materialization. */
        replacementRuntimeSessionId: string | null;
        sourceMessageCount: number;
        targetMessageCount: number;
        transcript?: ConversationMutationTranscript;
    }
    | {
        schemaVersion: 1;
        kind: 'builtin-rewind';
        /** Effective Claude SDK binding before the rewind. Null means none was materialized. */
        sourceSdkSessionId: string | null;
        /** Claude SDK identity to create or resume at the persisted boundary. */
        replacementSdkSessionId: string;
        resumeSessionAt?: string;
        sourceMessageCount: number;
        targetMessageCount: number;
        transcript?: ConversationMutationTranscript;
    };

export interface ConversationMutationTranscript {
    format: 2;
    sourceGeneration: string;
    targetGeneration: string;
    targetRevision: number;
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate session title from first user message
 */
export function generateSessionTitle(message: string): string {
    // Route through the shared deriveSessionTitle so this path (the
    // "session created first, message sent later" flow via
    // updateSessionTitleFromMessage) strips the <system-reminder>/<CRON_TASK>/
    // <HEARTBEAT> wrapper before truncating — same as the other storage sites.
    // Previously a blind slice(0,20) stored a wrapper-only scrap for cron/IM
    // turns (cron-title fix). 40-char cap aligns with the sibling sites.
    return deriveSessionTitle(message, 40) || 'New Chat';
}

/**
 * Create a new session metadata object.
 *
 * Callers MUST build the `snapshot` argument from the paved helpers in
 * `src/server/utils/session-snapshot.ts` (`snapshotForImSession` /
 * `snapshotForOwnedSession`) — never hand-assemble snapshot fields here.
 * The helpers encode the owner-specific layered-snapshot policy (v0.1.69).
 *
 * Left unspecified, `runtime` defaults to 'builtin' (pit of success: no
 * null/undefined ambiguity on the always-present runtime field).
 */
const sessionBirths = new WeakSet<SessionMetadata>();

/** In-process birth provenance; deserialized metadata never authorizes a new file. */
export function ownsSessionMetadataBirth(metadata: SessionMetadata): boolean {
    return sessionBirths.has(metadata);
}

export function createSessionMetadata(
    agentDir: string,
    snapshot: Partial<SessionMetadata> = {},
): SessionMetadata {
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
        id: randomUUID(),
        agentDir,
        title: 'New Chat',
        createdAt: now,
        lastActiveAt: now,
        unifiedSession: true,
        runtime: 'builtin',
        ...snapshot,
        transcriptFormat: 2,
    };
    sessionBirths.add(metadata);
    return metadata;
}
