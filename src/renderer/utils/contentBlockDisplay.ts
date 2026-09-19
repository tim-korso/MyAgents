import type { ContentBlock } from '@/types/chat';

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
