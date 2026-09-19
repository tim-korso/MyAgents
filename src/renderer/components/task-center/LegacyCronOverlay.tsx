// Read-only detail for historical Cron rows that could not become Tasks.

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import OverlayBackdrop from '@/components/OverlayBackdrop';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import { formatCronIntervalLabel } from '@/utils/cronTaskI18n';

const OVERLAY_Z = 200;

interface Props {
  legacy: Record<string, unknown>;
  onClose: () => void;
}

export function LegacyCronOverlay({ legacy, onClose }: Props) {
  const { t } = useTranslation('task');
  useCloseLayer(() => {
    onClose();
    return true;
  }, OVERLAY_Z);

  const name = String(legacy.name ?? legacy.prompt ?? t('cron.legacy.untitled'));
  const prompt = String(legacy.prompt ?? '');
  const status = String(legacy.status ?? 'stopped');
  const workspacePath = String(legacy.workspacePath ?? '');
  const createdAt = legacy.createdAt ? String(legacy.createdAt) : '';
  const schedule = (legacy.schedule as Record<string, unknown> | undefined) ?? null;
  const isRunning = status === 'running';

  const scheduleLabel = describeSchedule(schedule, t);

  return (
    <OverlayBackdrop onClose={onClose} className="z-[200]">
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-[var(--radius-2xl)] bg-[var(--paper-elevated)] shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-[var(--line)] px-5 py-4">
          <div>
            <div className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--paper-inset)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
              {t('cron.legacy.badge')}
            </div>
            <h2 className="mt-1.5 text-lg font-semibold text-[var(--ink)]">
              {name}
            </h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {t('cron.legacy.description')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1.5 text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
            title={t('cron.legacy.closeTitle')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-[var(--ink-muted)]/70">{t('cron.legacy.status')}</dt>
            <dd className="text-[var(--ink)]">{isRunning ? t('cron.legacy.running') : t('cron.legacy.paused')}</dd>
            <dt className="text-[var(--ink-muted)]/70">{t('cron.legacy.workspace')}</dt>
            <dd className="truncate text-[var(--ink)]">{workspacePath || '—'}</dd>
            <dt className="text-[var(--ink-muted)]/70">{t('cron.legacy.schedule')}</dt>
            <dd className="text-[var(--ink)]">{scheduleLabel}</dd>
            <dt className="text-[var(--ink-muted)]/70">{t('cron.legacy.created')}</dt>
            <dd className="text-[var(--ink)]">{createdAt || '—'}</dd>
          </dl>

          {prompt && (
            <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--paper)] p-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                {t('cron.legacy.originalPrompt')}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink-secondary)]">
                {prompt}
              </div>
            </div>
          )}

          <p className="mt-4 text-xs leading-relaxed text-[var(--ink-muted)]">
            {t('cron.legacy.footer')}
          </p>
        </div>
      </div>
    </OverlayBackdrop>
  );
}

function describeSchedule(s: Record<string, unknown> | null, t: TFunction<'task'>): string {
  if (!s) return t('cron.legacy.scheduleFallback');
  const kind = s.kind as string | undefined;
  if (kind === 'every') {
    const minutes = Number(s.minutes);
    const interval = Number.isFinite(minutes) ? formatCronIntervalLabel(minutes, t) : String(s.minutes ?? '?');
    return t('cron.schedule.every', { interval });
  }
  if (kind === 'at') return t('cron.legacy.scheduleOnce', { time: String(s.at ?? '?') });
  if (kind === 'cron') return t('cron.legacy.scheduleCron', { expr: String(s.expr ?? '?') });
  if (kind === 'loop') return t('cron.schedule.loop');
  return t('cron.legacy.scheduleFallback');
}

export default LegacyCronOverlay;
