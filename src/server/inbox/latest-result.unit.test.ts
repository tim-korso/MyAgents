import { describe, expect, it } from 'vitest';

import { getLatestAssistantResultFromMessages, NO_TEXT_RESPONSE } from './latest-result';

describe('latest assistant result extraction', () => {
  it('returns the newest assistant text', () => {
    expect(
      getLatestAssistantResultFromMessages([
        { id: 'u1', role: 'user', content: 'hi', timestamp: 't1' },
        { id: 'a1', role: 'assistant', content: 'old', timestamp: 't2' },
        { id: 'u2', role: 'user', content: 'again', timestamp: 't3' },
        { id: 'a2', role: 'assistant', content: 'new', timestamp: 't4' },
      ]),
    ).toBe('new');
  });

  it('extracts text blocks from persisted content block JSON', () => {
    expect(
      getLatestAssistantResultFromMessages([
        {
          id: 'a1',
          role: 'assistant',
          content: JSON.stringify([
            { type: 'thinking', text: 'hidden' },
            { type: 'text', text: 'hello ' },
            { type: 'text', text: 'world' },
          ]),
          timestamp: 't1',
        },
      ]),
    ).toBe('hello world');
  });

  it('returns a structured no-text marker when no assistant text exists', () => {
    expect(
      getLatestAssistantResultFromMessages([
        { id: 'u1', role: 'user', content: 'hi', timestamp: 't1' },
      ]),
    ).toBe(NO_TEXT_RESPONSE);
  });
});
