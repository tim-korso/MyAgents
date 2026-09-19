import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTranscriptBatch, createTranscriptProjection, transcriptMessages } from '../../shared/sessionTranscript';
import { ProductTranscriptContent } from './content';
import { TranscriptPresentation } from './presentation';
import { TranscriptWriter } from './writer';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const durable = createTranscriptProjection();
  const writer = new TranscriptWriter({ sessionId: 'session', generation: 'generation', revision: 0,
    projection: createTranscriptProjection(), storage: {
      append: async (_cursor, batch) => { applyTranscriptBatch(durable, batch.operations); },
      replace: vi.fn(),
    },
  });
  const content = new ProductTranscriptContent(writer);
  const presentation = new TranscriptPresentation(content);
  content.admitUser({ id: 'user', role: 'user', content: 'question', timestamp: new Date().toISOString() });
  const blocks = () => writer.projection.messages.get(content.currentAssistantId!)!.content;
  return { writer, content, presentation, durable, blocks };
}

describe('native blocks and product presentation', () => {
  it('continues streaming through the same presentation after canonical truncation', async () => {
    const { writer, content, presentation } = setup();
    presentation.beginNativeMessage('before');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'removed');
    const oldTool = content.startTool('removed-tool', 'Read')!;
    content.updateAttachment(oldTool, 'pending', { path: 'old' });
    writer.replaceProjection(createTranscriptProjection());
    expect(content.currentAssistantId).toBeNull();
    expect(content.currentTurn).toBeUndefined();
    expect(content.tool('removed-tool')).toBeUndefined();
    content.admitUser({ id: 'next', role: 'user', content: 'new question', timestamp: 't' });
    presentation.beginNativeMessage('after');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'retained');
    content.updateTool(oldTool, { result: 'late old result' });
    const rows = transcriptMessages(writer.projection);
    expect(rows).toHaveLength(2);
    expect(rows[1].content).toContain('retained');
    expect(JSON.stringify(rows)).not.toContain('removed');
    expect(writer.status.reason).toBeUndefined();
    await writer.close();
  });

  it('confirms a single native block spanning three user admissions without moving or duplicating text', async () => {
    const { writer, content, presentation } = setup();
    presentation.beginNativeMessage('response');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'before');
    content.admitUser({ id: 'steer-1', role: 'user', content: 'next', timestamp: new Date().toISOString() });
    presentation.record('chat:message-chunk', 'middle');
    content.admitUser({ id: 'steer-2', role: 'user', content: 'again', timestamp: new Date().toISOString() });
    presentation.record('chat:message-chunk', 'after');
    presentation.confirmNativeBlocks('response', 'delivery', [{ type: 'text', text: 'beforemiddleafter!' }]);
    const confirmed = presentation.confirmNativeBlocks('response', 'delivery', [{ type: 'text', text: 'beforemiddleafter!' }]);
    expect(confirmed.map(change => change.target.messageId)).toEqual([content.currentAssistantId]);
    expect([...writer.projection.messages.values()].filter(row => row.role === 'assistant').map(row => presentation.sdkBoundary(row.id))).toEqual([undefined, undefined, 'delivery']);
    presentation.endNativeBlock(0);
    const rows = [...writer.projection.messages.values()];
    expect(rows.map(row => row.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(rows.filter(row => row.role === 'assistant').map(row => row.content)).toMatchObject([
      [{ text: 'before', isComplete: true }], [{ text: 'middle', isComplete: true }], [{ text: 'after!', isComplete: true }],
    ]);
    await writer.close();
  });

  it('retracts a child refusal without touching an active root stream and ignores late child content', async () => {
    const { writer, content, presentation } = setup();
    presentation.record('chat:tool-use-start', { id: 'parent', name: 'Task', input: {} });
    presentation.beginNativeMessage('child', 'parent');
    presentation.beginNativeBlock(0, { type: 'text', text: '' }, 'parent');
    presentation.appendChildNativeText('parent', 0, 'refusal');
    presentation.confirmNativeBlocks('child', 'child-frame', [{ type: 'text', text: 'refusal' }], 'parent');
    presentation.beginNativeMessage('root');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'root');
    presentation.retractNativeContent(['child-frame'], false);
    presentation.record('chat:message-chunk', ' continues');
    presentation.retractNativeContent(['child-frame'], true, 'parent');
    presentation.appendChildNativeText('parent', 0, 'late');
    presentation.confirmNativeBlocks('child', 'child-frame', [{ type: 'text', text: 'late full' }], 'parent');
    expect(content.readTool(content.tool('parent')!)?.subagentCalls).toEqual([]);
    expect(writer.projection.messages.get(content.currentAssistantId!)?.content).toMatchObject([
      { tool: { id: 'parent' } }, { text: 'root continues' },
    ]);
    await writer.close();
  });

  it('keeps child native blocks under their original tool and confirms partial/full without duplicating root content', async () => {
    const { writer, content, presentation } = setup();
    presentation.record('chat:tool-use-start', { id: 'parent', name: 'Task', input: {} });
    const parent = content.tool('parent')!;
    presentation.beginNativeMessage('child', 'parent');
    presentation.beginNativeBlock(0, { type: 'text', text: '' }, 'parent');
    presentation.appendChildNativeText('parent', 0, 'hel');
    presentation.confirmNativeBlocks('child', 'delivery', [{ type: 'text', text: 'hello' }], 'parent');
    presentation.appendChildNativeText('parent', 0, 'lo');
    presentation.endNativeBlock(0, 'parent');
    content.admitUser({ id: 'steer', role: 'user', content: 'next', timestamp: new Date().toISOString() });
    presentation.beginNativeMessage('root');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'root answer');
    presentation.confirmNativeBlocks('child', 'delivery', [{ type: 'text', text: 'corrected child' }], 'parent');
    presentation.confirmNativeBlocks('child', 'thinking-delivery', [{ type: 'thinking', thinking: 'child reasoning', signature: 'signature' }], 'parent');
    expect(content.readTool(parent)?.subagentCalls).toMatchObject([
      { name: 'AgentMessage', result: 'corrected child', isLoading: false },
      { name: 'Thinking', result: 'child reasoning', signature: 'signature', isLoading: false },
    ]);
    expect(writer.projection.messages.get(content.currentAssistantId!)?.content).toMatchObject([{ text: 'root answer' }]);
    await writer.close();
  });

  it('confirms sibling SDK frames with a shared message id and retains a later full-only block', async () => {
    const { writer, presentation, durable, blocks } = setup();
    presentation.beginNativeMessage('model-response');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'hel');
    presentation.confirmNativeBlocks('model-response', 'frame-1', [{ type: 'text', text: 'hello' }]);
    presentation.endNativeBlock(0);
    presentation.beginNativeBlock(1, { type: 'tool_use', id: 'tool', name: 'Read', input: {} });
    presentation.record('chat:tool-input-delta', { toolId: 'tool', delta: '{"path":' });
    presentation.confirmNativeBlocks('model-response', 'frame-2', [{ type: 'tool_use', id: 'tool', name: 'Read', input: { path: '/a' } }]);
    presentation.endNativeBlock(1);
    presentation.confirmNativeBlocks('model-response', 'frame-3', [{ type: 'text', text: 'second text' }]);
    presentation.confirmNativeBlocks('model-response', 'frame-3', [{ type: 'text', text: 'second text' }]);
    expect(blocks()).toMatchObject([{ type: 'text', text: 'hello' }, { type: 'tool_use' }, { type: 'text', text: 'second text' }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(transcriptMessages(durable)).toEqual(transcriptMessages(writer.projection));
    await writer.close();
  });

  it('handles full-before-partial and corrects the original block after a user steer', async () => {
    const { writer, content, presentation, blocks } = setup();
    presentation.confirmNativeBlocks('model-response', 'frame', [{ type: 'text', text: 'whole text' }]);
    const originalId = content.currentAssistantId!;
    presentation.beginNativeMessage('model-response');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'whole');
    presentation.record('chat:message-chunk', ' text');
    presentation.endNativeBlock(0);
    expect(blocks()).toHaveLength(1);
    content.admitUser({ id: 'steer', role: 'user', content: 'more', timestamp: new Date().toISOString() });
    presentation.beginNativeMessage('next-response');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'next');
    presentation.confirmNativeBlocks('model-response', 'frame', [{ type: 'text', text: 'corrected text' }]);
    expect(writer.projection.messages.get(originalId)?.content).toMatchObject([{ text: 'corrected text' }]);
    expect(blocks()).toMatchObject([{ text: 'next' }]);
    expect([...writer.projection.messages.keys()]).toEqual(['user', originalId, 'steer', content.currentAssistantId]);
    await writer.close();
  });

  it('keeps thinking and server tool identities through confirmation and repeated terminal', async () => {
    const { writer, content, presentation, blocks } = setup();
    presentation.beginNativeMessage('response');
    presentation.beginNativeBlock(0, { type: 'thinking', thinking: '' });
    presentation.record('chat:thinking-start', { index: 0 });
    presentation.record('chat:thinking-chunk', { index: 0, delta: 'think' });
    presentation.confirmNativeBlocks('response', 'thinking-frame', [{ type: 'thinking', thinking: 'thinking', signature: 'signature' }]);
    presentation.endNativeBlock(0);
    presentation.beginNativeBlock(1, { type: 'server_tool_use', id: 'server-tool', name: 'web_search', input: {} });
    presentation.record('chat:server-tool-use-start', { id: 'server-tool', name: 'web_search', input: {}, streamIndex: 1 });
    presentation.confirmNativeBlocks('response', 'tool-frame', [{ type: 'server_tool_use', id: 'server-tool', name: 'web_search', input: { q: 'query' } }]);
    content.finishTurn('complete', { usage: { inputTokens: 4, outputTokens: 6 } });
    content.finishTurn('interrupted');
    expect(blocks()).toMatchObject([{ type: 'thinking', thinking: 'thinking', signature: 'signature', isComplete: true }, { type: 'server_tool_use' }]);
    expect(content.currentTurn).toMatchObject({ status: 'complete', usage: { inputTokens: 4, outputTokens: 6 } });
    await writer.close();
  });

  it('retracts the refused model leg without erasing earlier blocks in the same segment', async () => {
    const { writer, content, presentation, durable, blocks } = setup();
    presentation.confirmNativeBlocks('prior-response', 'prior-frame', [{ type: 'text', text: 'kept prefix' }]);
    const assistantId = content.currentAssistantId;
    presentation.beginNativeMessage('refused-response');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'refused text');
    presentation.confirmNativeBlocks('refused-response', 'refused-frame', [{ type: 'text', text: 'refused text' }]);
    expect(presentation.retractNativeContent(['refused-frame'], true)).toEqual([]);
    presentation.beginNativeMessage('fallback-response');
    presentation.beginNativeBlock(0, { type: 'text', text: '' });
    presentation.record('chat:message-chunk', 'replacement');
    presentation.retractNativeContent(['refused-frame'], true);
    presentation.confirmNativeBlocks('refused-response', 'refused-frame', [{ type: 'text', text: 'late refused callback' }]);
    expect(content.currentAssistantId).toBe(assistantId);
    expect(blocks()).toMatchObject([{ text: 'kept prefix' }, { text: 'replacement' }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(transcriptMessages(durable)).toEqual(transcriptMessages(writer.projection));
    await writer.close();
  });
});
