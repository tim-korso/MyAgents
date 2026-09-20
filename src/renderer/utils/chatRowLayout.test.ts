import { describe, expect, it } from 'vitest';

import {
  buildHeightEstimateSeed,
  estimateMessageRowHeight,
  type RowLayoutContract,
} from './chatRowLayout';
import type { ContentBlock, Message } from '@/types/chat';

function message(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    timestamp: new Date('2026-07-02T00:00:00Z'),
    ...partial,
  };
}

function readTool(id: string): ContentBlock {
  return {
    type: 'tool_use',
    tool: {
      id,
      name: 'Read',
      input: {},
      streamIndex: 0,
      inputJson: '{}',
      result: 'some file contents',
      isLoading: false,
    },
  };
}

describe('chatRowLayout', () => {
  it('keeps short user messages near the short-row range', () => {
    const estimate = estimateMessageRowHeight(
      message({ id: 'u1', role: 'user', content: 'short question' }),
      900,
    );

    expect(estimate.estimatedHeight).toBeGreaterThanOrEqual(96);
    expect(estimate.estimatedHeight).toBeLessThan(260);
    expect(estimate.likelyUserCollapsed).toBe(false);
  });

  it('predicts obvious long user messages as initially collapsed', () => {
    const longText = Array.from({ length: 90 }, (_, i) => `line ${i + 1}`).join('\n');
    const estimate = estimateMessageRowHeight(
      message({ id: 'u2', role: 'user', content: longText }),
      800,
    );

    expect(estimate.likelyUserCollapsed).toBe(true);
    expect(estimate.growthClass).toBe('can-grow');
    expect(estimate.estimatedHeight).toBeLessThan(650);
  });

  it('estimates long fenced code well above the default item height', () => {
    const sql = [
      '```sql',
      ...Array.from({ length: 70 }, (_, i) => `select ${i} as value;`),
      '```',
    ].join('\n');
    const estimate = estimateMessageRowHeight(
      message({ id: 'a1', role: 'assistant', content: sql }),
      900,
    );

    expect(estimate.containsLongCodeBlock).toBe(true);
    expect(estimate.estimatedHeight).toBeGreaterThan(1000);
  });

  it('accounts for assistant content blocks and growing tool state', () => {
    const estimate = estimateMessageRowHeight(
      message({
        id: 'a2',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the plan' },
          { type: 'thinking', thinking: 'still thinking', isComplete: false },
          {
            type: 'tool_use',
            tool: {
              id: 'tool-1',
              name: 'Task',
              input: {},
              streamIndex: 0,
              isLoading: true,
            },
          },
        ],
      }),
      900,
    );

    expect(estimate.growthClass).toBe('can-grow');
    expect(estimate.estimatedHeight).toBeGreaterThan(160);
  });

  it('builds a seed with the same length as data', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: 'one' }),
      message({ id: 'a1', role: 'assistant', content: 'two' }),
    ];
    const layout = new Map<string, RowLayoutContract>(
      messages.map(msg => [msg.id, estimateMessageRowHeight(msg, 800)]),
    );

    expect(buildHeightEstimateSeed(messages, layout)).toHaveLength(messages.length);
  });
});

// The height estimate has to match what actually renders, or the scroll model
// anchors against a fiction: an inflated estimate makes the list believe there
// is more content below than there is, which shows up as jitter while the turn
// streams. Merged inspection runs render as one row, so they must measure as
// one row too.
describe('chatRowLayout merged inspections', () => {
  it('measures a run of reads as one row, not one per file', () => {
    const single = estimateMessageRowHeight(
      message({ id: 'a1', role: 'assistant', content: [readTool('r1')] }),
      900,
    );
    const sixReads = estimateMessageRowHeight(
      message({
        id: 'a2',
        role: 'assistant',
        content: Array.from({ length: 6 }, (_, i) => readTool(`r${i}`)),
      }),
      900,
    );

    // Six reads collapse to a single row, so the estimate must stay close to a
    // lone read rather than growing by ~44px per extra file (5 × 44 = 220px).
    expect(sixReads.estimatedHeight).toBeLessThan(single.estimatedHeight + 60);
  });

  it('still measures unmerged writes individually', () => {
    const write = (id: string): ContentBlock => ({
      type: 'tool_use',
      tool: { id, name: 'Write', input: {}, streamIndex: 0, inputJson: '{}', result: 'written' },
    });
    const one = estimateMessageRowHeight(
      message({ id: 'w1', role: 'assistant', content: [write('w0')] }),
      900,
    );
    const four = estimateMessageRowHeight(
      message({
        id: 'w2',
        role: 'assistant',
        content: Array.from({ length: 4 }, (_, i) => write(`w${i}`)),
      }),
      900,
    );

    // Writes stay separate rows, so the estimate keeps growing with them.
    expect(four.estimatedHeight).toBeGreaterThan(one.estimatedHeight + 100);
  });

  it('marks a merged run with an unfinished member as able to grow', () => {
    const running = readTool('r1');
    running.tool!.isLoading = true;
    running.tool!.result = undefined;
    const estimate = estimateMessageRowHeight(
      message({ id: 'a3', role: 'assistant', content: [readTool('r0'), running] }),
      900,
    );

    expect(estimate.growthClass).toBe('can-grow');
  });
});
