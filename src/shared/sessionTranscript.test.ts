import { describe, expect, it } from 'vitest';
import {
  applyTranscriptOperation,
  createTranscriptProjection,
  fromStoredTranscriptMessage,
  transcriptMessages,
  type TranscriptOperation,
} from './sessionTranscript';

describe('product transcript content operations', () => {
  it('keeps an unfinished assistant before later users, including late tools', () => {
    const operations: TranscriptOperation[] = [
      { kind: 'message-create', message: { id: 'u1', role: 'user', timestamp: 't1', content: 'first' } },
      { kind: 'message-create', message: { id: 'a1', role: 'assistant', timestamp: 't2', content: [] } },
      { kind: 'block-upsert', messageId: 'a1', block: { id: 'text-1', type: 'text', text: '' } },
      { kind: 'text-append', messageId: 'a1', blockId: 'text-1', field: 'text', offset: 0, text: '还没结束🙂' },
      { kind: 'block-upsert', messageId: 'a1', block: { id: 'tool-1', type: 'tool_use', tool: { id: 'call-1', name: 'Bash', result: '' } } },
      { kind: 'message-create', message: { id: 'u2', role: 'user', timestamp: 't3', content: 'steer' } },
      { kind: 'message-create', message: { id: 'a2', role: 'assistant', timestamp: 't4', content: 'later output' } },
      { kind: 'text-append', messageId: 'a1', blockId: 'tool-1', field: 'result', offset: 0, text: 'late result' },
    ];
    const live = createTranscriptProjection();
    for (const operation of operations) applyTranscriptOperation(live, operation);
    const cold = createTranscriptProjection();
    for (const operation of JSON.parse(JSON.stringify(operations)) as TranscriptOperation[]) applyTranscriptOperation(cold, operation);
    expect(transcriptMessages(cold)).toEqual(transcriptMessages(live));
    expect([...cold.messages.keys()]).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(cold.messages.get('a1')?.content).toMatchObject([
      { text: '还没结束🙂' }, { tool: { result: 'late result' } },
    ]);
  });

  it('confirms blocks without duplicating sibling blocks or accumulated text', () => {
    const state = createTranscriptProjection();
    applyTranscriptOperation(state, { kind: 'message-create', message: { id: 'a', role: 'assistant', timestamp: 't', content: [] } });
    for (const block of [{ id: 'b1', type: 'text', text: 'one' }, { id: 'b2', type: 'text', text: 'two' }]) {
      applyTranscriptOperation(state, { kind: 'block-upsert', messageId: 'a', block });
    }
    applyTranscriptOperation(state, { kind: 'block-upsert', messageId: 'a', block: { id: 'b1', type: 'text', text: 'one', isComplete: true } });
    expect(state.messages.get('a')?.content).toEqual([
      { id: 'b1', type: 'text', text: 'one', isComplete: true }, { id: 'b2', type: 'text', text: 'two' },
    ]);
    expect(() => applyTranscriptOperation(state, { kind: 'text-append', messageId: 'a', blockId: 'b1', field: 'text', offset: 0, text: 'one' })).toThrow('Non-contiguous');
  });

  it('does not retain mutable producer payloads and keeps legacy literal text', () => {
    const source = { id: 'u', role: 'user' as const, content: '[literal text', timestamp: 't' };
    const state = createTranscriptProjection();
    applyTranscriptOperation(state, { kind: 'message-create', message: fromStoredTranscriptMessage(source) });
    source.content = 'changed';
    expect(transcriptMessages(state)[0].content).toBe('[literal text');
    applyTranscriptOperation(state, { kind: 'messages-remove', messageIds: ['u'] });
    applyTranscriptOperation(state, { kind: 'messages-remove', messageIds: ['u'] });
    expect(transcriptMessages(state)).toEqual([]);
  });
});
