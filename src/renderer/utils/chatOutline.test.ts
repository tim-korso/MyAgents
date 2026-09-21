import { describe, expect, it } from 'vitest';

import { activeOutlineIndex, buildChatOutline, messageOutlineText } from './chatOutline';
import type { Message } from '@/types/chat';

function message(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return { timestamp: new Date('2026-09-21T10:00:00Z'), ...partial };
}

const userText = (id: string, text: string) =>
  message({ id, role: 'user', content: text });

describe('messageOutlineText', () => {
  it('reads string content', () => {
    expect(messageOutlineText(userText('m1', 'hello'))).toBe('hello');
  });

  it('reads text blocks and ignores thinking and tool blocks', () => {
    expect(messageOutlineText(message({
      id: 'm2',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'internal reasoning that must not leak into the preview' },
        { type: 'text', text: 'the actual answer' },
        { type: 'tool_use', tool: { id: 't1', name: 'Bash', input: {}, streamIndex: 0, inputJson: '{}' } },
      ],
    }))).toBe('the actual answer');
  });
});

// The outline exists so a long session is navigable by meaning. Listing turns
// that cannot be identified (empty, thinking-only) would add scroll noise.
describe('buildChatOutline', () => {
  it('lists one entry per user turn, numbered from 1', () => {
    const outline = buildChatOutline([
      userText('u1', 'first question'),
      message({ id: 'a1', role: 'assistant', content: 'answer one' }),
      userText('u2', 'second question'),
    ]);

    expect(outline.map((e) => e.id)).toEqual(['u1', 'u2']);
    expect(outline.map((e) => e.turnIndex)).toEqual([1, 2]);
  });

  it('never lists assistant messages as separate entries', () => {
    const outline = buildChatOutline([
      userText('u1', 'q'),
      message({ id: 'a1', role: 'assistant', content: 'a' }),
      message({ id: 'a2', role: 'assistant', content: 'another' }),
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0]?.id).toBe('u1');
  });

  it('skips turns with nothing to identify them', () => {
    const outline = buildChatOutline([
      userText('u1', '   '),
      message({
        id: 'u2',
        role: 'user',
        content: [{ type: 'thinking', thinking: 'only thinking, no question text' }],
      }),
      userText('u3', 'real question'),
    ]);

    // Turn numbering counts only the entries that made it in, so "turn 1" is
    // always the first navigable turn rather than pointing at a blank row.
    expect(outline.map((e) => e.id)).toEqual(['u3']);
    expect(outline[0]?.turnIndex).toBe(1);
  });

  it('flattens whitespace so every entry is a single scannable line', () => {
    const outline = buildChatOutline([userText('u1', 'line one\n\n   line two\ttabbed')]);
    expect(outline[0]?.preview).toBe('line one line two tabbed');
  });

  it('clips long turns instead of wrapping', () => {
    const outline = buildChatOutline([userText('u1', 'x'.repeat(300))]);
    const preview = outline[0]?.preview ?? '';
    expect(preview.length).toBeLessThanOrEqual(80);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('carries the timestamp when the message has one', () => {
    expect(buildChatOutline([userText('u1', 'q')])[0]?.timestamp)
      .toBe(new Date('2026-09-21T10:00:00Z').getTime());
  });

  it('returns nothing for an empty or assistant-only history', () => {
    expect(buildChatOutline([])).toEqual([]);
    expect(buildChatOutline([message({ id: 'a1', role: 'assistant', content: 'a' })])).toEqual([]);
  });
});

describe('activeOutlineIndex', () => {
  it('picks the last entry that passed the reading line', () => {
    // tops: entry 0 scrolled off, entry 1 at the line, entry 2 still below.
    expect(activeOutlineIndex([-500, 100, 900], 160)).toBe(1);
  });

  it('returns -1 before any entry reaches the line', () => {
    expect(activeOutlineIndex([900, 1200], 160)).toBe(-1);
  });

  it('tolerates a missing measurement without skipping the entry', () => {
    // A virtualized row not yet measured reports undefined; treating that as
    // "passed" would jump the highlight to the next turn prematurely.
    expect(activeOutlineIndex([-10, Number.NaN, 900], 160)).toBe(0);
  });
});
