import type { ContentBlock } from '@/types/chat';

/**
 * Tool names that collapse into a single row when they run back to back.
 *
 * A turn that inspects six files reads as six identical rows otherwise, which
 * is the bulk of the visual noise in a long turn. Only read-only inspection
 * collapses: writes, edits and shell commands each stay their own row because
 * their targets and results differ in ways the user needs to scan
 * individually. Mirrors tether's `collapseConsecutiveTraceRows`, which groups
 * consecutive `read`/`search` rows and leaves everything else alone.
 */
const INSPECTION_TOOL_NAMES = new Set([
  'Read',
  'NotebookRead',
  'Grep',
  'Glob',
  'LS',
  'WebFetch',
  'WebSearch',
]);

export function isInspectionTool(block: ContentBlock): boolean {
  if (!isToolContentBlock(block)) return false;
  const name = block.tool?.name;
  return typeof name === 'string' && INSPECTION_TOOL_NAMES.has(name);
}

/**
 * A run of consecutive inspection blocks, rendered as one row.
 *
 * `blocks` holds the original blocks in order so the row can still expand to
 * the individual results. `memberIds` is the identity of the run, used as a
 * React key and for row-layout invalidation.
 */
export interface MergedInspectionGroup {
  kind: 'merged-inspection';
  blocks: ContentBlock[];
  memberIds: string;
}

export type DisplayItem = ContentBlock | MergedInspectionGroup;

/**
 * Collapse consecutive read-only inspection blocks into one item.
 *
 * A run of length 1 is left as the plain block, so a single Read renders with
 * its own label and icon rather than a pointless group wrapper. Runs are keyed
 * on the first block's tool id, which is stable across streaming deltas —
 * later blocks in the run can still be arriving while the row is on screen.
 */
export function mergeConsecutiveInspections(blocks: ContentBlock[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  let run: ContentBlock[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      result.push(run[0]!);
    } else {
      result.push({
        kind: 'merged-inspection',
        blocks: run,
        memberIds: run.map((b) => b.tool?.id ?? b.id ?? '').join('|'),
      });
    }
    run = [];
  };

  for (const block of blocks) {
    if (isInspectionTool(block)) {
      run.push(block);
      continue;
    }
    flush();
    result.push(block);
  }
  flush();

  return result;
}

export function isToolContentBlock(block: ContentBlock): boolean {
  return block.type === 'tool_use' || block.type === 'server_tool_use';
}

export function isProcessContentBlock(block: ContentBlock): boolean {
  return block.type === 'thinking' || isToolContentBlock(block);
}

/**
 * Main conversation display order for assistant ContentBlock[]:
 * text stays in place, adjacent text is merged defensively, and consecutive
 * thinking/tool blocks form a process group. Floating-ball uses the same
 * projection, with a compact one-line renderer for each process block.
 */
export function groupContentBlocksForDisplay(content: ContentBlock[]): (ContentBlock | ContentBlock[])[] {
  const groupedBlocks: (ContentBlock | ContentBlock[])[] = [];
  let currentGroup: ContentBlock[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      if (currentGroup.length > 0) {
        groupedBlocks.push([...currentGroup]);
        currentGroup = [];
      }
      const prev = groupedBlocks[groupedBlocks.length - 1];
      if (prev && !Array.isArray(prev) && prev.type === 'text' && !prev.isComplete && !block.isComplete && !prev.asyncQuestions && !block.asyncQuestions) {
        groupedBlocks[groupedBlocks.length - 1] = {
          ...prev,
          text: (prev.text || '') + '\n\n' + (block.text || ''),
        };
      } else {
        groupedBlocks.push(block);
      }
    } else if (isProcessContentBlock(block)) {
      currentGroup.push(block);
    }
  }

  if (currentGroup.length > 0) {
    groupedBlocks.push(currentGroup);
  }

  return groupedBlocks;
}
