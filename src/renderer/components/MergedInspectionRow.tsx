import { ChevronDown } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ToolUse from '@/components/ToolUse';
import { getToolBadgeConfig, getToolLabel } from '@/components/tools/toolBadgeConfig';
import { useNotifyRowLayoutChanged } from '@/context/ChatRowLayoutContext';
import type { MergedInspectionGroup } from '@/utils/contentBlockDisplay';

interface MergedInspectionRowProps {
  group: MergedInspectionGroup;
  index: number;
  totalBlocks: number;
}

/**
 * One row standing in for a run of consecutive read-only inspections.
 *
 * Collapsed it reads as a single summary ("Read ×6"), which is the whole point:
 * a turn that walks six files previously produced six near-identical rows. The
 * expanded body renders each original block through the normal ToolUse body, so
 * results, diffs and previews behave exactly as they do standalone.
 *
 * Expanded state is local and not persisted; the row remounts only when the
 * run's membership changes, and membership is keyed on tool ids upstream.
 */
const MergedInspectionRow = memo(function MergedInspectionRow({
  group,
  index,
  totalBlocks,
}: MergedInspectionRowProps) {
  const { t } = useTranslation('app');
  const [expanded, setExpanded] = useState(false);
  const notifyRowLayoutChanged = useNotifyRowLayoutChanged();

  const blocks = group.blocks;
  const head = blocks[0];
  const headName = head?.tool?.name ?? '';
  const { icon } = getToolBadgeConfig(headName);

  // Count per tool name so a mixed run ("Read ×4, Grep ×2") still reads as one
  // line instead of hiding what actually ran.
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const name = block.tool?.name ?? '';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(' · ');

  const anyRunning = blocks.some((b) => b.tool?.isLoading);
  const anyFailed = blocks.some((b) => b.tool?.isFailed || b.tool?.isError);

  const handleToggle = () => {
    const willExpand = !expanded;
    notifyRowLayoutChanged(willExpand ? 'process-row-expand' : 'process-row-collapse');
    setExpanded(willExpand);
  };

  return (
    <div
      className={`group select-none ${index < totalBlocks - 1 ? 'border-b border-[var(--line-subtle)]' : ''}`}
      data-merged-inspection={group.memberIds}
    >
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-label={t('blockGroup.mergedInspectionLabel', { summary, count: blocks.length })}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer hover:bg-[var(--hover-bg)]"
      >
        <div
          className={`flex size-1.5 shrink-0 rounded-full ${
            anyRunning
              ? 'bg-[var(--success)] animate-pulse'
              : anyFailed
                ? 'bg-[var(--error)]'
                : 'bg-[var(--ink-muted)]/40'
          }`}
        />
        <div className="flex size-4 shrink-0 items-center justify-center text-[var(--ink-muted)] [&>svg]:size-4">
          {icon}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-sm leading-snug text-[var(--ink)] font-medium">{summary}</span>
          {blocks.length > 1 && (
            <span className="text-xs text-[var(--ink-muted)]">
              {t('blockGroup.mergedInspectionCount', { count: blocks.length })}
            </span>
          )}
        </div>
        <ChevronDown
          className={`size-4 text-[var(--ink-muted)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Same collapse = unmount policy as ProcessRow: only mount the bodies
          while expanded, so a run of twenty reads costs nothing when folded. */}
      {expanded && (
        <div className="grid grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out">
          <div className="overflow-hidden">
            {blocks.map((block, i) => (
              <div
                key={block.tool?.id ?? `member-${i}`}
                className="border-t border-[var(--line)] bg-[var(--paper-elevated)]/50 px-4 pb-4 pt-3"
                data-merged-inspection-member={i}
              >
                {block.tool && (
                  <div className="mb-1 ml-7 text-xs text-[var(--ink-muted)]">
                    {getToolLabel(block.tool, t)}
                  </div>
                )}
                {block.tool && (
                  <div className="ml-7 w-full overflow-hidden select-text">
                    <ToolUse tool={block.tool} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}, areEqual);

/**
 * Compare by run identity and member count rather than object reference.
 *
 * The parent rebuilds the group object on every render (it is derived from the
 * incoming blocks), so a reference comparison would never bail out and the row
 * would re-render on every streaming frame.
 */
function areEqual(prev: MergedInspectionRowProps, next: MergedInspectionRowProps): boolean {
  // `totalBlocks` shifts as the group grows and drives the trailing border
  // class, so compare only whether that class can differ.
  const prevLast = prev.index >= prev.totalBlocks - 1;
  const nextLast = next.index >= next.totalBlocks - 1;
  return prev.group.key === next.group.key
    && prev.index === next.index
    && prevLast === nextLast
    && prev.group.blocks.length === next.group.blocks.length
    && prev.group.blocks.every((block, i) => {
      const other = next.group.blocks[i]?.tool;
      return block.tool?.id === other?.id
        && block.tool?.isLoading === other?.isLoading
        && block.tool?.isFailed === other?.isFailed
        && block.tool?.isError === other?.isError;
    });
}

export default MergedInspectionRow;
