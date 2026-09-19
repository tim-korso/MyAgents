import { useEffect, useMemo, useState } from 'react';
import { Settings2, Square, Timer, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CronSchedule } from '@/types/cronTask';
import { isSupportedLocale } from '@/../shared/i18n';
import {
  formatCronCountdown,
  formatCronExecutionCount,
  formatCronScheduleForStatusBar,
} from '@/utils/cronTaskI18n';

type CronTaskStatusBarMode = 'draft' | 'running' | 'executing' | 'stopped';

interface CronTaskStatusBarProps {
  mode?: CronTaskStatusBarMode;
  intervalMinutes: number;
  schedule?: CronSchedule | null;
  executionCount?: number;
  maxExecutions?: number;
  nextExecutionAt?: string | null;
  executionNumber?: number;
  onSettings?: () => void;
  onCancel?: () => void;
  onStop?: () => void;
  onDismissStopped?: () => void;
}

export default function CronTaskStatusBar({
  mode = 'draft',
  intervalMinutes,
  schedule,
  executionCount = 0,
  maxExecutions,
  nextExecutionAt,
  executionNumber,
  onSettings,
  onCancel,
  onStop,
  onDismissStopped,
}: CronTaskStatusBarProps) {
  const { t, i18n } = useTranslation('task');
  const locale = isSupportedLocale(i18n.language) ? i18n.language : 'zh-CN';
  const [now, setNow] = useState(() => Date.now());
  const active = mode === 'running' || mode === 'executing';

  useEffect(() => {
    if (!active || !nextExecutionAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, nextExecutionAt]);

  const countdown = useMemo(
    () => mode === 'running' ? formatCronCountdown(nextExecutionAt, now, t) : null,
    [mode, nextExecutionAt, now, t],
  );
  const title = mode === 'draft'
      ? t('cron.statusBar.draftTitle')
      : mode === 'stopped'
        ? t('cron.statusBar.stoppedTitle')
        : mode === 'executing'
          ? t('cron.statusBar.executingTitle')
          : t('cron.statusBar.runningTitle');
  const scheduleText = schedule?.kind === 'loop'
    ? t('cron.statusBar.legacyLoopSchedule')
    : formatCronScheduleForStatusBar(schedule, intervalMinutes, t, locale);
  const detail = mode === 'stopped'
    ? t('cron.statusBar.stoppedDetail')
    : [
        scheduleText,
        mode === 'executing'
          ? t('cron.statusBar.roundExecuting', { count: executionNumber ?? executionCount + 1 })
          : countdown,
        active ? formatCronExecutionCount(executionCount, t, maxExecutions) : null,
      ].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center justify-between gap-3 rounded-t-lg border border-b-0 border-[var(--heartbeat-border)] bg-[var(--heartbeat-bg)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative shrink-0">
          <Timer className={`h-4 w-4 text-[var(--heartbeat)] ${mode === 'stopped' ? 'opacity-60' : ''}`} />
          {mode === 'executing' && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--heartbeat)] opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--heartbeat)]" />
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm font-medium text-[var(--heartbeat)]">{title}</span>
        <span className="min-w-0 truncate text-sm text-[var(--ink-muted)]">{detail}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {mode === 'draft' && onSettings && (
          <button
            type="button"
            onClick={onSettings}
            className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-hover)] hover:text-[var(--heartbeat)]"
            title={t('cron.statusBar.settingsTitle')}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        )}
        {mode === 'draft' && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-hover)] hover:text-[var(--heartbeat)]"
            title={t('cron.statusBar.cancelTitle')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {active && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--heartbeat)] transition hover:bg-[var(--paper-hover)]"
            title={t('cron.statusBar.stopTitle')}
          >
            <Square className="h-3.5 w-3.5" />
            {t('cron.statusBar.stopButton')}
          </button>
        )}
        {mode === 'stopped' && onDismissStopped && (
          <button
            type="button"
            onClick={onDismissStopped}
            className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-hover)] hover:text-[var(--heartbeat)]"
            title={t('cron.statusBar.dismissStoppedTitle')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
