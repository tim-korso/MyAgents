import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Compartment, EditorSelection, EditorState, Prec, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { bracketMatching, forceParsing, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Quote, X } from 'lucide-react';
import { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { useTauriFileDrop } from '@/hooks/useTauriFileDrop';
import { useOpenWebLink } from '@/context/BrowserPanelContext';
import { useFileLinkAction } from '@/context/fileActionState';
import type { FilePreviewFocusTarget } from '@/types/filePreview';
import type { MonacoQuoteSelection } from '../MonacoEditor';
import { useToast } from '../Toast';
import { copyPlainText } from '@/utils/markdownClipboard';
import { markdownSyntax } from './syntax';
import { decodeSource, encodeSource, restoreSourceFormat, sourceFormatExtensions } from './sourceFormat';
import { composing, editorFocused, focusedField, livePreview, projectionHost, revealBlock, sourceBlock, widgetHosts, type Projection, type ProjectionHost } from './livePreview';
import { applyLink, editLink, linkEditAtSelection, selectionLines, wrapSelection, type LinkEdit } from './editorCommands';
import { imageAnchors, ImageImportQueue, importImage, type ImageInput, type ImageInsertionRange, type ImageImportFailure } from './imageImport';
import { cellEditRange, cellImageRange, encodeCell, tableAt } from './tableSource';
import { definitions, type DocumentHeading } from './definitions';
import { documentOutline, type OutlineProjection } from './outlineProjection';
import DocumentOutline from './DocumentOutline';
import { documentHref } from './documentLinks';
import { useResolvedTheme } from '@/theme';
import { editorHighlight } from './editorHighlight';
import { CompositionGate, compositionGate } from './compositionGate';
import { focusDecorations, focusRanges, focusSource, revealSearch } from './focusTarget';
import ProjectionFrame from './ProjectionFrame';
import EditorSearchPanel, { createEditorSearchPanel, type SearchPanelProjection } from './EditorSearchPanel';
import './markdownEditor.css';

const Markdown = lazy(() => import('../Markdown'));
const TableProjection = lazy(() => import('./TableProjection'));

export interface MarkdownEditorHandle {
  getSource(): string;
  getRevision(): number;
  replaceSource(source: string, external: boolean): void;
  settleImports(): Promise<void>;
  settleComposition(): Promise<boolean>;
  invalidateImports(): void;
  setImportsEnabled(enabled: boolean): void;
  focus(): void;
}
interface Props {
  ref?: Ref<MarkdownEditorHandle>;
  initialSource: string;
  sourceMode: boolean;
  onExitSource?(): void;
  path: string;
  workspacePath?: string | null;
  allowImages: boolean;
  /** Existing host visibility; hiding never replaces the document/history. */
  active?: boolean;
  paused?: boolean;
  autofocus?: boolean;
  onChange(): void;
  onDetach?(source: string, path: string): void;
  onSave(): void;
  onQuote?: (selection: MonacoQuoteSelection) => void;
  focusTarget?: FilePreviewFocusTarget;
  initialLineNumber?: number;
}
interface Slot { id: number; element: HTMLElement; projection: Projection; view: EditorView }

export default function MarkdownEditor(props: Props) {
  const { t } = useTranslation('app');
  const theme = useResolvedTheme();
  const highlighting = useMemo(() => [syntaxHighlighting(editorHighlight(theme.adapters.prism)), EditorView.darkTheme.of(theme.resolvedColorScheme === 'dark'), EditorState.phrases.of({ ...t('markdownEditor.searchLabels', { returnObjects: true }) as Record<string, string>, 'Importing image': t('markdownEditor.images.importing') })], [theme, t]);
  const toast = useToast();
  const service = useWorkspaceFileService(props.workspacePath ?? null);
  const openWebLink = useOpenWebLink(), fileLinkAction = useFileLinkAction();
  const host = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null);
  const latest = useRef({ props, service, toast, t, openWebLink, fileLinkAction, highlighting });
  latest.current = { props, service, toast, t, openWebLink, fileLinkAction, highlighting };
  const revision = useRef(0), snapshot = useRef<{ revision: number; source: string }>({ revision: 0, source: props.initialSource });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectionVisible, setSelectionVisible] = useState(false);
  const [toolPosition, setToolPosition] = useState({ left: 0, top: 0 });
  const toolsElement = useRef<HTMLDivElement>(null);
  const [linkDraft, setLinkDraft] = useState<(LinkEdit & { revision: number }) | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [localSource, setLocalSource] = useState(false);
  const [searchPanel, setSearchPanel] = useState<SearchPanelProjection | null>(null);
  const [outline, setOutline] = useState<OutlineProjection | null>(null);
  const outlineCompartment = useRef(new Compartment());
  const publishOutline = useCallback((value: OutlineProjection | null, view: EditorView) => {
    setOutline(previous => value ?? (previous?.view === view ? null : previous));
  }, []);
  const [importing, setImporting] = useState(false);
  const [importIssue, setImportIssue] = useState<{ error: string; completed: string[]; remaining?: ImageInput[]; failures?: ImageImportFailure[] } | null>(null);
  const [activeTable, setActiveTable] = useState<number | null>(null);
  const compartment = useRef(new Compartment());
  const editingCompartment = useRef(new Compartment());
  const gate = useRef<CompositionGate | null>(null);
  const highlightCompartment = useRef(new Compartment());
  const imports = useRef<ImageImportQueue | null>(null);
  const acceptingImports = useRef(true);
  const buildState = useRef<(source: string) => EditorState>(() => { throw new Error('Editor is not mounted'); });

  const getSource = useCallback(() => {
    if (snapshot.current.revision !== revision.current && viewRef.current) snapshot.current = { revision: revision.current, source: encodeSource(viewRef.current.state) };
    return snapshot.current.source;
  }, []);
  const openLinkEditor = useCallback(() => {
    const view = viewRef.current;
    if (view && !view.state.readOnly) setLinkDraft({ ...linkEditAtSelection(view.state), revision: revision.current });
  }, []);
  const linkRevision = linkDraft?.revision;
  useLayoutEffect(() => { if (linkRevision !== undefined) linkInput.current?.focus(); }, [linkRevision]);
  const openDocumentLink = useCallback((raw: string) => {
    const view = viewRef.current, href = documentHref(raw, latest.current.props.path);
    if (!href || !view) return;
    if (href.startsWith('#')) {
      let target: string;
      try { target = decodeURIComponent(href.slice(1)); } catch { return; }
      // Navigation is explicit work: finish the parse with a bounded slice,
      // then use the same document index as rendering (including duplicates).
      forceParsing(view, view.state.doc.length, 100);
      const position = view.state.field(definitions).headings.get(target);
      if (position !== undefined) view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    } else if (!latest.current.fileLinkAction?.openFileLink(href)) latest.current.openWebLink(href);
  }, []);
  useImperativeHandle(props.ref, () => ({
    getSource, getRevision: () => revision.current,
    replaceSource(source, external) {
      const view = viewRef.current;
      if (!view || (!external && source === getSource())) return;
      if (external) {
        const selection = Math.min(view.state.selection.main.head, decodeSource(source).text.length);
        view.setState(buildState.current(source));
        view.dispatch({ selection: { anchor: selection } });
        revision.current++;
        snapshot.current = { revision: revision.current, source };
      } else {
        const decoded = decodeSource(source);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: decoded.text }, effects: restoreSourceFormat.of(decoded.format),
          userEvent: 'input.merge', annotations: isolateHistory.of('full') });
      }
    },
    settleComposition: () => gate.current?.run(() => {}) ?? Promise.resolve(false),
    settleImports: () => imports.current?.settled() ?? Promise.resolve(),
    invalidateImports: () => imports.current?.invalidate(),
    setImportsEnabled: enabled => { acceptingImports.current = enabled; },
    focus: () => viewRef.current?.focus(),
  }), [getSource]);

  const importImages = useCallback((inputs: ImageInput[], range?: ImageInsertionRange) => {
    if (latest.current.props.active !== false && latest.current.props.allowImages && !latest.current.props.paused && acceptingImports.current) imports.current?.enqueue(inputs, range);
  }, []);
  const dropRange = useCallback((view: EditorView, position: { x: number; y: number }): ImageInsertionRange | undefined => {
    const element = document.elementFromPoint(position.x, position.y);
    const cellElement = element?.closest<HTMLElement>('[data-md-table]');
    if (cellElement) {
      const table = tableAt(view.state, Number(cellElement.dataset.mdTable));
      if (!table) return;
      const row = Number(cellElement.dataset.mdRowIndex), column = Number(cellElement.dataset.mdColumn);
      const miniElement = cellElement.querySelector<HTMLElement>('.cm-editor'), cell = table.rows.at(row)?.cells[column];
      const mini = miniElement && EditorView.findFromDOM(miniElement);
      const offset = mini?.posAtCoords(position);
      if (cell && mini && offset != null) { const from = cell.from + encodeCell(mini.state.sliceDoc(0, offset)).length; return { from, to: from }; }
      return cellImageRange(table, row, column);
    }
    const anchor = view.posAtCoords(position);
    return anchor == null ? undefined : { from: anchor, to: anchor };
  }, []);
  const { registerZone, unregisterZone, activeZoneId } = useTauriFileDrop({ enabled: props.active !== false && props.allowImages && !props.paused });
  useEffect(() => {
    registerZone('markdown-document', host.current, (paths, position) => {
      const view = viewRef.current;
      if (!view) return;
      importImages(paths.map(path => ({ path })), position ? dropRange(view, position) : undefined);
    });
    return () => unregisterZone('markdown-document');
  }, [registerZone, unregisterZone, importImages, dropRange]);
  useEffect(() => { imports.current?.invalidate(); }, [props.path, props.workspacePath]);

  useLayoutEffect(() => {
    if (!host.current) return;
    let alive = true, queued = false, nextId = 0;
    const documentGate = new CompositionGate(host.current); gate.current = documentGate;
    const mounted = new Map<HTMLElement, Slot>();
    const publish = () => {
      if (queued) return; queued = true;
      queueMicrotask(() => { queued = false; if (alive) setSlots([...mounted.values()]); });
    };
    const registry: ProjectionHost = {
      mount(element, projection, view) {
        widgetHosts.set(element, registry);
        mounted.set(element, { id: mounted.get(element)?.id ?? ++nextId, element, projection, view }); publish();
      },
      unmount(element) { mounted.delete(element); publish(); },
    };
    const mode = () => latest.current.props.sourceMode ? [lineNumbers(), EditorView.editorAttributes.of({ class: 'md-source-mode' })] : livePreview();
    buildState.current = raw => EditorState.create({ doc: decodeSource(raw).text, extensions: [
      sourceFormatExtensions(raw), history(), EditorState.allowMultipleSelections.of(true), drawSelection(), cellEditRange, editLink.of(openLinkEditor), focusDecorations, revealSearch, compositionGate.of(documentGate),
      editingCompartment.current.of([EditorState.readOnly.of(!!latest.current.props.paused), EditorView.editable.of(!latest.current.props.paused)]), markdownSyntax(), definitions, sourceBlock, focusedField, imageAnchors, importImage.of(importImages), projectionHost.of(registry),
      compartment.current.of(mode()), outlineCompartment.current.of(latest.current.props.sourceMode || latest.current.props.active === false || latest.current.props.paused ? [] : documentOutline(publishOutline)), highlightCompartment.current.of(latest.current.highlighting), EditorView.lineWrapping, bracketMatching(), search({ createPanel: view => createEditorSearchPanel(view, (value, dom) => {
        if (alive) setSearchPanel(previous => value ?? (previous?.dom === dom ? null : previous));
      }) }),
      EditorView.focusChangeEffect.of((_state, focused) => editorFocused.of(focused)),
      EditorView.contentAttributes.of({ 'aria-label': latest.current.t('markdownEditor.document'), spellcheck: 'true' }),
      Prec.highest(keymap.of([
        { key: 'Mod-b', run: wrapSelection('**') }, { key: 'Mod-i', run: wrapSelection('*') },
        { key: 'Mod-k', run: () => { openLinkEditor(); return true; } },
        { key: 'Mod-s', run: () => { latest.current.props.onSave(); return true; } },
      ])), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) { revision.current++; setLinkDraft(null); latest.current.props.onChange(); }
        if (update.selectionSet || update.docChanged) setSelectionVisible(!update.state.selection.main.empty);
        if ((update.selectionSet || update.geometryChanged || update.viewportChanged) && !update.state.selection.main.empty) {
          update.view.requestMeasure({ key: toolsElement, read: view => {
            const shell = host.current?.parentElement?.getBoundingClientRect(); if (!shell) return null;
            const domSelection = window.getSelection();
            const range = domSelection?.rangeCount && host.current?.contains(domSelection.anchorNode) ? domSelection.getRangeAt(0).getBoundingClientRect() : null;
            const rect = range?.height ? range : view.coordsAtPos(view.state.selection.main.head);
            if (!rect || rect.bottom < shell.top || rect.top > shell.bottom) return null;
            const width = toolsElement.current?.offsetWidth ?? 400;
            return { left: Math.max(8, Math.min(shell.width - width - 8, rect.left - shell.left)), top: Math.max(4, Math.min(shell.height - 40, rect.top - shell.top < 42 ? rect.bottom - shell.top + 4 : rect.top - shell.top - 38)) };
          }, write: value => { if (value) setToolPosition(previous => previous.left === value.left && previous.top === value.top ? previous : value); } });
        }
        if (update.transactions.some(tr => tr.effects.some(effect => effect.is(revealBlock)))) setLocalSource(!!update.state.field(sourceBlock));
      }),
      EditorView.domEventHandlers({
        compositionstart(_event, view) { view.dispatch({ effects: composing.of(true) }); },
        compositionend(_event, view) { void documentGate.run(() => { if (alive) view.dispatch({ effects: composing.of(false) }); }); },
        paste(event) {
          const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
          if (!files.length || !latest.current.props.allowImages) return false;
          event.preventDefault(); importImages(files); return true;
        },
        dragover(event) { if (latest.current.props.allowImages && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); return true; } return false; },
        drop(event, view) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.length || !latest.current.props.allowImages) return false;
          event.preventDefault(); event.stopPropagation();
          importImages(files, dropRange(view, { x: event.clientX, y: event.clientY })); return true;
        },
        click(event, view) {
          if (!event.metaKey && !event.ctrlKey) return false;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position == null) return false;
          let node = syntaxTree(view.state).resolveInner(position, 1);
          while (node.parent && node.name !== 'Link' && node.name !== 'Autolink') node = node.parent;
          const urlNode = node.getChild('URL');
          if (!urlNode) return false;
          const href = view.state.sliceDoc(urlNode.from, urlNode.to).replace(/^<|>$/g, '');
          event.preventDefault();
          openDocumentLink(href);
          return true;
        },
      }),
    ] });
    const view = new EditorView({ state: buildState.current(latest.current.props.initialSource), parent: host.current });
    // Expose the native scroller to App horizontal gesture arbitration.
    view.scrollDOM.classList.add('overflow-auto');
    viewRef.current = view;
    imports.current = new ImageImportQueue(() => ({ view, path: latest.current.props.path, service: latest.current.service }),
      (error, completed, remaining, failures) => {
        if (alive) setImportIssue(previous => ({ error, completed: [...new Set([...(previous?.completed ?? []), ...completed])], remaining,
          failures: failures ? [...(previous?.failures ?? []), ...failures] : undefined }));
        else if (completed.length) latest.current.toast.error(`${latest.current.t('markdownEditor.images.targetChanged')} ${completed.join(', ')}`);
      },
      busy => { if (alive) setImporting(busy); });
    if (latest.current.props.autofocus || !view.state.doc.length) view.focus();
    return () => {
      // The host may outlive this editing surface (Settings preview, extension
      // rename). Capture once at detach, before React clears the handle. This
      // also prevents the host's unmount flush from writing its old seed text.
      latest.current.props.onDetach?.(getSource(), latest.current.props.path);
      alive = false; documentGate.dispose(); gate.current = null; imports.current?.invalidate(); imports.current = null; view.destroy(); viewRef.current = null; mounted.clear();
    };
  }, [importImages, dropRange, getSource, openDocumentLink, openLinkEditor, publishOutline]);
  useEffect(() => { viewRef.current?.dispatch({ effects: highlightCompartment.current.reconfigure(highlighting) }); }, [highlighting]);
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: outlineCompartment.current.reconfigure(props.sourceMode || props.active === false || props.paused ? [] : documentOutline(publishOutline)) });
  }, [props.sourceMode, props.active, props.paused, publishOutline]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const apply = () => view.dispatch({ effects: compartment.current.reconfigure(props.sourceMode ? [lineNumbers(), EditorView.editorAttributes.of({ class: 'md-source-mode' })] : livePreview()) });
    let current = true;
    void gate.current?.run(() => { if (current) apply(); });
    return () => { current = false; };
  }, [props.sourceMode]);
  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: editingCompartment.current.reconfigure([EditorState.readOnly.of(!!props.paused), EditorView.editable.of(!props.paused)]) });
  }, [props.paused]);
  useEffect(() => {
    const view = viewRef.current, target = props.focusTarget;
    const number = target?.lineNumber ?? props.initialLineNumber;
    if (!view || !number) return;
    const focus = target ?? { requestId: 0, lineNumber: number };
    const { line, ranges } = focusRanges(view.state, focus);
    const selection = ranges[0] ?? { from: line.from, to: line.from };
    view.dispatch({ effects: [focusSource.of(focus), revealBlock.of({ from: line.from, to: Math.max(line.from + 1, line.to) })], selection: EditorSelection.range(selection.from, selection.to), scrollIntoView: true, annotations: Transaction.addToHistory.of(false) }); view.focus();
  }, [props.focusTarget, props.initialLineNumber]);

  const basePath = props.path.includes('/') ? props.path.slice(0, props.path.lastIndexOf('/')) : '';
  const navigateHeading = (heading: DocumentHeading) => {
    const view = viewRef.current;
    // React may still show the preceding measurement's outline immediately
    // after a CM edit. Only the current document index can authorize offsets.
    if (!view || !view.state.field(definitions).outline.includes(heading)) return;
    const doc = view.state.doc;
    void gate.current?.run(() => {
      // A queued IME action must never apply offsets from an older document.
      if (viewRef.current !== view || view.state.doc !== doc) return;
      view.dispatch({ selection: { anchor: heading.from }, effects: [revealBlock.of(null), EditorView.scrollIntoView(heading.from, { y: 'start', yMargin: 28 })] });
    });
  };
  const openFootnote = (label: string) => {
    const view = viewRef.current; if (!view) return;
    const target = view.state.field(definitions).footnotes.get(label.trim().replace(/\s+/g, ' ').toLowerCase());
    if (target) { view.dispatch({ selection: { anchor: target.from }, effects: revealBlock.of(target), scrollIntoView: true }); view.focus(); }

  };
  const quote = () => {
    const view = viewRef.current; if (!view) return;
    const { from, to } = view.state.selection.main;
    // Use the format-aware source snapshot's physical lines, then preserve the
    // exact selected offsets within those lines (including CRLF separators).
    const lines = selectionLines(view.state);
    const raw = getSource().replace(/^\uFEFF/, '').split(/(?<=\n)|(?<=\r)(?!\n)/);
    const firstOffset = from - view.state.doc.lineAt(from).from;
    const lastLine = view.state.doc.lineAt(to);
    const lastOffset = to - lastLine.from;
    const selected = raw.slice(view.state.doc.lineAt(from).number - 1, lastLine.number);
    if (selected.length) { selected[selected.length - 1] = selected.at(-1)!.slice(0, lastOffset); selected[0] = selected[0].slice(firstOffset); }
    latest.current.props.onQuote?.({ text: selected.join(''), ...lines });
  };
  return <div inert={props.paused || props.active === false || undefined} className={`md-editor-shell ${activeZoneId ? 'md-drop-active' : ''}`} onClickCapture={event => {
    const link = (event.target as Element).closest?.('a');
    if (!link) return;
    event.preventDefault(); event.stopPropagation();
    if (link.hasAttribute('data-footnote-ref')) {
      const id = link.getAttribute('href')?.replace(/^#user-content-fn-/, ''); if (id) { try { openFootnote(decodeURIComponent(id)); } catch { /* malformed source anchor */ } }
    } else if (event.metaKey || event.ctrlKey) openDocumentLink(link.getAttribute('href') ?? '');
    else {
      const cell = link.closest<HTMLElement>('[data-md-table]');
      if (cell) { cell.focus(); return; }
      const slot = slots.find(item => item.element.contains(link));
      if (slot) { slot.view.dispatch({ selection: { anchor: slot.projection.from }, effects: revealBlock.of(slot.projection) }); slot.view.focus(); }
    }
  }}>
    {(props.sourceMode ? props.onExitSource : localSource) && <div className="md-editor-modebar"><button className="md-source-badge" aria-label={t('markdownEditor.exitSource')} onMouseDown={event => event.preventDefault()} onClick={() => {
      const view = viewRef.current;
      if (props.sourceMode) { props.onExitSource?.(); view?.focus(); }
      else if (view) void gate.current?.run(() => { view.dispatch({ effects: revealBlock.of(null) }); view.focus(); });
    }}><span>{t(props.sourceMode ? 'markdownEditor.source' : 'markdownEditor.blockSource')}</span><X size={14} aria-hidden="true" /></button></div>}
    <div className="md-editor-status">
      {importing && <><span role="status">{t('markdownEditor.images.importing')}</span><button onClick={() => imports.current?.invalidate('cancelled')}>{t('markdownEditor.images.cancel')}</button></>}
    </div>
    {importIssue && <div className="md-import-issue" role="status">
      <span>{t(`markdownEditor.images.${/unknown/i.test(importIssue.error) ? 'unknown' : ['batchLimit', 'imageLimit', 'targetChanged', 'cancelled'].includes(importIssue.error) ? importIssue.error : 'failed'}`)}</span>
      {importIssue.completed.length > 0 && <span title={importIssue.completed.join('\n')}>{importIssue.completed.join(', ')}</span>}
      {importIssue.failures?.map((failure, index) => <span className="md-import-failure" key={index}>
        <span>{failure.input instanceof File ? failure.input.name : failure.input.path.split(/[/\\]/).at(-1)}: {t(`markdownEditor.images.${/unknown/i.test(failure.error) ? 'unknown' : /limit|large|budget/i.test(failure.error) ? 'imageLimit' : /format|supported|extension|invalid|SVG/i.test(failure.error) ? 'invalidFormat' : 'readWriteFailed'}`)}</span>
        {!/unknown/i.test(failure.error) && <button onClick={() => {
          setImportIssue(current => {
            const failures = current?.failures?.filter(item => item !== failure);
            return current && failures?.length ? { ...current, failures } : null;
          });
          importImages([failure.input]);
        }}>{t('markdownEditor.images.retry')}</button>}
      </span>)}
      {/unknown/i.test(importIssue.error) && !!importIssue.remaining?.length && <span>{t('markdownEditor.images.unattempted', { names: importIssue.remaining.map(input => input instanceof File ? input.name : input.path.split(/[/\\]/).at(-1)).join(', ') })}</span>}
      <button onClick={() => {
        const assets = props.path.replace(/\.[^/.]+$/, '_assets');
        void service.openInFinder({ path: importIssue.completed[0] ?? assets }).catch(() => latest.current.toast.error(t('markdownEditor.images.openFailed')));
      }}>{t('markdownEditor.images.openAssets')}</button>
      {!!importIssue.remaining?.length && !importIssue.failures?.length && !/unknown/i.test(importIssue.error) && <button onClick={() => { importImages(importIssue.remaining!); setImportIssue(null); }}>{t('markdownEditor.images.retry')}</button>}
      <button aria-label={t('markdownEditor.close')} onClick={() => setImportIssue(null)}>×</button>
    </div>}
    <div ref={host} className="md-editor-host" />
    {outline && outline.headings.length > 0 && !props.sourceMode && props.active !== false && !props.paused && <DocumentOutline {...outline} onNavigate={navigateHeading} />}
    {selectionVisible && !linkDraft && !searchPanel && <div ref={toolsElement} style={toolPosition} className="md-selection-tools overflow-auto" role="toolbar" aria-label={t('markdownEditor.formatting')} onMouseDown={event => event.preventDefault()}>
      {([['bold', '**'], ['italic', '*'], ['strike', '~~'], ['code', '`'], ['link', '[']] as const).map(([label, marker]) => <button key={label} onClick={() => { if (marker === '[') openLinkEditor(); else if (viewRef.current) wrapSelection(marker)(viewRef.current); }}>{t(`markdownEditor.${label}`)}</button>)}
      {props.onQuote && <><span className="md-selection-divider" role="separator" aria-orientation="vertical" /><button className="md-selection-quote" onClick={quote}><Quote size={12} aria-hidden="true" />{t('chat:workspaceFiles.common.quote')}</button></>}
    </div>}
    {searchPanel && createPortal(<EditorSearchPanel {...searchPanel} active={props.active} />, searchPanel.dom)}
    {linkDraft && <form className="md-link-editor" role="dialog" aria-label={t('markdownEditor.link')} onSubmit={event => {
      event.preventDefault(); const view = viewRef.current;
      if (view && revision.current === linkDraft.revision && linkDraft.url.trim()) applyLink(view, linkDraft, linkDraft.url);
      setLinkDraft(null);
    }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setLinkDraft(null); viewRef.current?.focus(); } }}>
      <label>{t('markdownEditor.linkAddress')}<input ref={linkInput} value={linkDraft.url} placeholder="https://" onChange={event => setLinkDraft({ ...linkDraft, url: event.target.value })} /></label>
      <button type="submit" disabled={!linkDraft.url.trim()}>{t('markdownEditor.linkApply')}</button>
      {!!linkDraft.url && <button type="button" onClick={() => openDocumentLink(linkDraft.url)}>{t('markdownEditor.openLink')}</button>}
      <button type="button" aria-label={t('markdownEditor.close')} onClick={() => { setLinkDraft(null); viewRef.current?.focus(); }}>×</button>
    </form>}
    {slots.map(slot => createPortal(<Suspense fallback={<span className="md-render-loading">{t('markdownEditor.rendering')}</span>}>
      <ProjectionFrame element={slot.element} view={slot.view}>{slot.projection.kind === 'CodeHeader' ? <div className="md-code-header"><span>{/^\s*(?:`{3,}|~{3,})(\S*)/.exec(slot.projection.source)?.[1] ?? t('markdownEditor.code')}</span><button onClick={() => {
        const source = slot.view.state.sliceDoc(slot.projection.from, slot.projection.to);
        const code = /^\s*(?:`{3,}|~{3,})/.test(source) ? source.replace(/^[^\n]*\n/, '').replace(/\n[ \t]*(?:`{3,}|~{3,})\s*$/, '') : source;
        void copyPlainText(code).catch(() => latest.current.toast.error(t('markdownEditor.copyFailed')));
      }}>{t('markdownEditor.copyCode')}</button></div> : slot.projection.kind === 'Table' ? <TableProjection projection={slot.projection} view={slot.view} workspacePath={props.workspacePath} basePath={basePath}
        focused={activeTable === slot.id} presentationActive={props.active} onActivate={() => setActiveTable(slot.id)} /> : slot.projection.kind === 'LinkReference' ?
        <button className="md-reference-definition" onClick={() => { slot.view.dispatch({ effects: revealBlock.of(slot.projection), selection: { anchor: slot.projection.from } }); slot.view.focus(); }}>{t('markdownEditor.referenceDefinition')} · {/^\[([^\]]+)\]/.exec(slot.projection.source)?.[1]}</button> : slot.projection.kind === 'FootnoteReference' ?
        <sup><button onClick={() => openFootnote(slot.projection.source.slice(2, -1))}>{slot.view.state.field(definitions).footnotes.get(slot.projection.source.slice(2, -1).toLowerCase())?.number ?? slot.projection.source}</button></sup> :
        <div className="md-rendered-block" onDoubleClick={() => { slot.view.dispatch({ effects: revealBlock.of(slot.projection), selection: { anchor: slot.projection.from } }); slot.view.focus(); }}>
          {['Frontmatter', 'MathBlock', 'HTMLBlock', 'FencedCode', 'FootnoteDefinition', 'Image', 'HorizontalRule'].includes(slot.projection.kind) && <button className="md-render-source" onClick={() => { slot.view.dispatch({ effects: revealBlock.of(slot.projection), selection: { anchor: slot.projection.from } }); slot.view.focus(); }}>{t('markdownEditor.editSource')}</button>}
          {slot.projection.kind === 'FootnoteDefinition' && <span className="md-footnote-label">{slot.projection.footnoteNumbers?.get(slot.projection.source.match(/^\[\^([^\]]+)\]/)?.[1]?.toLowerCase() ?? '') ?? slot.projection.source.match(/^\[\^([^\]]+)\]/)?.[1]}</span>}
          <Markdown footnoteNumbers={slot.projection.footnoteNumbers} raw preserveNewlines basePath={basePath} workspacePath={props.workspacePath}>{(slot.projection.kind === 'FootnoteDefinition' ? slot.projection.source.replace(/^\[\^[^\]]+\]:\s*/, '').replace(/\n(?: {4}|\t)/g, '\n') : slot.projection.renderSource ?? slot.projection.source) + (slot.projection.definitions ? '\n\n' + slot.projection.definitions : '')}</Markdown>
        </div>}</ProjectionFrame>
    </Suspense>, slot.element, String(slot.id)))}
  </div>;
}
