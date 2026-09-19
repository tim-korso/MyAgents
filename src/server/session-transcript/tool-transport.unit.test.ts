import { afterEach, describe, expect, it, vi } from 'vitest';
import { maybeSpill } from '../utils/large-value-store';
import { prepareToolPresentationEvent } from './tool-transport';

vi.mock('../utils/large-value-store', () => ({ maybeSpill: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe('V2 full tool presentation', () => {
  it('publishes large native input through the existing final-input reference event', async () => {
    const input = { text: 'x'.repeat(220 * 1024) };
    const ref = { kind: 'ref', id: 'ref', preview: '', sizeBytes: 220 * 1024 };
    vi.mocked(maybeSpill).mockResolvedValue(ref as Awaited<ReturnType<typeof maybeSpill>>);
    const source = { id: 'tool', name: 'Read', input };
    const prepared = prepareToolPresentationEvent('chat:tool-use-start', source, 'session');
    expect(prepared.immediate).toEqual([{ event: 'chat:tool-use-start', data: { ...source, input: {} } }]);
    const events = [...prepared.immediate, ...await prepared.deferred!];
    expect(events).toEqual([
      { event: 'chat:tool-use-start', data: { ...source, input: {} } },
      { event: 'chat:content-block-stop', data: { toolId: 'tool', type: 'tool_use', inputRef: ref } },
    ]);
    expect(source.input).toBe(input);
    expect(maybeSpill).toHaveBeenCalledWith(JSON.stringify(input), expect.objectContaining({ sessionId: 'session' }));
  });

  it('shows large tool starts and results while preview IO is hung', () => {
    vi.mocked(maybeSpill).mockReturnValue(new Promise(() => {}));
    const start = prepareToolPresentationEvent('chat:tool-use-start', { id: 't', input: { text: 'x'.repeat(220 * 1024) } }, 's');
    const result = prepareToolPresentationEvent('chat:tool-result-complete', { toolUseId: 't', content: 'x'.repeat(220 * 1024) }, 's');
    expect(start.immediate[0].data.input).toEqual({});
    expect(result.immediate[0].data.content).toHaveLength(8192);
  });

  it('keeps a bounded result preview if reference storage fails without changing the source', async () => {
    vi.mocked(maybeSpill).mockRejectedValue(new Error('ENOSPC'));
    const source = { toolUseId: 'tool', content: 'x'.repeat(220 * 1024), attachments: [] };
    const prepared = prepareToolPresentationEvent('chat:tool-result-complete', source, 'session');
    const events = prepared.immediate;
    expect(await prepared.deferred).toEqual([]);
    expect(events[0].data.content).toHaveLength(8192);
    expect(source.content).toHaveLength(220 * 1024);
    expect(events[0].data.attachments).toEqual([]);
  });
});
