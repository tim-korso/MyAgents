import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, Loader2, RefreshCw, Unlink, X } from 'lucide-react';
import type { CliProxyStatus } from '../../shared/cliproxy';
import type { Provider } from '@/config/types';
import { cancelCliProxy, connectCliProxy, disconnectCliProxy, discoverCliProxyModels, retryCliProxyCleanup } from '@/config/services/cliproxyService';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import OverlayBackdrop from './OverlayBackdrop';
import SubscriptionProviderCardContent from './SubscriptionProviderCardContent';
import DropdownMenu from './ui/DropdownMenu';

const buttonClass = 'rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:opacity-50';
const primaryClass = 'flex items-center gap-1.5 rounded-lg bg-[var(--button-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-60';
function messageOf(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : fallback;
}

export default function CliProxySubscriptionProvider({ status, refresh }: {
  status: CliProxyStatus; provider: Provider; refresh: () => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ generation?: string; message: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loginTarget, setLoginTarget] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const account = status.candidate ?? status.active;
  const generation = account?.generation;
  const authorizing = status.candidate?.phase === 'authorizing';
  const committing = status.candidate?.phase === 'waiting-to-commit';
  const accountError = (error?.generation === generation ? error?.message : undefined)
    ?? account?.error?.message ?? status.error?.message
    ?? (!status.policy.usable ? status.policy.error?.message ?? t('providers.cliproxy.disabled') : undefined);
  // A candidate view belongs to that exact pending generation. Once Rust
  // removes it (commit/cancel/failure), later disconnects cannot reopen it.
  const accountDialog = dialogOpen && (!loginTarget || status.candidate?.generation === loginTarget);
  const closeDialog = () => setDialogOpen(false);
  useCloseLayer(() => {
    if (!accountDialog) return false;
    closeDialog(); return true;
  }, 200);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await operation(); }
    catch (failure) {
      if (mounted.current) setError({ generation, message: messageOf(failure, t('providers.cliproxy.operationFailed')) });
    } finally {
      try { await refresh(); }
      finally { if (mounted.current) setBusy(false); }
    }
  };
  const beginLogin = () => {
    setLoginTarget(null); setDialogOpen(true);
    void run(async () => {
      const next = await connectCliProxy();
      if (mounted.current) {
        setLoginTarget(next.candidate?.generation ?? null);
        if (!next.candidate && next.active?.status === 'connected') setDialogOpen(false);
      }
    });
  };
  const showAccount = () => {
    setLoginTarget(status.candidate?.generation ?? null); setDialogOpen(true);
  };
  const label = status.active ? status.active.email ?? t('providers.cliproxy.account')
    : status.candidate?.email ?? (status.candidate ? t(`providers.cliproxy.phase.${status.candidate.phase}`) : t('providers.cliproxy.disconnected'));
  return <>
    <SubscriptionProviderCardContent
      description={t('providers.cliproxy.description')}
      status={<>
        <span className="truncate font-mono text-xs text-[var(--ink-muted)]">{label}</span>
        {status.active?.status === 'connected' && <span className="rounded bg-[var(--success-bg)] px-1.5 py-0.5 text-xs font-medium text-[var(--success)]">{t('providers.cliproxy.connected')}</span>}
        {!status.active && status.candidate?.email && <span className="text-[var(--ink-muted)]">{t(`providers.cliproxy.phase.${status.candidate.phase}`)}</span>}
      </>}
      actions={<>
        {status.candidate ? <button type="button" className={primaryClass} onClick={() => { if (status.candidate?.phase === 'authorizing' || committing) showAccount(); else beginLogin(); }}>
          {authorizing || committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link className="h-3.5 w-3.5" />}
          {t('providers.cliproxy.continueConnection')}
        </button> : !status.active && <button type="button" className={primaryClass} disabled={busy || !status.policy.usable || !!status.cleanup} onClick={beginLogin}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link className="h-3.5 w-3.5" />}{t('providers.login')}
        </button>}
        {status.active && !status.candidate && <button type="button" disabled={busy} onClick={() => { void run(() => discoverCliProxyModels(status.active!.generation)); }}
          title={t('providers.cliproxy.refreshModels')} className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        </button>}
        <DropdownMenu title={t('providers.cliproxy.moreActions')} sections={[
          { items: status.active ? [
            { label: t('providers.cliproxy.reconnect'), icon: <Link className="h-4 w-4" />, onClick: beginLogin, disabled: busy || !!status.candidate || !!status.cleanup || !status.policy.usable },
            { label: t('providers.cliproxy.disconnect'), icon: <Unlink className="h-4 w-4" />, onClick: () => { void run(disconnectCliProxy); }, disabled: busy },
          ] : [] },
          { items: [
            ...(status.cleanup ? [{ label: t('providers.cliproxy.retryCleanup'), onClick: () => { void run(retryCliProxyCleanup); }, disabled: busy }] : []),
          ] },
        ]} />
      </>}
      error={!accountDialog && (accountError || !status.policy.usable) ? <p role="alert" className="break-words text-xs text-[var(--error)]">{accountError ?? status.policy.error?.message ?? t('providers.cliproxy.disabled')}</p> : undefined}
    />
    {accountDialog && createPortal(
      <OverlayBackdrop onClose={closeDialog} className="z-[200] overflow-y-auto px-4 py-8">
        <div role="dialog" aria-modal="true" aria-label={t('providers.cliproxy.loginTitle')}
          className="w-full max-w-lg rounded-2xl bg-[var(--paper-elevated)] p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-[var(--ink)]">{t('providers.cliproxy.loginTitle')}</h2>
            <button type="button" aria-label={t('providers.cliproxy.close')} onClick={closeDialog} className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-5 space-y-4">
            <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--paper-inset)] p-4 text-sm">
              {account?.email && <p className="truncate text-[var(--ink)]">{account.email}</p>}
              <p className="flex items-center gap-2 text-[var(--ink-muted)]">
                {(busy || authorizing || committing) && <Loader2 className="h-4 w-4 animate-spin" />}
                {status.candidate ? t(`providers.cliproxy.phase.${status.candidate.phase}`)
                  : busy ? t('providers.cliproxy.preparingLogin')
                    : t(status.active?.status === 'connected' ? 'providers.cliproxy.connected' : 'providers.cliproxy.disconnected')}
              </p>
              {authorizing && <p className="text-xs text-[var(--ink-muted)]">{t('providers.cliproxy.browserHint')}</p>}
            </div>
            {accountError && <p role="alert" className="break-words text-sm text-[var(--error)]">{accountError}</p>}
            <div className="flex justify-end border-t border-[var(--line)] pt-3">
              {status.candidate ? <button type="button" className={buttonClass} disabled={busy} onClick={() => { void run(async () => {
                await cancelCliProxy(status.candidate!.attemptId); if (mounted.current) closeDialog();
              }); }}>{t('providers.cliproxy.cancel')}</button> : <button type="button" className={buttonClass} onClick={closeDialog}>{t('providers.cliproxy.close')}</button>}
            </div>
          </div>
        </div>
      </OverlayBackdrop>, document.body,
    )}
  </>;
}
