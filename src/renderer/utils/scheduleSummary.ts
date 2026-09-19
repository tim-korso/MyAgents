// scheduleSummary — human-readable schedule line for a Task, suitable
// for the preview overlay's SummaryCard.
//
// Why this lives here (not inlined in the overlay):
//   * cronstrue is async-imported so the bundle doesn't eagerly load it
//     for screens that never open the overlay.
//   * Every execution mode returns the same shape, so the consumer
//     just renders `title` (big) + optional `next` (small) without
//     branching in JSX.
//   * Tests can target this util directly.
//
// Design goal: answer the question "when will this fire next?" in one
// glance. Human-readable descriptions are local presentation; the next
// trigger instant always comes from the Rust Task scheduler.

import type { Task, TaskExecutionMode } from '@/../shared/types/task';
import { currentSupportedLocale, formatAbsoluteDateTime } from '@/i18n/format';
import { humanizeCron } from '@/utils/taskCenterUtils';
import type { SupportedLocale } from '../../shared/i18n';

export interface ScheduleSummary {
  /** Execution mode (passed through from the Task — consumer picks the icon). */
  mode: TaskExecutionMode;
  /** Primary one-line readout. Chinese, speakable. */
  title: string;
  /** Next-trigger line, when known. Empty for `once` / `loop` /
   *  past-due `scheduled`. */
  next?: string;
  /** IANA tz, surfaced only for cron-mode recurring with an explicit tz. */
  timezone?: string;
}

/**
 * Build a render-ready summary for the given task. `nextExecutionAtMs` is
 * optional because stats can be unavailable, but the renderer never derives
 * a replacement schedule instant.
 */
export async function summarizeSchedule(
  task: Task,
  nextExecutionAtMs?: number | null,
  locale: SupportedLocale = currentSupportedLocale(),
): Promise<ScheduleSummary> {
  const mode = task.executionMode;

  if (mode === 'once') {
    return { mode, title: locale === 'zh-CN' ? '一次性' : 'One-time' };
  }

  if (mode === 'loop') {
    return {
      mode,
      title: locale === 'zh-CN' ? '目标模式' : 'Goal Mode',
      next: locale === 'zh-CN'
        ? '连续执行，完成当前轮后进入下一轮'
        : 'Runs continuously; the next round starts after the current one finishes',
    };
  }

  if (mode === 'scheduled') {
    const at =
      task.dispatchAt ??
      task.endConditions?.deadline ??
      null;
    if (!at) {
      return { mode, title: locale === 'zh-CN' ? '定时一次 · 未设置时间' : 'Scheduled once · No time set' };
    }
    const when = new Date(at);
    const title = locale === 'zh-CN'
      ? `定时一次 · ${formatAbsolute(when, locale)}`
      : `Scheduled once · ${formatAbsolute(when, locale)}`;
    const delta = at - Date.now();
    const next = delta > 0
      ? (locale === 'zh-CN' ? `${formatRelativeFuture(delta, locale)}后触发` : `Triggers in ${formatRelativeFuture(delta, locale)}`)
      : (locale === 'zh-CN' ? '已过期' : 'Expired');
    return { mode, title, next };
  }

  // recurring
  if (task.cronExpression) {
    const expr = task.cronExpression.trim();
    // `cronExpression` can be `'   '` (all-whitespace from a half-edited
    // form) — empty after trim. Fall through to the `intervalMinutes`
    // branch (or "未设置") rather than showing "周期 · " with an empty
    // expression, which reads as a bug.
    if (expr.length === 0) {
      if (task.intervalMinutes) {
        const mins = task.intervalMinutes;
        return {
          mode,
          title: formatInterval(mins, locale),
          next: formatKnownNext(nextExecutionAtMs, locale),
        };
      }
      return { mode, title: locale === 'zh-CN' ? '周期 · 未设置' : 'Recurring · Not set' };
    }
    const tz = task.cronTimezone?.trim() || undefined;
    const title = await describeCron(expr, locale);
    const next = formatKnownNext(nextExecutionAtMs, locale);
    return {
      mode,
      title: title ?? (locale === 'zh-CN' ? `周期 · ${expr}` : `Recurring · ${expr}`),
      next,
      timezone: tz,
    };
  }

  if (task.intervalMinutes) {
    const mins = task.intervalMinutes;
    const title = formatInterval(mins, locale);
    const next = formatKnownNext(nextExecutionAtMs, locale);
    return { mode, title, next };
  }

  return { mode, title: locale === 'zh-CN' ? '周期 · 未设置' : 'Recurring · Not set' };
}

