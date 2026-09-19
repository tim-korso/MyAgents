import type { TFunction } from 'i18next';

import type { SupportedLocale } from '../../shared/i18n';
import type { CronSchedule, CronTask, CronTaskStatus } from '@/types/cronTask';

type TaskT = TFunction<'task'>;

function formatCompactDateTime(value: string, locale: SupportedLocale): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatCronIntervalLabel(minutes: number, t: TaskT): string {
  if (minutes < 60) {
    return t('cron.interval.minute', { count: minutes });
  }
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const hourLabel = t('cron.interval.hour', { count: hours });
    return mins > 0
      ? t('cron.interval.composite', { first: hourLabel, second: t('cron.interval.minute', { count: mins }) })
      : hourLabel;
  }
  const days = Math.floor(minutes / 1440);
  const remainingMins = minutes % 1440;
  const hours = Math.floor(remainingMins / 60);
  const dayLabel = t('cron.interval.day', { count: days });
  return hours > 0
    ? t('cron.interval.composite', { first: dayLabel, second: t('cron.interval.hour', { count: hours }) })
    : dayLabel;
}

export function formatCronStatusText(status: CronTaskStatus, t: TaskT): string {
  return status === 'running' ? t('cron.status.running') : t('cron.status.stopped');
}

export function formatCronScheduleDescription(
  task: Pick<CronTask, 'schedule' | 'intervalMinutes'>,
  t: TaskT,
  locale: SupportedLocale,
): string {
  if (task.schedule) {
    switch (task.schedule.kind) {
      case 'at':
        return t('cron.schedule.onceAt', { time: new Date(task.schedule.at).toLocaleString(locale) });
      case 'every':
        return t('cron.schedule.every', { interval: formatCronIntervalLabel(task.schedule.minutes, t) });
      case 'cron':
        return t('cron.schedule.cron', { expr: task.schedule.expr });
      case 'loop':
        return t('cron.schedule.loop');
    }
  }
  return t('cron.schedule.every', { interval: formatCronIntervalLabel(task.intervalMinutes, t) });
}

export function formatCronScheduleForStatusBar(
  schedule: CronSchedule | null | undefined,
  intervalMinutes: number,
  t: TaskT,
  locale: SupportedLocale,
): string {
  if (schedule) {
    switch (schedule.kind) {
      case 'at':
        return t('cron.statusBar.scheduleOnce', { time: new Date(schedule.at).toLocaleString(locale) });
      case 'every':
        return t('cron.statusBar.scheduleEvery', { interval: formatCronIntervalLabel(schedule.minutes, t) });
      case 'cron':
        return t('cron.schedule.cron', { expr: schedule.expr });
      case 'loop':
        return t('cron.schedule.loop');
    }
  }
  return t('cron.statusBar.scheduleEvery', { interval: formatCronIntervalLabel(intervalMinutes, t) });
}

export function formatCronExecutionCount(executionCount: number, t: TaskT, maxExecutions?: number): string {
  if (maxExecutions && maxExecutions > 0) {
    return t('cron.executionCountWithMax', { count: executionCount, max: maxExecutions });
  }
  return t('cron.executionCount', { count: executionCount });
}

export function formatCronCountdown(
  nextExecutionAt: string | null | undefined,
  now: number,
  t: TaskT,
): string | null {
  if (!nextExecutionAt) return null;
  const target = new Date(nextExecutionAt).getTime();
  if (!Number.isFinite(target)) return null;
  const remainingMs = target - now;
  if (remainingMs <= 0) return t('cron.nextExecution.waiting');

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const time = hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  return t('cron.nextExecution.nextCountdown', { time });
}

export function formatCronNextExecution(
  nextAt: string | undefined,
  status: CronTaskStatus,
  t: TaskT,
  locale: SupportedLocale,
): string {
  if (status === 'stopped') return t('cron.status.stopped');
  if (!nextAt) return '—';
  const date = new Date(nextAt);
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return t('cron.nextExecution.soon');
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return t('cron.nextExecution.lessThanMinute');
  if (diffMins < 60) {
    return t('cron.nextExecution.in', { duration: t('cron.interval.minute', { count: diffMins }) });
  }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return t('cron.nextExecution.in', { duration: t('cron.interval.hour', { count: diffHours }) });
  }
  return formatCompactDateTime(nextAt, locale);
}

export function formatCronResumeBlockReason(task: CronTask, t: TaskT): string | null {
  if (task.status !== 'stopped') return t('cron.resume.running');
  if (task.schedule?.kind === 'at' && task.executionCount > 0) return t('cron.resume.oneShotDone');
  if (task.endConditions.deadline && new Date(task.endConditions.deadline).getTime() <= Date.now()) {
    return t('cron.resume.deadlinePassed');
  }
  if (task.endConditions.maxExecutions != null && task.executionCount >= task.endConditions.maxExecutions) {
    return t('cron.resume.maxReached');
  }
  return null;
}

export function formatApproxFutureDistance(dateTime: string, t: TaskT): string {
  const diffMs = new Date(dateTime).getTime() - Date.now();
  if (diffMs <= 0) return t('cron.scheduleTabs.expired');
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return t('cron.interval.minute', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('cron.interval.hour', { count: hrs });
  return t('cron.interval.day', { count: Math.floor(hrs / 24) });
}
