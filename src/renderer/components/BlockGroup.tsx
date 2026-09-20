
import { MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContentBlock } from '@/types/chat';
import { useNotifyRowLayoutChanged } from '@/context/ChatRowLayoutContext';
import ProcessRow from './ProcessRow';
import MergedInspectionRow from './MergedInspectionRow';
import {
  isMergedInspectionGroup,
  mergeConsecutiveInspections,
  type DisplayItem,
} from '@/utils/contentBlockDisplay';

interface BlockGroupProps {
  blocks: ContentBlock[];
  isLatestActiveSection?: boolean;
  isStreaming?: boolean;
}

/** 1 head + N folded + 1 tail — collapsed view is capped at 3 rows. */
const FOLD_THRESHOLD = 4;
const VISIBLE_HEAD = 1;
const VISIBLE_TAIL = 1;

/**
 * Stable key for a display item.
 *
 * A merged run is keyed on its member ids — not the index — so appending the
 * next read while streaming updates the existing row in place. The row also
 * anchors on the same value, which keeps expand/collapse state across deltas.
 */
function displayItemKey(item: DisplayItem, index: number): string {
  if (Array.isArray(item)) return `block-${item[0]?.tool?.id ?? item[0]?.id ?? index}`;
  // `item.key` is the run's first member id, so appending another read updates
  // this row instead of replacing it. Using the full member list would change
  // the key on every append and remount the row, dropping its expanded state.
  if (isMergedInspectionGroup(item)) return `merged-${item.key}`;
  const block = item;
  return `block-${block.tool?.id ?? block.id ?? index}`;
}

/** Renders one display item, dispatching merged inspection runs to their row. */
function DisplayItemRow({
  item,
  index,
  totalBlocks,
  isStreaming,
  onUserExpand,
}: {
  item: DisplayItem | ContentBlock[];
  index: number;
  totalBlocks: number;
  isStreaming: boolean;
  onUserExpand(): void;
}) {
  if (isMergedInspectionGroup(item)) {
    return <MergedInspectionRow group={item} totalBlocks={totalBlocks} index={index} />;
  }
  const block = (Array.isArray(item) ? item[0] : item) as ContentBlock;
  return (
    <ProcessRow
      block={block}
      index={index}
      totalBlocks={totalBlocks}
      isStreaming={isStreaming}
      onUserExpand={onUserExpand}
    />
  );
}

const BlockGroup = memo(function BlockGroup({
  blocks,
  isLatestActiveSection = false,
  isStreaming = false
}: BlockGroupProps) {
  const { t } = useTranslation('app');
  const [isUnfolded, setIsUnfolded] = useState(false);
  const notifyRowLayoutChanged = useNotifyRowLayoutChanged();

  // When the user expands any row, pin the group open (same effect as clicking
  // 「展开全部」) so the auto-fold never unmounts the row they just opened and
  // silently drops its expanded state. Stable identity keeps ProcessRow's memo.
  const handleChildExpand = useCallback(() => {
    notifyRowLayoutChanged('block-group-expand');
    setIsUnfolded(true);
  }, [notifyRowLayoutChanged]);

  if (blocks.length === 0) return null;

  // Collapse back-to-back read-only inspections into one row before the fold
  // math runs. A turn that inspects six files then reads as "Read ×6" instead
  // of six rows, which is what the fold threshold was papering over. Runs are
  // computed from the incoming blocks only, so streaming appends keep the
  // existing row identity (keyed on the run's first tool id) and never remount.
  const displayItems = mergeConsecutiveInspections(blocks);

  const isStreamingActive = isStreaming && isLatestActiveSection;
  const shouldFold = !isUnfolded && displayItems.length >= FOLD_THRESHOLD;
  const foldedCount = shouldFold ? displayItems.length - VISIBLE_HEAD - VISIBLE_TAIL : 0;

  // Collapsible layout: activates 1 step before FOLD_THRESHOLD so the DOM structure
  // is already stable when folding triggers, enabling smooth CSS Grid transition.
  if (displayItems.length > VISIBLE_HEAD + VISIBLE_TAIL) {
    return (
      <div className="my-3 overflow-hidden rounded-lg border border-[var(--line-subtle)] bg-[var(--paper-inset)]/30 transition-all select-none">
        <div className="flex flex-col">
          {/* Head: first block — always visible */}
          {displayItems.slice(0, VISIBLE_HEAD).map((item, i) => (
            <DisplayItemRow
              key={displayItemKey(item, i)}
              item={item}
              index={i}
              totalBlocks={displayItems.length}
              isStreaming={isStreamingActive}
              onUserExpand={handleChildExpand}
            />
          ))}

          {/* Middle: collapsible zone — Pattern 3 §3.2.3 (Collapse = unmount).
              Folded rows are not rendered at all; previously they mounted
              behind `gridTemplateRows: 0fr` and burned re-render cost on
              every streaming delta. The fold-bar below replaces them when
              `shouldFold` is true; tail rows always stay mounted. */}
          {!shouldFold && (
            <div className="grid grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out">
              <div className="overflow-hidden">
                {displayItems.slice(VISIBLE_HEAD, -VISIBLE_TAIL).map((item, i) => {
                  const index = VISIBLE_HEAD + i;
                  return (
                    <DisplayItemRow
                      key={displayItemKey(item, index)}
                      item={item}
                      index={index}
                      totalBlocks={displayItems.length}
                      isStreaming={isStreamingActive}
                      onUserExpand={handleChildExpand}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Fold bar: inversely animated — appears as middle collapses */}
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: shouldFold ? '1fr' : '0fr' }}
            aria-hidden={!shouldFold}
            inert={!shouldFold}
          >
            <div className="overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  notifyRowLayoutChanged('block-group-expand');
                  setIsUnfolded(true);
                }}
                className="group/fold flex w-full items-center gap-3 border-b border-[var(--line-subtle)] px-4 py-2 text-left transition-colors cursor-pointer hover:bg-[var(--hover-bg)]"
              >
                <div className="size-1.5 shrink-0" />
                <div className="flex size-4 shrink-0 items-center justify-center text-[var(--ink-muted)]">
                  <MoreHorizontal className="size-4" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--ink-muted)] group-hover/fold:text-[var(--ink-secondary)] transition-colors">
                    {t('blockGroup.expandAll')}
                  </span>
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--accent)]">
                    +{foldedCount}
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* Tail: last block — always visible */}
          {displayItems.slice(-VISIBLE_TAIL).map((item, i) => {
            const index = displayItems.length - VISIBLE_TAIL + i;
            return (
              <DisplayItemRow
                key={displayItemKey(item, index)}
                item={item}
                index={index}
                totalBlocks={displayItems.length}
                isStreaming={isStreamingActive}
                onUserExpand={handleChildExpand}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // Flat layout for small block groups (≤2 blocks)
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-[var(--line-subtle)] bg-[var(--paper-inset)]/30 transition-all select-none">
      <div className="flex flex-col">
        {displayItems.map((item, index) => (
          <DisplayItemRow
            key={displayItemKey(item, index)}
            item={item}
            index={index}
            totalBlocks={displayItems.length}
            isStreaming={isStreamingActive}
            onUserExpand={handleChildExpand}
          />
        ))}
      </div>
    </div>
  );
});

export default BlockGroup;
