import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Tip from '../Tip';
import { useToastOptional } from '../Toast';
import { copyRichText } from '@/utils/clipboard';
import { downloadBlob, localDateStr } from '@/utils/markdownExport';
import { tableXlsx, type TableSnapshot } from '@/utils/tableExport';

export default function TableActions({ getSnapshot, disabled = false }: {
  getSnapshot(): TableSnapshot | Promise<TableSnapshot>;
  disabled?: boolean;
}) {
  const { t } = useTranslation('app');
  const toast = useToastOptional();
  const pending = useRef(false);
  const [busy, setBusy] = useState<'copy' | 'download' | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(copiedTimer.current);
    };
  }, []);
  const run = async (action: 'copy' | 'download') => {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(action); setError(false);
    if (action === 'copy') {
      clearTimeout(copiedTimer.current);
      setCopied(false);
    }
    try {
      const snapshot = getSnapshot();
      if (action === 'copy') {
        // Start the clipboard write in the click's user gesture. WebKit accepts
        // promised representations while the editor finishes IME composition.
        await copyRichText(snapshot instanceof Promise ? snapshot.then(value => value.html) : snapshot.html,
          snapshot instanceof Promise ? snapshot.then(value => value.text) : snapshot.text);
        if (!mounted.current) return;
        setCopied(true);
        copiedTimer.current = setTimeout(() => setCopied(false), 1500);
      } else {
        const blob = await tableXlsx(await snapshot);
        const message = await downloadBlob(`${localDateStr()}-table.xlsx`, blob);
        toast?.success(message);
      }
    } catch {
      if (!mounted.current) return;
      setError(true);
      toast?.error(t('markdown.tableActionFailed'));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const copyLabel = t(copied ? 'markdown.tableCopied' : 'markdown.copyTable');
  return <div className="markdown-table-actions" role="group" aria-label={t('markdown.tableActions')}
    // Let native buttons activate without the enclosing editor consuming Enter/Space.
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
    <Tip label={copyLabel} position="top"><button type="button" aria-label={copyLabel} disabled={disabled} aria-disabled={disabled || busy !== null} onClick={() => { void run('copy'); }}>
      {busy === 'copy' ? <Loader2 className="size-3.5 animate-spin" /> : copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button></Tip>
    <Tip label={t('markdown.downloadTable')} position="bottom"><button type="button" aria-label={t('markdown.downloadTable')} disabled={disabled} aria-disabled={disabled || busy !== null} onClick={() => { void run('download'); }}>
      {busy === 'download' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
    </button></Tip>
    {error && <span role="alert" className="markdown-table-error">{t('markdown.tableActionFailed')}</span>}
  </div>;
}
