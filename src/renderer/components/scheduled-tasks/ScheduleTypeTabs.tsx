/**
 * ScheduleTypeTabs — Three schedule type tabs (目标模式 / 周期触发 / 仅一次)
 * Each tab renders its own configuration area.
 *
 * v0.1.69 refactor: the previous four tabs (固定间隔 / 定时执行 /
 * 仅一次 / 目标模式) collapsed the first two into one "周期触发" tab
 * powered by `CronExpressionInput` with its 5-chip picker (固定周期 +
 * 每天 / 工作日 / 每周 / 每月). Both "every N minutes" and calendar-
 * aligned cron schedules now live under the same UI — the old tab
 * bifurcation forced users to pre-decide between the two before they
 * even saw their options.
 *
 * Schema: `CronSchedule` still uses `{ kind: 'every', minutes }` vs
 * `{ kind: 'cron', expr, tz }` — the merged UI just chooses between
 * them based on which of `cronExpr` vs `intervalMinutes` carries the
 * active value.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Clock, Calendar, Flag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CronSchedule } from '@/types/cronTask';
import CronExpressionInput from './CronExpressionInput';
import { formatApproxFutureDistance } from '@/utils/cronTaskI18n';

/** Format a Date as local YYYY-MM-DDTHH:mm for datetime-local input */
function toLocalDateTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Surface-level kind exposed via the tab row. Maps to `CronSchedule.kind`
 * at persist time — `recurring` covers both `every` and `cron` variants
 * (picker decides which is emitted based on `cronExpr` vs interval).
 */
type ScheduleKind = 'recurring' | 'at' | 'loop';

interface ScheduleTypeTabsProps {
  value: CronSchedule | null;
  intervalMinutes: number;
  onChange: (schedule: CronSchedule | null, intervalMinutes: number) => void;
  error?: string;
}

const TABS: { kind: ScheduleKind; labelKey: string; icon: typeof Clock }[] = [
  { kind: 'loop', labelKey: 'cron.scheduleTabs.loop', icon: Flag },
  { kind: 'recurring', labelKey: 'cron.scheduleTabs.recurring', icon: Clock },
  { kind: 'at', labelKey: 'cron.scheduleTabs.once', icon: Calendar },
];

/** Map the incoming `CronSchedule` to the surface-level tab. `every` and
 *  `cron` both map to the merged "周期触发" tab. */
function deriveActiveKind(value: CronSchedule | null): ScheduleKind {
  if (!value) return 'recurring';
  if (value.kind === 'at') return 'at';
  if (value.kind === 'loop') return 'loop';
  return 'recurring';
}

