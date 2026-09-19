import { describe, expect, it } from 'vitest';

import { groupContentBlocksForDisplay } from './contentBlockDisplay';
import type { ContentBlock, ToolInput } from '@/types/chat';

describe('groupContentBlocksForDisplay', () => {
  it('preserves text/process/text order and groups only adjacent process blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: '先说一句' },
      { type: 'thinking', thinking: '思路', isComplete: true, thinkingDurationMs: 6000 },
      {
        type: 'tool_use',
        tool: {
          id: 'tool-1',
          name: 'Bash',
          input: {},
          streamIndex: 1,
          inputJson: '{"description":"检查日志"}',
          parsedInput: { description: '检查日志' } as ToolInput,
          isLoading: false,
        },
      },
      { type: 'text', text: '再给结论' },
    ];

    const grouped = groupContentBlocksForDisplay(blocks);
    expect(grouped).toHaveLength(3);
    expect(Array.isArray(grouped[0]) ? 'group' : grouped[0].type).toBe('text');
    expect(Array.isArray(grouped[1]) ? grouped[1].map((b) => b.type) : []).toEqual(['thinking', 'tool_use']);
    expect(Array.isArray(grouped[2]) ? 'group' : grouped[2].type).toBe('text');
  });

  it('merges adjacent text blocks without crossing a process group', () => {
    const grouped = groupContentBlocksForDisplay([
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'C' },
    ]);

    expect(grouped).toHaveLength(3);
    expect(Array.isArray(grouped[0]) ? null : grouped[0].text).toBe('A\n\nB');
    expect(Array.isArray(grouped[2]) ? null : grouped[2].text).toBe('C');
  });
});
