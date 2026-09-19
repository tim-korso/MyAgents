import { describe, expect, it } from 'vitest';

import {
  buildHeightEstimateSeed,
  estimateMessageRowHeight,
  type RowLayoutContract,
} from './chatRowLayout';
import type { Message } from '@/types/chat';

function message(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    timestamp: new Date('2026-07-02T00:00:00Z'),
    ...partial,
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
