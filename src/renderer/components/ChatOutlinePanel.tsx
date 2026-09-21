/**
 * ChatOutlinePanel — floating turn index for a long session.
 *
 * Why a turn list rather than more search: finding "the turn where I asked
 * about the migration" is a positional question. Text search answers it only
 * if you already remember the wording, and scrolling answers it only if the
 * turn is near where you already are. A one-line-per-turn index answers it
 * directly.
 *
 * Scope note: entries come from the loaded transcript, so a session whose older
 * pages have not been paged in lists only what is present. That matches
 * ChatSearchPanel's documented scope (already-rendered messages), and is
 * preferable to fabricating anchors that cannot be scrolled to.
 */
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatOutlineEntry } from '@/utils/chatOutline';

const PANEL_WIDTH = 300;
/** Keeps the list from growing past a comfortable glance; it scrolls beyond this. */
const MAX_VISIBLE = 12;

interface ChatOutlinePanelProps {
  entries: readonly ChatOutlineEntry[];
  /** Index of the turn the viewport is currently reading, or -1 before the first. */
  activeIndex: number;
  onJump: (entry: ChatOutlineEntry) => void;
  onClose: () => void;
}

export default function ChatOutlinePanel({
  entries,
  activeIndex,
  onJump,
  onClose,
}: ChatOutlinePanelProps) {
  const { t } = useTranslation('chat');
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the active turn in view as the user scrolls, so the list tracks the
  // reading position instead of drifting off-screen in a long session.
  useEffect(() => {
    // Guarded: `scrollIntoView` is absent in some embedded WebViews (and in
    // jsdom). Losing the auto-scroll is a cosmetic degradation; an unguarded
    // call would throw inside an effect and take the panel down with it.
    const node = activeRef.current;
    if (typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="absolute right-4 top-3 z-[100] flex flex-col rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] py-1.5 shadow-md"
      style={{ width: PANEL_WIDTH }}
      role="navigation"
      aria-label={t('shell.outline.title')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-xs font-semibold text-[var(--ink-muted)]">
          {t('shell.outline.title')}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-xs tabular-nums text-[var(--ink-muted)]">
            {entries.length > 0 && activeIndex >= 0 ? `${activeIndex + 1} / ${entries.length}` : entries.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            title={t('shell.outline.closeTitle')}
            aria-label={t('shell.outline.closeAria')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--ink-muted)]">
          {t('shell.outline.empty')}
        </div>
      ) : (
        <div
          className="overflow-y-auto px-1"
          style={{ maxHeight: `${MAX_VISIBLE * 30}px` }}
        >
          {entries.map((entry, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={entry.id}
                ref={isActive ? activeRef : undefined}
                type="button"
                onClick={() => onJump(entry)}
                aria-current={isActive ? 'true' : undefined}
                className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                  isActive
                    ? 'bg-[var(--accent-warm-subtle)] text-[var(--ink)]'
                    : 'text-[var(--ink-secondary)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]'
                }`}
              >
                <span className="shrink-0 text-xs tabular-nums text-[var(--ink-muted)]">
                  {entry.turnIndex}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs" title={entry.preview}>
                  {entry.preview}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
