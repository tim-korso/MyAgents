/**
 * ChatSearchPanel — floating top-right in-page text finder for Chat.
 *
 * Fixed-width single-row panel. Scope is only already rendered messages;
 * virtualized items are not searchable (see useChatSearch).
 *
 * Interaction:
 *   • Enter = next match, Shift+Enter = previous
 *   • Esc closes
 *   • Cmd/Ctrl+F inside the input re-selects the text
 */

import { isImeComposingEvent } from '@/utils/imeKeyboard';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatSearchController } from '@/hooks/useChatSearch';

const PANEL_WIDTH = 340;

interface ChatSearchPanelProps {
  controller: ChatSearchController;
  onClose: () => void;
}

export default function ChatSearchPanel({ controller, onClose }: ChatSearchPanelProps) {
  const { t } = useTranslation('chat');
  const { query, setQuery, matchCount, currentIndex, next, prev, hasQuery } = controller;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposingEvent(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) prev();
      else next();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      inputRef.current?.select();
    }
  };

  const counterLabel = (() => {
    if (!hasQuery) return '';
    if (matchCount === 0) return '0 / 0';
    return `${currentIndex + 1} / ${matchCount}`;
  })();

  return (
    <div
      className="absolute right-4 top-3 z-[100] flex items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] px-2 py-1.5 shadow-md"
      style={{ width: PANEL_WIDTH }}
      role="search"
      onMouseDown={e => e.stopPropagation()}
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('shell.search.placeholder')}
        aria-label={t('shell.search.placeholder')}
        className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
      />
      <span className="shrink-0 text-xs tabular-nums text-[var(--ink-muted)]">
        {counterLabel}
      </span>
      <div className="mx-0.5 h-4 w-px bg-[var(--line)]" />
      <button
        type="button"
        onClick={prev}
        disabled={matchCount === 0}
        title={t('shell.search.previousTitle')}
        aria-label={t('shell.search.previousAria')}
        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={next}
        disabled={matchCount === 0}
        title={t('shell.search.nextTitle')}
        aria-label={t('shell.search.nextAria')}
        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title={t('shell.search.closeTitle')}
        aria-label={t('shell.search.closeAria')}
        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
