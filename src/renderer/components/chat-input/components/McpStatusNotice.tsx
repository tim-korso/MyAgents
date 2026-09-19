import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw } from 'lucide-react';
import Tip from '@/components/Tip';
import { useToast } from '@/components/Toast';
import type { McpEffectiveServerSnapshot } from '../../../../shared/mcpEffectiveState';
import type { McpRetryResult } from '../../../../shared/mcpFailure';

export function McpStatusNotice({ server, stale, busy, onRetry }: {
  server: McpEffectiveServerSnapshot;
  stale?: boolean;
  busy?: boolean;
  onRetry?: (serverId: string) => Promise<McpRetryResult>;
}) {
  const { t } = useTranslation('chat');
  const toast = useToast();
  const [retrying, setRetrying] = useState(false);
  const pending = useRef(false);
  const failed = server.state === 'failed';
  if (!failed && server.state !== 'needs_auth') return null;
  const reason = t(`input.mcpStatus.errors.${server.errorCode ?? 'MCP_STARTUP_FAILED'}`, {
    defaultValue: t('input.mcpStatus.errors.MCP_STARTUP_FAILED'),
  });
  const showRetryFailure = (code: unknown) => {
    toast.warning(t(`input.mcpStatus.retryErrors.${typeof code === 'string' ? code : 'retry_failed'}`, {
      defaultValue: t('input.mcpStatus.retryErrors.retry_failed'),
    }));
  };
  const retry = async () => {
    if (!onRetry || pending.current || busy) return;
    pending.current = true;
    setRetrying(true);
    try {
      const result = await onRetry(server.id);
      if (!result.success) {
        showRetryFailure(result.errorCode);
      }
    } catch (error) {
      // Tab API attaches the bounded errorCode to non-2xx responses.
      showRetryFailure(error instanceof Error && 'errorCode' in error ? error.errorCode : undefined);
    } finally {
      pending.current = false;
      setRetrying(false);
    }
  };
  return (
    <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ink-muted)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="min-w-0">
        {stale ? t('input.mcpStatus.stale') : failed ? reason : t('input.mcpStatus.needsAuth')}
      </span>
      {failed && onRetry && (
        <Tip label={busy ? t('input.mcpStatus.retryErrors.session_busy') : t('input.mcpStatus.retryHint')}>
          <button
            type="button"
            aria-label={t('input.mcpStatus.retry')}
            className="compact-action ml-auto shrink-0 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:opacity-40"
            disabled={busy || retrying}
            onClick={(event) => { event.stopPropagation(); void retry(); }}
          >
            <RotateCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
          </button>
        </Tip>
      )}
    </div>
  );
}
