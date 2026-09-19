import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, MoreHorizontal, Search, X } from 'lucide-react';
import { EditorView, runScopeHandlers, type Panel } from '@codemirror/view';
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, selectMatches, setSearchQuery } from '@codemirror/search';
import { Popover } from '@/components/ui/Popover';
import Tip from '@/components/Tip';

export interface SearchPanelProjection { dom: HTMLElement; view: EditorView; query: SearchQuery; readOnly: boolean }

/** CM owns panel/query lifetime; React only renders its current projection. */
export function createEditorSearchPanel(view: EditorView, render: (value: SearchPanelProjection | null, dom: HTMLElement) => void): Panel {
  const dom = document.createElement('div');
  dom.className = 'md-search-panel';
  let query = getSearchQuery(view.state), readOnly = view.state.readOnly;
  return {
    dom, top: true,
    mount() { render({ dom, view, query, readOnly }, dom); },
    update() {
      const next = getSearchQuery(view.state);
      if (query === next && readOnly === view.state.readOnly) return;
      query = next; readOnly = view.state.readOnly;
      render({ dom, view, query, readOnly }, dom);
    },
    destroy() { render(null, dom); },
  };
}

export default function EditorSearchPanel({ view, query, readOnly, active = true }: SearchPanelProjection & { active?: boolean }) {
  const { t } = useTranslation('app');
  const input = useRef<HTMLInputElement>(null), more = useRef<HTMLButtonElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  useLayoutEffect(() => { if (active) { input.current?.focus(); input.current?.select(); } }, [view, active]);
  // FloatingPortal can mount after this component's layout effect. Focus at
  // actual attachment; a stable ref avoids stealing focus on query updates.
  const focusOptions = useCallback((node: HTMLDivElement | null) => { node?.querySelector<HTMLInputElement>('input')?.focus(); }, []);
  const setQuery = (change: Partial<ConstructorParameters<typeof SearchQuery>[0]>) => {
    const next = new SearchQuery({ ...getSearchQuery(view.state), ...change });
    if (!next.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(next) });
  };
  const close = () => { closeSearchPanel(view); view.focus(); };
  return <div className="md-search-controls" role="search" aria-label={t('markdownEditor.find')} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && optionsOpen) {
      event.preventDefault(); event.stopPropagation(); setOptionsOpen(false); more.current?.focus();
    } else if (runScopeHandlers(view, event.nativeEvent, 'search-panel')) {
      event.preventDefault(); event.stopPropagation();
    } else if (event.key === 'Enter' && event.target === input.current) {
      event.preventDefault(); (event.shiftKey ? findPrevious : findNext)(view);
    }
  }}>
    <div className="md-search-row">
      <Search size={15} className="md-search-icon" aria-hidden="true" />
      <input ref={input} {...{ 'main-field': 'true' }} name="search" value={query.search} aria-label={t('markdownEditor.find')}
        placeholder={t('markdownEditor.find')} aria-invalid={!!query.search && !query.valid} autoComplete="off" spellCheck={false}
        onChange={event => setQuery({ search: event.target.value })} />
      <Tip label={t('markdownEditor.searchPrevious')}><button type="button" aria-label={t('markdownEditor.searchPrevious')} disabled={!query.valid} onClick={() => findPrevious(view)}><ArrowUp size={16} /></button></Tip>
      <Tip label={t('markdownEditor.searchNext')}><button type="button" aria-label={t('markdownEditor.searchNext')} disabled={!query.valid} onClick={() => findNext(view)}><ArrowDown size={16} /></button></Tip>
      <Tip label={t('markdownEditor.searchOptions')} disabled={optionsOpen}><button ref={more} type="button" aria-label={t('markdownEditor.searchOptions')} aria-haspopup="dialog" aria-expanded={optionsOpen}
        onClick={() => setOptionsOpen(value => !value)}><MoreHorizontal size={16} /></button></Tip>
      <Tip label={t('markdownEditor.close')}><button type="button" aria-label={t('markdownEditor.close')} onClick={close}><X size={16} /></button></Tip>
    </div>
    {query.search && !query.valid && <div className="md-search-error" role="status">{t('markdownEditor.searchInvalid')}</div>}
    <Popover open={optionsOpen && active} onClose={() => setOptionsOpen(false)} anchorRef={more} placement="bottom-end" closeOnEscape={false} className="md-search-options">
      <div ref={focusOptions} role="dialog" aria-label={t('markdownEditor.searchOptions')}>
        {(['caseSensitive', 'regexp', 'wholeWord'] as const).map(option => <label className="md-search-option" key={option}>
          <input type="checkbox" checked={query[option]} onChange={event => setQuery({ [option]: event.target.checked })} />
          <span>{t(`markdownEditor.search${option === 'caseSensitive' ? 'Case' : option === 'regexp' ? 'Regexp' : 'Word'}`)}</span>
        </label>)}
        <button type="button" className="md-search-select" disabled={!query.valid} onClick={() => { selectMatches(view); setOptionsOpen(false); view.focus(); }}>{t('markdownEditor.searchSelectAll')}</button>
        {!readOnly && <form className="md-search-replace" onSubmit={event => { event.preventDefault(); replaceNext(view); }}>
          <label>{t('markdownEditor.searchReplace')}<input value={query.replace} aria-label={t('markdownEditor.searchReplace')} onChange={event => setQuery({ replace: event.target.value })} /></label>
          <div><button type="submit" disabled={!query.valid}>{t('markdownEditor.searchReplace')}</button><button type="button" disabled={!query.valid} onClick={() => replaceAll(view)}>{t('markdownEditor.searchReplaceAll')}</button></div>
        </form>}
      </div>
    </Popover>
  </div>;
}
