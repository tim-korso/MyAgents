import { describe, expect, it, vi } from 'vitest';

import type { UnifiedEvent } from './types';
import { ClaudeCodeRuntime } from './claude-code';

describe('Claude Code NDJSON log ownership', () => {
  it('preserves local retraction and child supersedes before replacement content', () => {
    const runtime = new ClaudeCodeRuntime() as unknown as { parseLine(line: string): UnifiedEvent | UnifiedEvent[] | null };
    const parse = (frame: unknown) => runtime.parseLine(JSON.stringify(frame));
    expect(parse({ type: 'system', subtype: 'model_refusal_fallback', scope: 'local', retracted_message_uuids: ['refused'] }))
      .toEqual({ kind: 'native_retraction', scope: 'local', messageIds: ['refused'] });
    const replacement = parse({ type: 'assistant', uuid: 'replacement', parent_tool_use_id: 'parent', supersedes: ['refused'],
      message: { id: 'model', content: [{ type: 'text', text: 'answer' }] },
    });
    expect(replacement).toMatchObject([
      { kind: 'native_retraction', messageIds: ['refused'], scope: 'local', parentToolUseId: 'parent' },
      { kind: 'message_replay', message: { id: 'replacement' }, nativeSource: { parentToolUseId: 'parent' } },
    ]);
  });

  it('retains model-message/block provenance and isolates child stream indexes', () => {
    const runtime = new ClaudeCodeRuntime() as unknown as { parseLine(line: string): UnifiedEvent | null };
    const parse = (frame: unknown) => runtime.parseLine(JSON.stringify(frame));
    const stream = (event: unknown, parent_tool_use_id?: string) => parse({ type: 'stream_event', parent_tool_use_id, event });
    stream({ type: 'message_start', message: { id: 'main-message' } });
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'main-tool', name: 'Read' } });
    stream({ type: 'message_start', message: { id: 'child-message' } }, 'parent');
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'child-tool', name: 'Read' } }, 'parent');
    expect(stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } })).toMatchObject({ kind: 'tool_input_delta', toolUseId: 'main-tool', nativeSource: { messageId: 'main-message', blockIndex: 0 } });
    expect(stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }, 'parent')).toMatchObject({ kind: 'tool_input_delta', toolUseId: 'child-tool', nativeSource: { messageId: 'child-message', parentToolUseId: 'parent', blockIndex: 0 } });
    expect(parse({ type: 'assistant', uuid: 'delivery', parent_tool_use_id: 'parent', message: { id: 'child-message', content: [{ type: 'text', text: 'full' }] } })).toMatchObject({ kind: 'message_replay', message: { id: 'delivery' }, nativeSource: { messageId: 'child-message', parentToolUseId: 'parent' } });
  });

  it('delivers all delta kinds without first-N or every-N payload logging', async () => {
    const frames = [
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'thinking' },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'thinking_delta', thinking: 'secret-thinking-delta' },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'tool_use', id: 'tool-1', name: 'Read' },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: 'secret-tool-delta' },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'secret-text-delta' },
        },
      }),
      ...Array.from({ length: 44 }, (_, index) => JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `filler-${index}` },
        },
      })),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'secret-every-50-delta' },
        },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'composed final answer' }),
    ];
    expect(frames).toHaveLength(51);
    const rawLines = frames.join('\n') + '\n';
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(rawLines));
        controller.close();
      },
    });
    const events: UnifiedEvent[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const runtime = new ClaudeCodeRuntime();

    try {
      await (runtime as unknown as {
        readEvents: (
          stream: ReadableStream<Uint8Array>,
          onEvent: (event: UnifiedEvent) => void,
          handle: { exited: boolean },
        ) => Promise<void>;
      }).readEvents(stdout, event => events.push(event), { exited: false });

      expect(events).toContainEqual({ kind: 'thinking_delta', text: 'secret-thinking-delta', index: 1 });
      expect(events).toContainEqual({ kind: 'tool_input_delta', toolUseId: 'tool-1', delta: 'secret-tool-delta' });
      expect(events).toContainEqual({ kind: 'text_delta', text: 'secret-text-delta' });
      expect(events).toContainEqual({ kind: 'text_delta', text: 'secret-every-50-delta' });
      const messages = log.mock.calls.map(args => args.join(' '));
      expect(messages.some(message => message.includes('secret-thinking-delta'))).toBe(false);
      expect(messages.some(message => message.includes('secret-tool-delta'))).toBe(false);
      expect(messages.some(message => message.includes('secret-text-delta'))).toBe(false);
      expect(messages.some(message => message.includes('secret-every-50-delta'))).toBe(false);
      expect(messages.some(message => message.includes('composed final answer'))).toBe(false);
      expect(messages.some(message => message.includes('session_complete subtype=success result=21chars'))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});
