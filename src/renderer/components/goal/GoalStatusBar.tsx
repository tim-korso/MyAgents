import { Flag, Play, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SessionGoal } from '@/types/sessionGoal';
import { formatDuration, formatTokens } from '@/utils/formatTokens';

interface GoalDraftStatusBarProps {
  mode: 'draft';
  onSettings?: () => void;
  onCancel?: () => void;
}

interface GoalRuntimeStatusBarProps {
  mode?: 'runtime';
  goal: SessionGoal;
  isExecuting?: boolean;
  executionNumber?: number;
  onEdit?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onDismiss?: () => void;
}

type GoalStatusBarProps = GoalDraftStatusBarProps | GoalRuntimeStatusBarProps;

function GoalDraftStatusBar({ onSettings, onCancel }: GoalDraftStatusBarProps) {
  const { t } = useTranslation('task');

  return (
    <div className="flex items-center justify-between gap-3 rounded-t-lg border border-b-0 border-[var(--heartbeat-border)] bg-[var(--heartbeat-bg)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Flag className="h-4 w-4 shrink-0 text-[var(--heartbeat)]" />
        <span className="shrink-0 text-sm font-medium text-[var(--heartbeat)]">
          {t('cron.statusBar.goalDraftTitle')}
        </span>
        <span className="min-w-0 truncate text-sm text-[var(--ink-muted)]">
          {t('cron.statusBar.goalObjectiveFallback')}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-hover)] hover:text-[var(--heartbeat)]"
            title={t('cron.statusBar.settingsTitle')}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-hover)] hover:text-[var(--heartbeat)]"
            title={t('cron.statusBar.cancelGoalDraftTitle')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function GoalRuntimeStatusBar({
  goal,
  isExecuting = false,
  executionNumber,
  onEdit,
  onResume,
  onCancel,
  onDismiss,
}: GoalRuntimeStatusBarProps) {
  const { t } = useTranslation('task');
  const terminal = goal.status === 'complete'
    || goal.status === 'blocked'
    || goal.status === 'canceled';
  const color = goal.status === 'complete'
    ? 'var(--success)'
    : goal.status === 'blocked'
      ? 'var(--warning)'
      : goal.status === 'paused' || goal.status === 'canceled'
        ? 'var(--ink-muted)'
        : 'var(--heartbeat)';
  const title = goal.status === 'complete'
    ? t('cron.statusBar.goalCompleteTitle')
    : goal.status === 'blocked'
      ? t('cron.statusBar.goalBlockedTitle')
      : goal.status === 'canceled'
        ? t('cron.statusBar.goalCanceledTitle')
        : goal.status === 'paused'
          ? t('cron.statusBar.goalPausedTitle')
          : isExecuting
            ? t('cron.statusBar.loopExecutingTitle')
            : t('cron.statusBar.loopRunningTitle');
  const round = executionNumber ?? goal.turnCount + 1;
  const terminalSummary = t('cron.statusBar.goalTerminalSummary', {
    duration: formatDuration(goal.totalDurationMs),
    tokens: formatTokens(goal.totalTokens),
  });
  const detail = terminal && isExecuting
    ? t('cron.statusBar.goalFinalizingDetail')
    : terminal
      ? [goal.status === 'complete' ? null : goal.terminalReason?.trim(), terminalSummary]
          .filter(Boolean)
          .join(' · ')
        || goal.terminalReason?.trim()
        || t('cron.statusBar.roundRunning', { count: Math.max(1, goal.turnCount) })
      : goal.status === 'paused'
        ? t('cron.statusBar.goalPausedDetail')
        : isExecuting
          ? t('cron.statusBar.roundExecuting', { count: round })
          : t('cron.statusBar.roundRunning', { count: Math.max(1, goal.turnCount) });

  return (
    <div
      className="flex items-center justify-between gap-3 border border-b-0 px-3 py-2 first:rounded-t-lg"
      style={{
        borderColor: `color-mix(in srgb, ${color} 24%, transparent)`,
        backgroundColor: `color-mix(in srgb, var(--paper) 92%, ${color})`,
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative shrink-0">
          <Flag className="h-4 w-4" style={{ color }} />
          {isExecuting && !terminal && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ backgroundColor: color }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm font-medium" style={{ color }}>{title}</span>
        {!terminal ? (
          <button
            type="button"
            onClick={onEdit}
            className="min-w-0 truncate text-left text-sm text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
            title={t('cron.statusBar.goalEditTitle')}
          >
            {`${detail} · ${goal.objective}`}
          </button>
        ) : (
          <span className="min-w-0 truncate text-sm text-[var(--ink-muted)]">{detail}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {goal.status === 'paused' && onResume && (
          <button
            type="button"
            onClick={onResume}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-[var(--heartbeat-bg)]"
            style={{ color }}
            title={t('cron.statusBar.resumeGoalTitle')}
          >
            <Play className="h-3.5 w-3.5" />
            {t('cron.statusBar.resumeGoalButton')}
          </button>
        )}
        {!terminal && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-[var(--heartbeat-bg)]"
            style={{ color }}
            title={t('cron.statusBar.cancelGoalTitle')}
          >
            <X className="h-3.5 w-3.5" />
            {t('cron.statusBar.cancelGoalButton')}
          </button>
        )}
        {terminal && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--heartbeat-bg)] hover:text-[var(--heartbeat)]"
            title={t('cron.statusBar.dismissGoalTitle')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function GoalStatusBar(props: GoalStatusBarProps) {
  return props.mode === 'draft'
    ? <GoalDraftStatusBar {...props} />
    : <GoalRuntimeStatusBar {...props} />;
}
