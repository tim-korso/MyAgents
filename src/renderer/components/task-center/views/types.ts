// Shared row-model types for the task panel views. Both TaskCardItem and
// TaskListRow render either a native Task or a legacy cron surfaced via
// PRD §11.4; this file owns the legacy shape so the view components
// don't import from the parent panel.

export interface LegacyCronRow {
  id: string;
  name: string;
  status: 'running' | 'stopped';
  /**
   * True when the cron ended naturally — end-conditions triggered, AI
   * self-exit, or a scheduled one-shot ran. We distinguish these from
   * user-paused crons (status=stopped without `exit_reason`) so the
   * bucket logic can route "completed" into `已完成` instead of
   * `待启动`. Derived from `CronTask.exit_reason` being Some(_).
   */
  /** Raw CronTask object — forwarded to LegacyCronOverlay on click. */
  raw: Record<string, unknown>;
  workspacePath: string;
  updatedAt: number;
}
