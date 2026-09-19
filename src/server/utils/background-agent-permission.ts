/**
 * Background-agent permission policy (issue #264) — pure decision core.
 *
 * WHY THIS EXISTS
 * ---------------
 * When the SDK Agent/Task tool runs with `run_in_background: true`, the
 * resulting sub-agent is "async": the SDK marks its permission context with
 * `shouldAvoidPermissionPrompts` and resolves tool permissions **entirely
 * inside the CLI subprocess**. Runtime-verified facts (SDK 0.2.119):
 *   - A background sub-agent's gated tool call NEVER reaches our `canUseTool`
 *     callback (so we cannot gate it there — we are simply not called).
 *   - Instead the SDK fires the `PermissionRequest` hook, passing `agent_id`
 *     (== the background task_id) and `agent_type`. If no hook grants it, the
 *     SDK auto-denies → the agent can only report "permission denied" and the
 *     delegated work silently fails. That is exactly the #264 symptom.
 *   - A `PermissionRequest` hook that returns `{behavior:'allow'}` DOES let the
 *     background tool run; returning nothing falls through to the auto-deny.
 *
 * Foreground tools (main thread + *synchronous* sub-agents) still flow through
 * `canUseTool` as before — the hook also fires for them, but this core returns
 * `passthrough` so the existing interactive card path stays authoritative and
 * unchanged. We only ever ACT on a confirmed background sub-agent.
 *
 * This module is the pure decision function (no I/O) so it can be unit-tested
 * in the fast pool; the imperative shell (reading `sessionAlwaysAllowed`, the
 * background-task set, broadcasting) lives in agent-session.ts.
 */

import type { BackgroundAgentPermissionMode } from '../../shared/config-types';

export type { BackgroundAgentPermissionMode };

/**
 * Default policy: inherit the user's session-scoped "always allow" grants —
 * i.e. anything the user already clicked "始终允许" on works in the background
 * too — but nothing wider. Ungranted tools are denied with a clear, actionable
 * message instead of the SDK's opaque auto-deny. 'fullAgency' (opt-in) widens
 * the background lane to every non-interaction tool. Never inferred from the
 * model's `run_in_background` choice — only from this explicit user setting.
 */
export const DEFAULT_BACKGROUND_AGENT_PERMISSION_MODE: BackgroundAgentPermissionMode = 'inherit';

/** Tools that require a human and can never be auto-resolved in a headless background context. */
export const BACKGROUND_BLOCKED_USER_INTERACTION_TOOLS = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'] as const;

/**
 * The security-critical discriminator: a tool request belongs to a background
 * sub-agent iff the SDK gave us an `agent_id` that matches a currently-running
 * background task (task_id === agent_id). A foreground sync sub-agent also has
 * an agent_id but is NOT in the running-background set → returns false → the
 * hook passes through and the normal canUseTool path stays authoritative.
 *
 * `runningBackgroundTaskIds` is structurally `{ has(key) }` so the caller can
 * pass either the `startedBackgroundTasks` Map or a Set.
 */
export function isBackgroundAgentToolRequest(
  agentId: string | undefined | null,
  runningBackgroundTaskIds: { has(key: string): boolean },
): boolean {
  return !!agentId && runningBackgroundTaskIds.has(agentId);
}

export type BackgroundPermissionDecision = 'allow' | 'deny' | 'passthrough';

export interface BackgroundPermissionInput {
  /** True only when the request is from a confirmed background (async) sub-agent. */
  isBackgroundAgent: boolean;
  /** The tool being requested (e.g. 'Bash', 'WebFetch'). */
  toolName: string;
  /** Whether the user already granted this tool name via session "always allow". */
  sessionAllowsTool: boolean;
  /** The configured background-agent policy. */
  policy: BackgroundAgentPermissionMode;
}

/**
 * Decide what to do with a `PermissionRequest` hook event.
 *
 * Returns:
 *   - `'passthrough'` — not a background agent; do nothing and let the normal
 *     `canUseTool` / interactive path own the decision.
 *   - `'allow'` — grant the tool (inherited grant, or opted-in autonomy).
 *   - `'deny'`  — refuse; the shell attaches an actionable message.
 */
export function decideBackgroundAgentPermission(input: BackgroundPermissionInput): BackgroundPermissionDecision {
  // Only ever act on a confirmed background sub-agent. Main thread and
  // synchronous (foreground) sub-agents keep using canUseTool unchanged.
  if (!input.isBackgroundAgent) return 'passthrough';

  // User-interaction tools require a human; a headless background lane can't
  // satisfy them regardless of policy.
  if ((BACKGROUND_BLOCKED_USER_INTERACTION_TOOLS as readonly string[]).includes(input.toolName)) {
    return 'deny';
  }

  // Inherit the user's already-granted session permissions (the #264 ask).
  // This is intentionally checked before the policy branch so that even in
  // 'inherit' mode a previously "always allowed" tool runs in the background.
  if (input.sessionAllowsTool) return 'allow';

  // Opt-in autonomy: the user explicitly widened the background lane.
  if (input.policy === 'fullAgency') return 'allow';

  // Default: deny, but the caller surfaces a clear message so the agent can
  // report *why* and what the user can do about it.
  return 'deny';
}

/** Human-facing denial message routed back to the model via the hook's deny.message. */
export function backgroundAgentDenyMessage(toolName: string): string {
  return (
    `后台 Agent 无法交互式获取「${toolName}」工具的授权（后台任务没有权限弹窗）。` +
    `可选方案：① 在前台直接运行该任务；② 预先对「${toolName}」点击"始终允许"，后台 Agent 会继承该授权；` +
    `③ 在设置中将"后台 Agent 权限"调为全自动（fullAgency）。`
  );
}