// ---------- formatters ----------

/** `4月21日 周一 11:00` — locale-aware, single line, no year when in 2026. */
function formatAbsolute(d: Date, locale: SupportedLocale): string {
  const now = new Date();
  return formatAbsoluteDateTime(d, locale, now);
}

/** `~13 小时` / `~5 分钟` / `~2 天` — rough, always positive. */
function formatRelativeFuture(deltaMs: number, locale: SupportedLocale): string {
  const mins = Math.round(deltaMs / 60_000);
  if (locale === 'en-US') {
    if (mins < 1) return 'less than 1 minute';
    if (mins < 60) return `about ${mins} minute${mins === 1 ? '' : 's'}`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `about ${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(hours / 24);
    return `about ${days} day${days === 1 ? '' : 's'}`;
  }
  if (mins < 1) return '不到 1 分钟';
  if (mins < 60) return `约 ${mins} 分钟`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `约 ${hours} 小时`;
  const days = Math.round(hours / 24);
  return `约 ${days} 天`;
}

function formatInterval(mins: number, locale: SupportedLocale): string {
  if (locale === 'en-US') {
    if (mins % (24 * 60) === 0) {
      const days = mins / (24 * 60);
      return `Every ${days} day${days === 1 ? '' : 's'}`;
    }
    if (mins % 60 === 0) {
      const hours = mins / 60;
      return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
    }
    return `Every ${mins} minute${mins === 1 ? '' : 's'}`;
  }
  if (mins % (24 * 60) === 0) return `每 ${mins / (24 * 60)} 天`;
  if (mins % 60 === 0) return `每 ${mins / 60} 小时`;
  return `每 ${mins} 分钟`;
}

async function describeCron(expr: string, locale: SupportedLocale): Promise<string | null> {
  // Prefer the "speakable Chinese" humanizer (shared with TaskCardItem) so
  // the card meta-row and the overlay headline read identically — "每天上午
  // 11 点" instead of cronstrue's stiff "在 8:00, 每天". humanizeCron
  // returns null for exotic cron shapes (ranges, steps, yearly), which
  // falls through to cronstrue as a best-effort translator.
  const human = humanizeCron(expr, locale);
  if (human) return human;
  try {
    const mod = await import('cronstrue/i18n');
    const toStr = mod.toString as (e: string, o?: Record<string, unknown>) => string;
    return toStr(expr, { locale: locale === 'zh-CN' ? 'zh_CN' : 'en' });
  } catch {
    return null;
  }
}

function formatKnownNext(
  nextExecutionAtMs?: number | null,
  locale: SupportedLocale = 'zh-CN',
): string | undefined {
  if (typeof nextExecutionAtMs === 'number' && nextExecutionAtMs > 0) {
    return formatNextAbs(nextExecutionAtMs, locale);
  }
  return undefined;
}

function formatNextAbs(ms: number, locale: SupportedLocale): string {
  const now = Date.now();
  const delta = ms - now;
  if (delta <= 0) return locale === 'zh-CN' ? '下次触发 即将发生' : 'Next trigger is imminent';
  return locale === 'zh-CN'
    ? `下次触发 ${formatAbsolute(new Date(ms), locale)} · ${formatRelativeFuture(delta, locale)}后`
    : `Next trigger ${formatAbsolute(new Date(ms), locale)} · in ${formatRelativeFuture(delta, locale)}`;
}
