import type { Thought } from '@/../shared/types/thought';
import { useTranslation } from 'react-i18next';
import { isSupportedLocale } from '@/../shared/i18n';
import {
  findHighlightRanges,
  renderTextWithHighlights,
} from '@/utils/highlightSearchMatches';
import { formatPastRelativeTime } from '@/i18n/format';

interface ThoughtPickerRowProps {
  thought: Thought;
  query: string;
  active: boolean;
  onClick: () => void;
}

export function ThoughtPickerRow({
  thought,
  query,
  active,
  onClick,
}: ThoughtPickerRowProps) {
  const { i18n } = useTranslation();
  const locale = isSupportedLocale(i18n.language) ? i18n.language : 'zh-CN';
  const ranges = query.trim().length > 0
    ? findHighlightRanges(thought.content, query)
    : [];
  const tags = (thought.tags ?? []).slice(0, 3);

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer border-b border-[var(--line-subtle)] px-3 py-2 transition-colors ${
        active
          ? 'bg-[var(--accent)]/10'
          : 'hover:bg-[var(--hover-bg)]'
      }`}
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
        <span>{formatPastRelativeTime(thought.updatedAt, locale)}</span>
        {tags.length > 0 && (
          <div className="flex items-center gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-[var(--radius-sm)] bg-[var(--accent-warm-subtle)] px-1.5 py-px text-xs text-[var(--accent-warm)]"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div
        className="text-sm leading-snug text-[var(--ink-secondary)]"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: '34px',
        }}
      >
        {ranges.length > 0
          ? renderTextWithHighlights(thought.content, ranges)
          : thought.content}
      </div>
    </div>
  );
}
