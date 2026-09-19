// EndConditionsEditor — shared UI for task end conditions (forever vs
// conditional + deadline / maxExecutions / aiCanExit). Used by the dispatch
// dialog and the task detail overlay edit mode.

import { useTranslation } from 'react-i18next';
import { Checkbox, toLocalDateTimeString } from './controls';

export type EndConditionMode = 'forever' | 'conditional';

export interface EndConditionsState {
  mode: EndConditionMode;
  deadline: string;
  maxExecutions: string;
  aiCanExit: boolean;
}

export interface EndConditionsEditorProps extends EndConditionsState {
  setMode: (m: EndConditionMode) => void;
  setDeadline: (s: string) => void;
  setMaxExecutions: (s: string) => void;
  setAiCanExit: (v: boolean) => void;
  disabled?: boolean;
}

export function EndConditionsEditor({
  mode,
  deadline,
  maxExecutions,
  aiCanExit,
  setMode,
  setDeadline,
  setMaxExecutions,
  setAiCanExit,
  disabled,
}: EndConditionsEditorProps) {
  const { t } = useTranslation('task');
  return (
    <div className="space-y-3.5">
      <div className="flex gap-1.5 rounded-[var(--radius-md)] bg-[var(--paper-inset)] p-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('forever')}
          className={`flex flex-1 items-center justify-center rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === 'forever'
              ? 'bg-[var(--paper-elevated)] text-[var(--ink)] shadow-xs'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
          }`}
        >
          {t('endConditions.forever')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('conditional')}
          className={`flex flex-1 items-center justify-center rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === 'conditional'
              ? 'bg-[var(--paper-elevated)] text-[var(--ink)] shadow-xs'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
          }`}
        >
          {t('endConditions.conditional')}
        </button>
      </div>

      {mode === 'conditional' && (
        <>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)]">
            <div
              className="flex cursor-pointer items-center justify-between border-b border-[var(--line)] px-3 py-2.5"
              onClick={() => {
                if (disabled) return;
                setDeadline(
                  deadline ? '' : toLocalDateTimeString(new Date(Date.now() + 86400_000)),
                );
              }}
            >
              <Checkbox
                checked={!!deadline}
                disabled={disabled}
                onChange={(v) =>
                  setDeadline(
                    v ? toLocalDateTimeString(new Date(Date.now() + 86400_000)) : '',
                  )
                }
                label={t('endConditions.deadline')}
              />
              <input
                type="datetime-local"
                value={deadline}
                disabled={disabled}
                onChange={(e) => setDeadline(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className={`w-44 rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none disabled:cursor-not-allowed ${
                  !deadline ? 'opacity-50' : ''
                }`}
              />
            </div>
            <div
              className="flex cursor-pointer items-center justify-between px-3 py-2.5"
              onClick={() => {
                if (disabled) return;
                setMaxExecutions(maxExecutions ? '' : '10');
              }}
            >
              <Checkbox
                checked={!!maxExecutions}
                disabled={disabled}
                onChange={(v) => setMaxExecutions(v ? '10' : '')}
                label={t('endConditions.maxExecutions')}
              />
              <div
                className="flex items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={maxExecutions || 10}
                  disabled={disabled}
                  onChange={(e) => setMaxExecutions(e.target.value)}
                  className={`w-16 rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-center text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none disabled:cursor-not-allowed ${
                    !maxExecutions ? 'opacity-50' : ''
                  }`}
                />
                <span
                  className={`text-sm text-[var(--ink-secondary)] ${
                    !maxExecutions ? 'opacity-50' : ''
                  }`}
                >
                  {t('endConditions.timesSuffix')}
                </span>
              </div>
            </div>
          </div>
          <p className="text-sm text-[var(--ink-muted)]">
            {t('endConditions.conditionalHint')}
          </p>
        </>
      )}

      <div
        className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5"
        onClick={() => {
          if (disabled) return;
          setAiCanExit(!aiCanExit);
        }}
      >
        <Checkbox
          checked={aiCanExit}
          onChange={setAiCanExit}
          disabled={disabled}
          label={t('endConditions.aiCanExit')}
        />
      </div>
    </div>
  );
}
