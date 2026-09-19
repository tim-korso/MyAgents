import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTranscriptBatch, createTranscriptProjection, transcriptMessages } from '../../shared/sessionTranscript';
import { ProductTranscriptContent } from './content';
import { TranscriptWriter } from './writer';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const durable = createTranscriptProjection();
  const append = vi.fn(async (_expected, batch) => { applyTranscriptBatch(durable, batch.operations); });
  const writer = new TranscriptWriter({
    sessionId: 's1', generation: 'g1', revision: 0, projection: createTranscriptProjection(),
    storage: { append, replace: vi.fn() },
  });
  const content = new ProductTranscriptContent(writer);
  const user = (id: string) => content.admitUser({ id, role: 'user', content: id, timestamp: '2026-09-12T00:00:00Z' });
  return { writer, content, user, durable, append };
}

describe('adapter product content identities', () => {
  it('retains interleaved segments and updates a preceding tool after a steer and terminal', async () => {
    const { writer, content, user, durable } = setup();
    const started: string[] = [];
    writer.subscribeOperations(operation => {
      if (operation.kind === 'message-create' && operation.message.role === 'assistant') started.push(operation.message.id);
    });
    user('u1');
    const text1 = content.block('text', 'text', { text: '' });
    content.append(text1, 'text', 'before steer');
    const tool = content.startTool('tool-1', 'Read')!;
    user('u2');
    const text2 = content.block('text', 'text', { text: '' });
    content.append(text2, 'text', 'after steer');
    content.finishTurn('complete', { usage: { inputTokens: 10, outputTokens: 20 } });
    content.confirmText(tool, 'result', 'late result');
    content.updateTool(tool, { isLoading: false }, true);
    await vi.advanceTimersByTimeAsync(100);
    expect([...durable.messages.keys()]).toEqual(['u1', started[0], 'u2', started[1]]);
    expect(content.readTool(tool)?.result).toBe('late result');
    expect(durable.turns.size).toBe(1);
    expect(transcriptMessages(durable)).toEqual(transcriptMessages(writer.projection));
    await writer.close();
  });

  it('confirms the same block without duplicating partial text and preserves nested input/results', async () => {
    const { writer, content, user, durable } = setup();
    user('u1');
    const text = content.block('native-1:block-0', 'text', { text: '' });
    content.append(text, 'text', 'hel');
    content.confirmText(text, 'text', 'hello');
    content.confirmText(text, 'text', 'hello');
    content.confirmText(text, 'text', 'corrected');
    const parent = content.startTool('parent', 'Agent')!;
    const child = content.startTool('child', 'Read', {}, 'parent')!;
    content.append(child, 'inputJson', '{"path":');
    content.confirmInput(child, { path: '/file' });
    content.confirmText(child, 'result', 'result');
    content.updateTool(child, { isLoading: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(content.readBlock(text)?.text).toBe('corrected');
    expect(content.readTool(parent)?.subagentCalls).toHaveLength(1);
    const stored = JSON.parse(transcriptMessages(durable)[1].content);
    expect(stored[1].tool.subagentCalls[0]).toMatchObject({ input: { path: '/file' }, result: 'result', isLoading: false });
    await writer.close();
  });

  it('continues accepting content while product IO is unresolved', async () => {
    const { writer, content, user, append } = setup();
    let release!: () => void;
    append.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    user('u1');
    const block = content.block('text', 'text', { text: '' });
    content.append(block, 'text', 'first');
    await vi.advanceTimersByTimeAsync(100);
    user('u2');
    content.append(content.block('text', 'text', { text: '' }), 'text', 'continues');
    content.finishTurn('complete');
    expect(writer.projection.messages.size).toBe(4);
    expect(content.currentTurn?.status).toBe('complete');
    expect(append).toHaveBeenCalledTimes(1);
    release();
    await writer.close();
  });
});
