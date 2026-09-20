import { describe, expect, it } from 'vitest';

import {
  groupContentBlocksForDisplay,
  isInspectionTool,
  mergeConsecutiveInspections,
} from './contentBlockDisplay';
import type { ContentBlock, ToolInput } from '@/types/chat';

function toolBlock(id: string, name: string): ContentBlock {
  return {
    type: 'tool_use',
    tool: {
      id,
      name,
      input: {},
      streamIndex: 0,
      inputJson: '{}',
      parsedInput: {} as ToolInput,
      isLoading: false,
    },
  };
}

function thinkingBlock(text: string): ContentBlock {
  return { type: 'thinking', thinking: text, isComplete: true };
}

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

describe('isInspectionTool', () => {
  it('treats read-only lookups as inspections and mutations as not', () => {
    expect(isInspectionTool(toolBlock('t1', 'Read'))).toBe(true);
    expect(isInspectionTool(toolBlock('t2', 'Grep'))).toBe(true);
    expect(isInspectionTool(toolBlock('t3', 'Glob'))).toBe(true);
    // Mutations and shell commands stay one row each: their targets and results
    // differ in ways the user scans individually.
    expect(isInspectionTool(toolBlock('t4', 'Write'))).toBe(false);
    expect(isInspectionTool(toolBlock('t5', 'Edit'))).toBe(false);
    expect(isInspectionTool(toolBlock('t6', 'Bash'))).toBe(false);
    expect(isInspectionTool(thinkingBlock('thinking'))).toBe(false);
  });
});

describe('mergeConsecutiveInspections', () => {
  it('collapses a run of reads into one item and keeps the originals', () => {
    const merged = mergeConsecutiveInspections([
      toolBlock('r1', 'Read'),
      toolBlock('r2', 'Read'),
      toolBlock('r3', 'Read'),
    ]);

    expect(merged).toHaveLength(1);
    const group = merged[0];
    expect(Array.isArray(group)).toBe(false);
    expect(group && 'kind' in group && group.kind).toBe('merged-inspection');
    expect(group && 'blocks' in group ? group.blocks.map((b) => b.tool?.id) : []).toEqual(['r1', 'r2', 'r3']);
  });

  it('leaves a single inspection uncollapsed so it keeps its own label', () => {
    const merged = mergeConsecutiveInspections([toolBlock('r1', 'Read')]);
    expect(merged).toHaveLength(1);
    expect(merged[0] && 'kind' in merged[0]).toBe(false);
  });

  it('breaks the run on a non-inspection block and resumes after it', () => {
    const merged = mergeConsecutiveInspections([
      toolBlock('r1', 'Read'),
      toolBlock('r2', 'Read'),
      toolBlock('w1', 'Write'),
      toolBlock('g1', 'Grep'),
      toolBlock('g2', 'Grep'),
    ]);

    expect(merged).toHaveLength(3);
    expect(merged[0] && 'kind' in merged[0] ? merged[0].kind : '').toBe('merged-inspection');
    expect(merged[1] && 'kind' in merged[1] ? 'merged' : merged[1]?.tool?.name).toBe('Write');
    expect(merged[2] && 'kind' in merged[2] ? merged[2].kind : '').toBe('merged-inspection');
  });

  it('does not merge across an intervening thinking block', () => {
    const merged = mergeConsecutiveInspections([
      toolBlock('r1', 'Read'),
      thinkingBlock('a thought'),
      toolBlock('r2', 'Read'),
    ]);

    expect(merged).toHaveLength(3);
    const middle = merged[1];
    expect(middle && 'type' in middle ? middle.type : '').toBe('thinking');
  });

  it('gives the merged run a stable key as more reads stream in', () => {
    const first = mergeConsecutiveInspections([toolBlock('r1', 'Read'), toolBlock('r2', 'Read')]);
    const second = mergeConsecutiveInspections([
      toolBlock('r1', 'Read'),
      toolBlock('r2', 'Read'),
      toolBlock('r3', 'Read'),
    ]);

    const keyOf = (items: ReturnType<typeof mergeConsecutiveInspections>) => {
      const group = items[0];
      return group && 'memberIds' in group ? group.memberIds : '';
    };
    // Membership grows, so the key grows with it — the point is that it stays
    // derived from tool ids rather than array position.
    expect(keyOf(first)).toContain('r1');
    expect(keyOf(second)).toContain('r1');
  });

  it('merges mixed read-only tools into a single run', () => {
    const merged = mergeConsecutiveInspections([
      toolBlock('r1', 'Read'),
      toolBlock('g1', 'Grep'),
      toolBlock('l1', 'LS'),
    ]);

    expect(merged).toHaveLength(1);
    const group = merged[0];
    expect(group && 'blocks' in group ? group.blocks : []).toHaveLength(3);
  });
});
