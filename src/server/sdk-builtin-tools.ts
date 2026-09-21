/**
 * MyAgents' product-owned Claude Agent SDK builtin catalog.
 *
 * This is deliberately separate from permission policy: exposing a tool to the
 * model does not auto-approve it. Keeping an explicit catalog also prevents a
 * Claude Code patch from silently adding a new builtin with no MyAgents owner.
 */
export const SDK_BUILTIN_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'Bash',
  'PowerShell',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'Skill',
  'Agent',
  'Task',
  'TaskStop',
  'SendMessage',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'Monitor',
  'ReportFindings',
  'Workflow',
  'ScheduleWakeup',
  'EnterWorktree',
  'ExitWorktree',
] as const;

export const SDK_EXCLUDED_BUILTIN_TOOLS = [
  'CronCreate',
  'CronDelete',
  'CronList',
  'PushNotification',
  'DesignSync',
] as const;

/**
 * Tools a session cannot function without.
 *
 * A narrowed surface is a deliberate choice, but dropping these produces a
 * session that opens, accepts a message, and then cannot read, run, or reply —
 * which reads as a hang rather than a misconfiguration. Keeping them regardless
 * of the allowlist makes a bad allowlist merely restrictive instead of broken.
 */
const TOOL_SURFACE_FLOOR = ['Read', 'Bash', 'Edit', 'Write'] as const;

/**
 * Resolve the tool surface for a session.
 *
 * Returns the product default catalog unless an allowlist is configured. The
 * allowlist is intersected with the catalog (a name outside it is ignored
 * rather than forwarded, so config cannot inject an unknown tool), and the
 * floor is always re-added. An allowlist that resolves to nothing usable falls
 * back to the default catalog — see the `builtinToolAllowlist` doc for why
 * "empty" must never mean "no tools".
 */
export function resolveBuiltinToolSurface(allowlist?: readonly string[] | null): string[] {
  if (!allowlist || allowlist.length === 0) return [...SDK_BUILTIN_TOOLS];

  const allowed = new Set(SDK_BUILTIN_TOOLS as readonly string[]);
  const selected = allowlist.filter((name) => allowed.has(name));
  for (const floorTool of TOOL_SURFACE_FLOOR) {
    if (!selected.includes(floorTool)) selected.push(floorTool);
  }
  // Preserve the catalog's canonical order so the emitted schema is stable
  // across runs (tool order is part of the prompt prefix, and a reordered
  // prefix would defeat provider-side prompt caching).
  const chosen = new Set(selected);
  return SDK_BUILTIN_TOOLS.filter((name) => chosen.has(name));
}
