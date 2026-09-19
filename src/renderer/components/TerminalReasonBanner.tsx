/**
 * TerminalReasonBanner — 展示 SDK 0.2.91+ `terminal_reason` 的中文 banner。
 *
 * 配合 `agentError` 同位展示（在消息列表上方、输入框下方的 flex-shrink 区域）。
 * agentError 是终端错误（需要用户明确处理），terminal_reason 是本轮的终止原因
 * （有时与错误重叠，有时是"上下文已满"这种非错误但需要用户动作的信号）。
 *
 * 设计原则：
 * - `completed` / 未设置 → 不渲染（由调用方判断 `lastTerminalReason` 空值）
 * - 未知枚举值 → 通用兜底（避免 SDK 扩展枚举时前端 crash）
 * - severity=error 用 error 色调，notice 用 warning 色调，info 用 muted 色调
 */

import { AlertCircle, AlertTriangle, Bot, Info, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  describeTerminalReason,
  shouldOfferTerminalReasonDiagnostics,
  type TerminalReasonSeverity,
} from '../../shared/terminalReason';

interface TerminalReasonBannerProps {
  reason: string | null;
  onDismiss: () => void;
  /** max_turns → 引导用户新开会话。prop 缺失时按钮不渲染。 */
  onNewSession?: () => void;
  onDiagnose?: (reason: string) => void;
}

const SEVERITY_STYLES: Record<TerminalReasonSeverity, {
  bg: string;
  icon: typeof AlertCircle;
  iconColor: string;
}> = {
  error: {
    bg: 'bg-[var(--error-bg)]',
    icon: AlertCircle,
    iconColor: 'text-[var(--error)]',
  },
  notice: {
    bg: 'bg-[var(--warning-bg)]',
    icon: AlertTriangle,
    iconColor: 'text-[var(--warning)]',
  },
  info: {
    bg: 'bg-[var(--paper-inset)]',
    icon: Info,
    iconColor: 'text-[var(--ink-muted)]',
  },
};

export default function TerminalReasonBanner({
  reason,
  onDismiss,
  onNewSession,
  onDiagnose,
}: TerminalReasonBannerProps) {
  const { t } = useTranslation('chat');
  // Guard rapid double-clicks on the "新开会话" button — handleNewSession is async
  // and involves Rust IPC + session handover; re-entering it mid-flight can
  // create duplicate session resets. Uses React's official "resetting state on
  // prop change" pattern (setState-during-render) so the guard clears whenever
  // a new banner round starts.
  const [newSessionFired, setNewSessionFired] = useState(false);
  const [prevReason, setPrevReason] = useState(reason);
  if (reason !== prevReason) {
    setPrevReason(reason);
    setNewSessionFired(false);
  }

  const info = describeTerminalReason(reason);
  if (!info) return null;

  const style = SEVERITY_STYLES[info.severity];
  const Icon = style.icon;
  const reasonKey = typeof reason === 'string' && reason.length > 0 ? reason : 'unknown';
  const unknownLabel = t('shell.terminalReason.unknown.label', { reason: reasonKey });
  const unknownDetail = t('shell.terminalReason.unknown.detail', { reason: reasonKey });
  const label = t(`shell.terminalReason.reasons.${reasonKey}.label`, { defaultValue: unknownLabel });
  const detail = t(`shell.terminalReason.reasons.${reasonKey}.detail`, { defaultValue: unknownDetail });

  // Per-reason shortcut button. Drives the PRD §5.1.2 action:
  // - max_turns → 新开会话继续
  const showNewSession = reason === 'max_turns' && !!onNewSession;
  const diagnoseReason = typeof reason === 'string'
    && shouldOfferTerminalReasonDiagnostics(reason)
    && !!onDiagnose
    ? reason
    : null;

  return (
    <div className={`relative z-10 flex-shrink-0 border-b border-[var(--line)] ${style.bg} px-4 py-2 text-xs text-[var(--ink)]`}>
      <div className="mx-auto flex max-w-3xl items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${style.iconColor}`} />
        <div className="flex-1">
          <span className="font-semibold text-[var(--ink)]">{label}</span>
          <span className="ml-2 text-[var(--ink-muted)]">{detail}</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {diagnoseReason && onDiagnose && (
            <button
              type="button"
              onClick={() => onDiagnose(diagnoseReason)}
              className="rounded p-0.5 text-[var(--ink-subtle)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--accent)]"
              title={t('shell.diagnostics.askHelper')}
              aria-label={t('shell.diagnostics.askHelper')}
            >
              <Bot className="h-3.5 w-3.5" />
            </button>
          )}
          {showNewSession && (
            <button
              type="button"
              disabled={newSessionFired}
              onClick={() => {
                if (newSessionFired) return;
                setNewSessionFired(true);
                // Fire onNewSession first so the user sees the handover start;
                // dismiss afterward so the banner has visual acknowledgment time
                // before unmounting (review-by-codex Warning #2 ordering fix).
                onNewSession!();
                onDismiss();
              }}
              className="rounded-md px-2 py-0.5 text-xs font-medium text-[var(--accent-warm)] transition-colors hover:bg-[var(--accent-warm-subtle)] disabled:cursor-wait disabled:opacity-60"
            >
              {t('shell.terminalReason.newSession')}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-0.5 text-[var(--ink-subtle)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink-muted)]"
            title={t('shell.common.close')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
