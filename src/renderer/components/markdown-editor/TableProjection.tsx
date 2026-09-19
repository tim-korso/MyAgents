import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view';
import { defaultKeymap, undo, redo } from '@codemirror/commands';
import { isolateHistory } from '@codemirror/commands';
import { tableAt, tableAction, pasteTableCells, replaceCell, encodeCell, cellImageRange, cellEditRange, setCellEditRange, type TableAction } from './tableSource';
import { revealBlock, type Projection } from './livePreview';
import { markdownSyntax } from './syntax';
import Markdown from '../Markdown';
import CustomSelect from '../CustomSelect';
import { importImage } from './imageImport';
import { compositionGate } from './compositionGate';
import { editLink, wrapSelection } from './editorCommands';
import TableActions from '../markdown/TableActions';
import { editorTableSnapshot } from './tableExport';
import { useTableIntrinsicSizing } from '../markdown/useTableIntrinsicSizing';
import { tableGeometry } from './tableGeometry';
import type { TableSnapshot } from '@/utils/tableExport';

interface Props { projection: Projection; view: EditorView; workspacePath?: string | null; basePath: string; focused: boolean; presentationActive?: boolean; onActivate(): void }

export default function TableProjection({ projection, view, workspacePath, basePath, focused, presentationActive = true, onActivate }: Props) {
  const { t } = useTranslation('app');
  const [active, setActive] = useState<{ row: number; column: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const mini = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const tableElement = useRef<HTMLTableElement>(null);
  const [rowHeights, setRowHeights] = useState<ReadonlyMap<number, number>>(new Map());
  const [rowWindow, setRowWindow] = useState({ from: 1, to: 30 });
  const latest = useRef({ projection, active });
  useLayoutEffect(() => { latest.current = { projection, active }; });
  const model = useMemo(() => tableAt(view.state, projection.from), [view, projection]);
  useTableIntrinsicSizing(tableElement, Boolean(model));
  const rowCount = model?.rows.length ?? 0;
  const geometry = useMemo(() => tableGeometry(rowCount, rowHeights), [rowCount, rowHeights]);
  useLayoutEffect(() => {
    const table = tableElement.current;
    if (!table || rowCount < 60) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const tableTop = table.getBoundingClientRect().top, scroller = view.scrollDOM.getBoundingClientRect();
      const top = Math.max(0, scroller.top - tableTop), bottom = top + scroller.height;
      const from = Math.max(1, geometry.rowAt(top) - 5), to = Math.min(rowCount - 1, geometry.rowAt(bottom) + 5);
      setRowWindow(previous => previous.from === from && previous.to === to ? previous : { from, to });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    view.scrollDOM.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule); resize.observe(view.scrollDOM); schedule();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); view.scrollDOM.removeEventListener('scroll', schedule); };
  }, [view, rowCount, geometry]);
  useLayoutEffect(() => {
    const table = tableElement.current;
    if (!table || rowCount < 60) return;
    const observer = new ResizeObserver(entries => {
      setRowHeights(previous => {
        const next = new Map(previous); let changed = false;
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.mdRow);
          const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
          if (height > 0 && next.get(index) !== height) { changed = true; next.set(index, height); }
        }
        return changed ? next : previous;
      });
    });
    for (const row of table.querySelectorAll('[data-md-row]')) observer.observe(row);
    return () => observer.disconnect();
  }, [rowCount, rowWindow, active]);
  const act = (action: TableAction) => { void view.state.facet(compositionGate).run(() => {
    const table = tableAt(view.state, latest.current.projection.from);
    if (!table) return;
    const target = latest.current.active ?? { row: 0, column: 0 };
    view.dispatch({ changes: tableAction(view.state, table, action, target.row, target.column), userEvent: 'input.table', annotations: isolateHistory.of('full') });
    setActive(null);
    view.focus();
  }); };
  useLayoutEffect(() => {
    if (!active || !host.current || !focused) return;
    const table = tableAt(view.state, latest.current.projection.from);
    if (!table) return;
    const changeHistory = (command: typeof undo) => {
      const changed = command(view);
      if (changed) { setActive(null); view.focus(); }
      return true;
    };
    const move = (direction: number, nextRow = false) => {
      const current = tableAt(view.state, latest.current.projection.from);
      if (!current) return true;
      let row = active.row, column = active.column;
      if (nextRow) row++;
      else { column += direction; if (column >= current.columns) { column = 0; row++; } if (column < 0) { column = current.columns - 1; row--; } }
      if (row < 0) { setActive(null); view.dispatch({ selection: { anchor: Math.max(0, current.from - 1) }, scrollIntoView: true }); view.focus(); return true; }
      if (row >= current.rows.length) view.dispatch({ changes: tableAction(view.state, current, 'row-after', current.rows.length - 1, 0), userEvent: 'input.table', annotations: isolateHistory.of('full') });
      setActive({ row, column }); return true;
    };
    const editor = new EditorView({ parent: host.current, state: EditorState.create({
      doc: table.rows.at(active.row)?.cells[active.column]?.text ?? '',
      extensions: [markdownSyntax(), EditorView.lineWrapping, Prec.highest(keymap.of([
        { key: 'Mod-b', run: wrapSelection('**') },
        { key: 'Mod-k', run: () => { view.state.facet(editLink)(); return true; } },
        { key: 'Mod-i', run: wrapSelection('*') },
        { key: 'Tab', run: () => move(1) }, { key: 'Shift-Tab', run: () => move(-1) },
        { key: 'Enter', run: () => move(1, true) },
        { key: 'Shift-Enter', run: cell => { cell.dispatch(cell.state.replaceSelection('<br>'), { userEvent: 'input' }); return true; } },
        { key: 'Escape', run: () => { setActive(null); view.focus(); return true; } },
        { key: 'Mod-z', run: () => changeHistory(undo) },
        { key: 'Mod-Shift-z', run: () => changeHistory(redo) },
        { key: 'Mod-y', run: () => changeHistory(redo) },
      ])), keymap.of(defaultKeymap), EditorView.domEventHandlers({
        beforeinput(event) {
          if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return false;
          event.preventDefault();
          return changeHistory(event.inputType === 'historyUndo' ? undo : redo);
        },
        keydown(event) {
          if (!event.isComposing && (event.metaKey || event.ctrlKey) && ['s', 'f'].includes(event.key.toLowerCase())) return runScopeHandlers(view, event, 'editor');
          return false;
        },
        paste(event) {
          const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
          if (files.length) {
            const currentTable = tableAt(view.state, latest.current.projection.from);
            const current = view.state.field(cellEditRange);
            if (!currentTable || !mini.current) return false;
            event.preventDefault();
            const selection = mini.current.state.selection.main;
            view.state.facet(importImage)(files, current ? { from: current.from + encodeCell(mini.current.state.sliceDoc(0, selection.from)).length, to: current.from + encodeCell(mini.current.state.sliceDoc(0, selection.to)).length } : cellImageRange(currentTable, active.row, active.column));
            return true;
          }
          const text = event.clipboardData?.getData('text/plain');
          if (!text || !/[\t\r\n]/.test(text)) return false;
          const current = tableAt(view.state, latest.current.projection.from);
          if (!current) return false;
          event.preventDefault();
          view.dispatch({ changes: pasteTableCells(view.state, current, active.row, active.column, text), userEvent: 'input.paste', annotations: isolateHistory.of('full') });
          setActive(null); view.focus(); return true;
        },
      }), EditorView.updateListener.of(update => {
        if (syncing.current) return;
        const current = tableAt(view.state, latest.current.projection.from);
        if (!current) return;
        // The cell has no history or independent persistence. Every accepted
        // keystroke belongs to the parent document's transaction stream.
        if (update.docChanged) {
          const range = view.state.field(cellEditRange) ?? undefined;
          const existingCell = current.rows.at(active.row)?.cells[active.column];
          const missing = !existingCell ? cellImageRange(current, active.row, active.column) : null;
          const change = replaceCell(current, active.row, active.column, update.state.doc.toString(), range);
          view.dispatch({ changes: change, userEvent: update.transactions.find(tr => tr.docChanged)?.annotation(Transaction.userEvent) ?? 'input.type' });
          const cell = tableAt(view.state, latest.current.projection.from)?.rows.at(active.row)?.cells[active.column];
          const from = range?.from ?? (missing ? missing.from + (missing.prefix?.length ?? 0) : cell?.from);
          if (from !== undefined) view.dispatch({ effects: setCellEditRange.of({ from, to: from + encodeCell(update.state.doc.toString()).length }) });
        }
        if (update.selectionSet || update.docChanged) {
          const cell = view.state.field(cellEditRange);
          if (cell) view.dispatch({ selection: { anchor: cell.from + encodeCell(update.state.sliceDoc(0, update.state.selection.main.anchor)).length,
            head: cell.from + encodeCell(update.state.sliceDoc(0, update.state.selection.main.head)).length } });
        }
      })],
    }) });
    mini.current = editor;
    const cell = table.rows.at(active.row)?.cells[active.column];
    view.dispatch({ effects: setCellEditRange.of(cell ? { from: cell.from, to: cell.to } : null), selection: { anchor: cell?.from ?? cellImageRange(table, active.row, active.column).from } });
    editor.focus();
    return () => { mini.current = null; editor.destroy(); };
  }, [active, view, focused]);
  useLayoutEffect(() => {
    const editor = mini.current;
    if (!editor || !active) return;
    const synchronize = () => {
      const cell = view.state.field(cellEditRange);
      if (!cell) return;
      const text = view.state.sliceDoc(cell.from, cell.to);
      if (encodeCell(editor.state.doc.toString()) === text) return;
      syncing.current = true;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
      syncing.current = false;
    };
    let current = true;
    void view.state.facet(compositionGate).run(() => { if (current) synchronize(); });
    return () => { current = false; };
  }, [projection, active, view]);
  if (!model) return <pre>{view.state.sliceDoc(projection.from, projection.to)}</pre>;
  const extraFrom = rowCount < 60 ? 0 : Math.min(rowCount, rowWindow.from);
  const extraTo = rowCount < 60 ? rowCount : Math.min(rowCount, rowWindow.to + 1);
  const extraCells = Array.from({ length: extraTo - extraFrom }, (_, index) => model.rows.at(extraFrom + index)).some(row => row && row.cells.length > model.columns);
  return <div className="md-table-shell">
    <TableActions disabled={!presentationActive} getSnapshot={() => new Promise<TableSnapshot>((resolve, reject) => {
      void view.state.facet(compositionGate).run(() => {
        try { resolve(editorTableSnapshot(view.state, latest.current.projection.from)); }
        catch (error) { reject(error); }
      }).then(executed => { if (!executed) reject(new Error('Editor closed')); });
    })} />
    <div className="md-block-actions">
      <CustomSelect ariaLabel={t('markdownEditor.table.actions')} placeholder={t('markdownEditor.table.actions')} compact popoverMinWidth={208} disabled={!presentationActive} value="" onChange={value => act(value as TableAction)}
        options={(['row-before', 'row-after', 'delete-row', 'column-before', 'column-after', 'delete-column', 'align-left', 'align-center', 'align-right'] as const)
          .filter(action => action !== 'delete-row' || active && active.row > 0)
          .map(action => ({ value: action, label: t(`markdownEditor.table.${action}`) }))} />
      <button onClick={() => { void view.state.facet(compositionGate).run(() => { view.dispatch({ effects: revealBlock.of(latest.current.projection), selection: { anchor: latest.current.projection.from } }); view.focus(); }); }}>{t('markdownEditor.editSource')}</button>
    </div>
    {extraCells && <span className="md-table-extra">{t('markdownEditor.table.extraCells')}</span>}
    <div className="md-table-scroll overflow-x-auto"><table ref={tableElement}><tbody>
      {(() => {
        const indices = rowCount < 60 ? Array.from({ length: rowCount }, (_, index) => index) : [0, ...Array.from({ length: Math.max(0, rowWindow.to - rowWindow.from + 1) }, (_, index) => rowWindow.from + index)];
        if (focused && active && !indices.includes(active.row)) indices.push(active.row);
        indices.sort((a, b) => a - b);
        const elements = [];
        let previous = -1;
        const spacer = (from: number, to: number) => <tr key={`gap-${from}`} aria-hidden="true"><td colSpan={model.columns} style={{ padding: 0, border: 0, height: geometry.offset(to) - geometry.offset(from) }} /></tr>;
        for (const rowIndex of indices) {
          const row = model.rows.at(rowIndex); if (!row) continue;
          if (rowIndex > previous + 1) elements.push(spacer(previous + 1, rowIndex));
          elements.push(<tr key={rowIndex} data-md-row={rowIndex}>{Array.from({ length: model.columns }, (_, columnIndex) => {
        const cell = row.cells[columnIndex];
        const selected = focused && active?.row === rowIndex && active.column === columnIndex;
        const Tag = rowIndex === 0 ? 'th' : 'td';
        const alignment = model.delimiter.cells[columnIndex]?.text ?? '';
        return <Tag key={columnIndex} data-md-cell-from={cell?.from} data-md-cell-to={cell?.to} data-md-table={projection.from} data-md-row-index={rowIndex} data-md-column={columnIndex} style={{ textAlign: alignment.endsWith(':') ? alignment.startsWith(':') ? 'center' : 'right' : 'left' }}
          tabIndex={selected ? -1 : 0} aria-label={t('markdownEditor.table.cell', { row: rowIndex + 1, column: columnIndex + 1 })}
          onFocus={event => { if (event.target === event.currentTarget) { onActivate(); setActive({ row: rowIndex, column: columnIndex }); } }}
          onClick={() => { if (!selected && !mini.current?.composing) { onActivate(); setActive({ row: rowIndex, column: columnIndex }); } }}>
          {selected ? <div ref={host} className="md-cell-editor" /> : <Markdown footnoteNumbers={projection.footnoteNumbers} compact raw basePath={basePath} workspacePath={workspacePath}>{(cell?.text || '\u00a0') + (projection.definitions ? '\n\n' + projection.definitions : '')}</Markdown>}
        </Tag>;
          })}</tr>);
          previous = rowIndex;
        }
        if (previous + 1 < rowCount) elements.push(spacer(previous + 1, rowCount));
        return elements;
      })()}
    </tbody></table></div>
  </div>;
}
