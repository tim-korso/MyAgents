import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diffWordsWithSpace } from 'diff';
import { compareSourceLines, combineSourceLines, comparisonBlocks, unresolvedRows, type LineComparison, type DiffSide } from './lineDiff';

export interface ConflictSnapshot {
  local: string; disk: string; revision: number; path: string; generation: number;
}
interface Props {
  snapshot: ConflictSnapshot;
  stale: boolean;
  visible?: boolean;
  receiptUnknown?: boolean;
  onRefresh(): Promise<void>;
  onApply(content: string, snapshot: ConflictSnapshot, diskOnly: boolean): Promise<boolean>;
  onCopy(): Promise<void>;
  onClose(): void;
}

export default function ConflictComparison({ snapshot, stale, visible: open = true, receiptUnknown = false, onRefresh, onApply, onCopy, onClose }: Props) {
  const { t } = useTranslation('app');
  const [comparison, setComparison] = useState<LineComparison | null>(null);
  const rows = comparison?.rows;
  const [choices, setChoices] = useState<ReadonlyMap<number, DiffSide>>(new Map());
  const [block, setBlock] = useState(0);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [paneHeight, setPaneHeight] = useState(600);
  const paneRefs = useRef<{ local: HTMLDivElement | null; disk: HTMLDivElement | null }>({ local: null, disk: null });
  useEffect(() => {
    let active = true;
    setComparison(null); setChoices(new Map()); setBlock(0); setPreview(false); setError(false);
    void compareSourceLines(snapshot.local, snapshot.disk).then(result => { if (active) setComparison(result); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [snapshot]);
  const blocks = useMemo(() => comparison ? comparisonBlocks(comparison) : [], [comparison]);
  const remaining = useMemo(() => comparison ? unresolvedRows(comparison, choices) : 0, [comparison, choices]);
  const result = useMemo(() => comparison && !remaining ? combineSourceLines(comparison, choices) : null, [comparison, choices, remaining]);
  const selectAll = (side: DiffSide) => setChoices(new Map(rows?.filter(row => row.changed).map(row => [row.id, side])));
  const operation = async (run: () => Promise<void>) => { if (busy) return; setBusy(true); setError(false); try { await run(); } catch { setError(true); } finally { setBusy(false); } };
  const visible = useMemo(() => rows?.slice(expanded ? 0 : blocks[block]?.from ?? 0, expanded ? rows.length : blocks[block]?.to ?? rows.length) ?? [], [rows, blocks, block, expanded]);
  const rowIndices = useMemo(() => new Map(visible.map((row, index) => [row.id, index])), [visible]);
  const firstVisible = Math.max(0, Math.floor(scrollTop / 26) - 6);
  const windowRows = useMemo(() => visible.slice(firstVisible, firstVisible + Math.ceil(paneHeight / 26) + 12), [visible, firstVisible, paneHeight]);
  const wordDiffs = useMemo(() => {
    const result = new Map<number, ReturnType<typeof diffWordsWithSpace> | undefined>();
    const started = performance.now();
    for (const row of windowRows) {
      if (!row.changed || !row.local?.text || !row.disk?.text || row.kind !== 'line') continue;
      // Highlight only mounted rows, with a total frame budget. Alignment and
      // source-line choices remain available when intraline work is omitted.
      if (performance.now() - started > 6 || row.local.text.length + row.disk.text.length > 4000) break;
      result.set(row.id, diffWordsWithSpace(row.local.text, row.disk.text, { timeout: 1, maxEditLength: 128 }));
    }
    return result;
  }, [windowRows]);
  const locked = stale || busy || receiptUnknown;
  useEffect(() => { if (open) dialogRef.current?.focus(); }, [open]);
  const scrollToRow = (side: DiffSide, id: number, offset = 0) => {
    const index = rowIndices.get(id);
    if (index === undefined) return;
    const pane = paneRefs.current[side];
    if (pane) pane.scrollTop = index * 26 + offset;
  };
  const moveLine = (side: DiffSide, id: number, direction: number) => {
    let index = (rowIndices.get(id) ?? 0) + direction;
    while (index >= 0 && index < visible.length && !visible[index].changed) index += direction;
    const row = visible[index]; if (!row) return;
    scrollToRow(side, row.id); setScrollTop(index * 26);
    requestAnimationFrame(() => paneRefs.current[side]?.querySelector<HTMLButtonElement>(`[data-row-id="${row.id}"]`)?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    setScrollTop(0);
    for (const pane of Object.values(paneRefs.current)) if (pane) pane.scrollTop = 0;
  }, [block, snapshot, expanded]);
  useEffect(() => {
    if (!rows) return;
    const observer = new ResizeObserver(entries => setPaneHeight(Math.max(100, ...entries.map(entry => entry.contentRect.height))));
    for (const pane of Object.values(paneRefs.current)) if (pane) observer.observe(pane);
    return () => observer.disconnect();
  }, [rows]);
  return <section ref={dialogRef} tabIndex={-1} style={open ? undefined : { display: 'none' }} className="md-conflict-overlay" role="dialog" aria-modal="false" aria-label={t('markdownEditor.conflict.title')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); } }}>
    <header><strong>{t('markdownEditor.conflict.title')}</strong><button disabled={busy} aria-label={t('markdownEditor.close')} onClick={onClose}>×</button></header>
    <p>{t('markdownEditor.conflict.explanation')}</p>
    {stale && <p role="status" className="md-conflict-stale">{t('markdownEditor.conflict.stale')} <button disabled={busy} onClick={() => void operation(onRefresh)}>{t('markdownEditor.conflict.refresh')}</button></p>}
    {error && <p role="alert">{t(receiptUnknown ? 'markdownEditor.conflict.unknown' : 'markdownEditor.conflict.failed')}</p>}
    {comparison?.simplified && <p role="status">{t('markdownEditor.conflict.simplified')}</p>}
    {!rows ? <p role="status">{t('markdownEditor.conflict.comparing')}</p> : <>
      <nav>
        <button onClick={() => setExpanded(value => !value)}>{t(expanded ? 'markdownEditor.conflict.collapseContext' : 'markdownEditor.conflict.expandContext')}</button>
        <button aria-label={t('markdownEditor.conflict.previous')} disabled={expanded || block === 0} onClick={() => setBlock(value => value - 1)}>↑</button>
        <span>{t('markdownEditor.conflict.position', { current: blocks.length ? block + 1 : 0, total: blocks.length, remaining })}</span>
        <button aria-label={t('markdownEditor.conflict.next')} disabled={expanded || block + 1 >= blocks.length} onClick={() => setBlock(value => value + 1)}>↓</button>
      </nav>
      <div className="md-conflict-panes">
        {(['local', 'disk'] as const).map(side => <div className="md-conflict-pane" key={side}>
          <div className="md-conflict-pane-heading"><strong>{t(`markdownEditor.conflict.${side}`)}</strong><button disabled={locked} onClick={() => selectAll(side)}>{t('markdownEditor.conflict.useAll')}</button></div>
          <div className="md-conflict-lines overflow-auto" ref={element => { paneRefs.current[side] = element; }} onScroll={event => {
            const top = event.currentTarget.scrollTop; setScrollTop(top);
            const rowIndex = Math.min(visible.length - 1, Math.floor(top / 26));
            const anchor = visible[rowIndex];
            if (anchor) scrollToRow(side === 'local' ? 'disk' : 'local', anchor.id, top - rowIndex * 26);
          }}><div style={{ height: visible.length * 26, position: 'relative' }}>
            {windowRows.map((row, index) => <button key={row.id} data-row-id={row.id} onMouseEnter={() => setActiveRow(row.id)} onFocus={() => setActiveRow(row.id)} disabled={!row.changed || locked}
              onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveLine(side, row.id, event.key === 'ArrowDown' ? 1 : -1); } }} className={`md-conflict-line ${row.changed ? 'changed' : ''} ${activeRow === row.id ? 'linked' : ''} ${choices.get(row.id) === side ? 'selected' : ''}`}
              style={{ position: 'absolute', top: (firstVisible + index) * 26, height: 26 }}
              aria-pressed={row.changed ? choices.get(row.id) === side : undefined}
              aria-label={t('markdownEditor.conflict.chooseLine', { side: t(`markdownEditor.conflict.${side}`), line: row[side]?.number ?? '∅' })}
              onClick={() => setChoices(previous => { const next = new Map(previous); if (next.get(row.id) === side) next.delete(row.id); else next.set(row.id, side); return next; })}>
              <span className="md-conflict-line-number">{row[side]?.number ?? '∅'}</span>
              <code>{row.kind === 'bom' ? t(row[side] ? 'markdownEditor.conflict.bom' : 'markdownEditor.conflict.noBom') : wordDiffs.get(row.id)?.filter(part => side === 'local' ? !part.added : !part.removed).map((part, index) => part.added || part.removed ? <mark key={index}>{part.value}</mark> : part.value) ?? (row[side]?.text || t(row[side] ? 'markdownEditor.conflict.blank' : 'markdownEditor.conflict.omit'))}</code>
              {row.kind === 'line' && row.local && row.disk && row.local.ending !== row.disk.ending && <small className="md-line-ending">{row[side]!.ending === '\r\n' ? 'CRLF' : row[side]!.ending === '\r' ? 'CR' : row[side]!.ending === '\n' ? 'LF' : 'EOF'}</small>}
              <span>{row.changed ? choices.get(row.id) === side ? '✓' : '○' : ''}</span>
            </button>)}
          </div></div>
        </div>)}
      </div>
      {preview && result !== null && <textarea className="md-conflict-result" value={result} readOnly aria-label={t('markdownEditor.conflict.preview')} />}
      <footer>
        <button disabled={busy} onClick={() => void operation(onCopy)}>{t('markdownEditor.conflict.copy')}</button>
        <button disabled={result === null} onClick={() => setPreview(value => !value)}>{t('markdownEditor.conflict.preview')}</button>
        <button disabled={result === null || stale || busy || !preview} onClick={() => void operation(async () => {
          if (result !== null && await onApply(result, snapshot, result === snapshot.disk)) onClose();
        })}>{t(receiptUnknown ? 'markdownEditor.conflict.checkReceipt' : 'markdownEditor.conflict.apply')}</button>
      </footer>
    </>}
  </section>;
}
