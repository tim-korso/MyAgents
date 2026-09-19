// TaskItemActions — single "…" overflow button that carries every action
// available on a task row (run / stop / rerun / open detail / delete).
// Shared by both the card and list views.
//
// Prior iteration had a separate primary-action button next to the "…" —
// that meant the per-status button changed shape under the user's cursor
// (▶ → ■ → ↻) and ate real estate at the card's top-right corner. The
// new shape folds everything into the menu so the card's top-right has a
// single, stable target (`…`) regardless of status.
//
// Historical Cron rows reuse the same component and surface only read-only
// detail.

import { Pencil, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DropdownMenu, type DropdownMenuItem, type DropdownMenuSection } from '@/components/ui/DropdownMenu';
import type { Task, TaskExecutionState, TaskStatus } from '@/../shared/types/task';

export interface TaskItemActionsProps {
  variant: 'task' | 'legacy';
  /** Live status — native task value, or derived for legacy. */
  status: TaskStatus;
  executionState?: TaskExecutionState;
  canRerun?: boolean;
  /** Busy flag locks all actions during a pending async op. */
  busy?: boolean;
  /** Fired by the primary action (▶ for todo, ■ for running, ↻ for rerun). */
  onRun?: () => void;
  onStop?: () => void;
  onRerun?: () => void;
  /** Kept for legacy-variant menus which still surface "打开详情". For the
   *  `task` variant the card body itself handles opening the detail view
   *  (clicking the card area), so we don't duplicate the entry in the
   *  menu — the menu instead offers `onEdit` which lands directly on the
   *  editor. */
  onOpenDetail: () => void;
  /** Opens the detail overlay already in edit mode (task variant only). */
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TaskItemActions({
  variant,
  status,
  executionState,
  canRerun = true,
  busy,
  onRun,
  onStop,
  onRerun,
  onOpenDetail,
  onEdit,
  onDelete,
}: TaskItemActionsProps) {
  const { t } = useTranslation('task');
  const primary =
    variant === 'legacy'
      ? null
      : primaryActionFor(status, executionState, canRerun, { onRun, onStop, onRerun }, t);

  // Menu ordering (v0.1.69):
  //   1. 编辑 (task variant) — clicking the card already opens the detail
  //      view, so the menu skips 打开详情 and lands the user directly on
  //      the editor instead.
  //   2. Primary lifecycle action — 立即执行 / 中止 / 重新派发,
  //      depending on current status (see `primaryActionFor` below).
  //   3. 删除 — separated visually by the danger tint.
  // Legacy rows still need 打开详情 because their editor lives in
  // LegacyCronOverlay, which is reached through the detail view.
  const primaryGroup: DropdownMenuItem[] = [];
  if (variant === 'task' && onEdit) {
    primaryGroup.push({
      icon: <Pencil className="h-3.5 w-3.5" />,
      label: t('tasks.actions.edit'),
      onClick: onEdit,
    });
  }
  if (variant === 'legacy') {
    primaryGroup.push({
      label: t('tasks.actions.openDetail'),
      onClick: onOpenDetail,
    });
  }
  if (primary?.handler) {
    primaryGroup.push({
      icon: primary.icon,
      label: primary.title,
      onClick: primary.handler,
      className: primary.menuClassName,
    });
  }

  const destructiveGroup: DropdownMenuItem[] = onDelete && !executionState
    ? [
        {
          icon: <Trash2 className="h-3.5 w-3.5" />,
          label: t('tasks.actions.delete'),
          onClick: onDelete,
          danger: true,
        },
      ]
    : [];

  const sections: DropdownMenuSection[] = [
    { items: primaryGroup },
    { items: destructiveGroup },
  ];

  return <DropdownMenu sections={sections} size="sm" disabled={busy} minWidth={140} />;
}

interface PrimaryAction {
  icon: React.ReactNode;
  title: string;
  /** `<button>` class for the menu-item variant (full-width row). */
  menuClassName: string;
  handler: (() => void) | undefined;
}

function primaryActionFor(
  status: TaskStatus,
  executionState: TaskExecutionState | undefined,
  canRerun: boolean,
  handlers: Pick<TaskItemActionsProps, 'onRun' | 'onStop' | 'onRerun'>,
  t: (key: string) => string,
): PrimaryAction | null {
  if (executionState === 'stopping') {
    return {
      icon: <Square className="h-3.5 w-3.5" />,
      title: t('tasks.actions.stopping'),
      menuClassName: 'text-[var(--warning)]',
      handler: undefined,
    };
  }
  if (executionState === 'stop_failed') {
    return {
      icon: <Square className="h-3.5 w-3.5" />,
      title: t('tasks.actions.retryStop'),
      menuClassName:
        'text-[var(--error)] hover:bg-[var(--error-bg)]',
      handler: handlers.onStop,
    };
  }
  if (executionState === 'running') {
    return {
      icon: <Square className="h-3.5 w-3.5" />,
      title: t('tasks.actions.stop'),
      menuClassName:
        'text-[var(--ink-secondary)] hover:bg-[var(--error-bg)] hover:text-[var(--error)]',
      handler: handlers.onStop,
    };
  }
  switch (status) {
    case 'todo':
      return {
        icon: <Play className="h-3.5 w-3.5" />,
        title: t('tasks.actions.runNow'),
        menuClassName:
          'text-[var(--accent-warm)] hover:bg-[var(--accent-warm-subtle)]',
        handler: handlers.onRun,
      };
    case 'running':
    case 'verifying':
      return {
        icon: <Square className="h-3.5 w-3.5" />,
        title: t('tasks.actions.stop'),
        menuClassName:
          'text-[var(--ink-secondary)] hover:bg-[var(--error-bg)] hover:text-[var(--error)]',
        handler: handlers.onStop,
      };
    case 'blocked':
    case 'stopped':
    case 'done':
      if (!canRerun) return null;
      return {
        icon: <RotateCcw className="h-3.5 w-3.5" />,
        title: t('tasks.actions.rerun'),
        menuClassName:
          'text-[var(--ink-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]',
        handler: handlers.onRerun,
      };
    default:
      return null;
  }
}

/** Historical Cron rows are read-only and therefore render as archived. */
export function deriveTaskRowStatus(task: Task | null): TaskStatus {
  if (task) return task.status;
  return 'archived';
}
