import { describe, expect, it } from 'vitest';

import type { AnthropicContentBlock, AnthropicMessage } from '../types/anthropic';
import { translateMessages } from './messages';

const thinking = (value: string): AnthropicContentBlock => ({ type: 'thinking', thinking: value, signature: '' });
const text = (value: string): AnthropicContentBlock => ({ type: 'text', text: value });
const toolUse = (id: string): AnthropicContentBlock => ({ type: 'tool_use', id, name: 'Read', input: { file_path: '/tmp/x' } });

const assistant = (...content: AnthropicContentBlock[]): AnthropicMessage => ({ role: 'assistant', content });
const toolResults = (id: string): AnthropicMessage => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }],
});

/** The `reasoning_content` each replayed assistant turn would carry upstream. */
function replayedReasoning(messages: ReturnType<typeof translateMessages>): Array<string | undefined> {
  return messages
    .filter(message => message.role === 'assistant')
    .map(message => (message as { reasoning_content?: string }).reasoning_content);
}

/**
 * DeepSeek documents that a prior turn's `reasoning_content` from a turn without
 * tool calls does not need to be carried in the context and is ignored if sent.
 * Re-sending it therefore buys nothing while still paying for every prior turn's
 * full reasoning on every request, growing without bound as a Session lengthens.
 */
describe('assistant reasoning replay', () => {
  it('does not replay historical thinking on a plain assistant turn', () => {
    const messages = translateMessages(
      'system',
      [assistant(thinking('a long chain of thought'), text('the answer'))],
      true,
    );

    expect(replayedReasoning(messages)).toEqual([undefined]);
  });

  it('still replays thinking when the turn carries tool calls', () => {
    // The next request must correlate the tool call with the reasoning that
    // produced it, and some providers reject a tool_calls message without it.
    const messages = translateMessages(
      'system',
      [assistant(thinking('why I need the file'), toolUse('toolu_1')), toolResults('toolu_1')],
      true,
    );

    expect(replayedReasoning(messages)).toEqual(['why I need the file']);
  });

  it('does not add reasoning_content when thinking is disabled', () => {
    const messages = translateMessages('system', [assistant(text('answer'))], false);

    expect(replayedReasoning(messages)).toEqual([undefined]);
  });

  it('keeps the visible answer regardless of the thinking channel', () => {
    const messages = translateMessages(
      'system',
      [assistant(thinking('hidden'), text('visible answer'))],
      true,
    );

    const reply = messages.find(message => message.role === 'assistant');
    expect(reply?.content).toBe('visible answer');
  });
});