export default function ScheduleTypeTabs({ value, intervalMinutes, onChange, error }: ScheduleTypeTabsProps) {
  const { t } = useTranslation('task');
  const activeKind: ScheduleKind = deriveActiveKind(value);

  // --- Recurring tab state (covers both "every" and "cron" variants) ---
  // `cronExpr` non-empty → CronExpressionInput renders in visual/raw
  // mode and we emit { kind: 'cron', ... }. Empty (= 固定周期 chip) →
  // we emit { kind: 'every', minutes }.
  const defaultTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const [cronExpr, setCronExpr] = useState(
    value?.kind === 'cron' ? value.expr : '',
  );
  const [cronTz, setCronTz] = useState(
    value?.kind === 'cron' ? (value.tz ?? defaultTz) : defaultTz,
  );

  // --- At state ---
  const getDefaultAtTime = useCallback(() => {
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    return toLocalDateTimeString(d);
  }, []);
  const [atDateTime, setAtDateTime] = useState(
    value?.kind === 'at' ? toLocalDateTimeString(new Date(value.at)) : getDefaultAtTime()
  );

  // Keep local state in sync if the parent swaps `value` underneath us
  // (e.g. a form reset). The effect only pulls — user-driven updates
  // still flow out via the handlers below.
  useEffect(() => {
    if (value?.kind === 'cron') {
      setCronExpr(value.expr);
      setCronTz(value.tz ?? defaultTz);
    } else if (value?.kind === 'every') {
      setCronExpr('');
    }
    if (value?.kind === 'at') {
      setAtDateTime(toLocalDateTimeString(new Date(value.at)));
    }
  }, [value, defaultTz]);

  const handleTabChange = useCallback((kind: ScheduleKind) => {
    if (kind === 'recurring') {
      // Emit whichever recurring shape the local state currently holds.
      // Preserves `startAt` on the Every variant (see
      // handleIntervalChange for the rationale).
      if (cronExpr.trim()) {
        onChange({ kind: 'cron', expr: cronExpr, tz: cronTz }, intervalMinutes);
      } else {
        const carryStartAt = value?.kind === 'every' ? value.startAt : undefined;
        const schedule: CronSchedule = carryStartAt
          ? { kind: 'every', minutes: intervalMinutes, startAt: carryStartAt }
          : { kind: 'every', minutes: intervalMinutes };
        onChange(schedule, intervalMinutes);
      }
    } else if (kind === 'loop') {
      onChange({ kind: 'loop' }, intervalMinutes);
    } else {
      onChange({ kind: 'at', at: new Date(atDateTime).toISOString() }, intervalMinutes);
    }
  }, [onChange, intervalMinutes, cronExpr, cronTz, atDateTime, value]);

  // CronExpressionInput emits two separate callbacks when freq is
  // 'interval': first `onChange('', tz)` then `onIntervalChange(n)`.
  // If we reacted to the empty-expr path with a schedule emission,
  // we'd use the *stale* `intervalMinutes` from closure (the
  // onIntervalChange → parent setState hasn't committed yet within the
  // same event tick), clobbering the new value once React renders.
  // So this callback only handles the *non-empty* expr case; the
  // interval path is owned entirely by `handleIntervalChange` which
  // receives the fresh value as an arg and doesn't read stale closure.
  const handleCronChange = useCallback((expr: string, tz: string) => {
    setCronExpr(expr);
    setCronTz(tz);
    if (expr.trim()) {
      onChange({ kind: 'cron', expr, tz }, intervalMinutes);
    }
    // else: no-op — handleIntervalChange is the authoritative emitter
    // for interval mode. See comment above for the race rationale.
  }, [onChange, intervalMinutes]);

  // The 固定周期 chip's N-minute input bubbles up here. It doesn't
  // touch `cronExpr` (already empty in that mode), just updates the
  // shared intervalMinutes and re-emits the Every schedule.
  // Preserves an existing `startAt` (delayed first-fire) if the task
  // was previously created with one — the UI no longer exposes the
  // picker (v0.1.69 tab consolidation dropped it), but round-tripping
  // the value through edit keeps pre-existing scheduled starts intact
  // instead of silently stripping them on save.
  const handleIntervalChange = useCallback((mins: number) => {
    const carryStartAt = value?.kind === 'every' ? value.startAt : undefined;
    const schedule: CronSchedule = carryStartAt
      ? { kind: 'every', minutes: mins, startAt: carryStartAt }
      : { kind: 'every', minutes: mins };
    onChange(schedule, mins);
  }, [onChange, value]);

  const handleAtChange = useCallback((dateTime: string) => {
    setAtDateTime(dateTime);
    if (!dateTime) return; // Guard empty datetime-local (would throw RangeError)
    const d = new Date(dateTime);
    if (isNaN(d.getTime())) return; // Guard invalid date
    onChange({ kind: 'at', at: d.toISOString() }, intervalMinutes);
  }, [onChange, intervalMinutes]);

  // Min datetime for "at" type (now + 1 minute)
  const minDateTime = useMemo(() => {
    return toLocalDateTimeString(new Date(Date.now() + 60000));
  }, []);

  return (
    <div>
      {/* Tab buttons */}
      <div className="flex gap-1.5 rounded-[var(--radius-md)] bg-[var(--paper-inset)] p-1">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeKind === tab.kind;
          return (
            <button
              key={tab.kind}
              type="button"
              onClick={() => handleTabChange(tab.kind)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[var(--paper-elevated)] text-[var(--ink)] shadow-xs'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="mt-3">
        {/* 周期触发 — merged every + cron. The 5-chip picker inside
            CronExpressionInput covers 固定周期 (→ CronSchedule.every)
            plus 每天 / 工作日 / 每周 / 每月 (→ CronSchedule.cron).
            `handleCronChange` is what emits the right `kind` based on
            whether the expr is empty or not. */}
        {activeKind === 'recurring' && (
          <CronExpressionInput
            expr={cronExpr}
            tz={cronTz}
            onChange={handleCronChange}
            intervalMinutes={intervalMinutes}
            onIntervalChange={handleIntervalChange}
          />
        )}

        {activeKind === 'loop' && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-4 py-3">
            <p className="text-sm font-medium text-[var(--ink)]">{t('cron.scheduleTabs.loopTitle')}</p>
            <div className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-[var(--ink-muted)]">
              {t('cron.scheduleTabs.loopDescription')
                .split('\n\n')
                .map(paragraph => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
            </div>
          </div>
        )}

        {activeKind === 'at' && (
          <div>
            <input
              type="datetime-local"
              value={atDateTime}
              min={minDateTime}
              onChange={e => handleAtChange(e.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
            {atDateTime && (
              <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
                {t('cron.scheduleTabs.approxPrefix', { distance: formatApproxFutureDistance(atDateTime, t) })}
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-[var(--error)]">{error}</p>
      )}
    </div>
  );
}
