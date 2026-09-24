import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranscriptProjection, type TranscriptOperation } from '../../shared/sessionTranscript';
import type { TranscriptBatch } from './codec';
import { TranscriptWriter, type TranscriptStorage } from './writer';

function setup() {
  const append = vi.fn<TranscriptStorage['append']>().mockResolvedValue();
  const replace = vi.fn<TranscriptStorage['replace']>().mockImplementation(async (_expected, _snapshot, revision) => ({ generation: 'g2', revision }));
  const writer = new TranscriptWriter({
    sessionId: 's1', generation: 'g1', revision: 0,
    projection: createTranscriptProjection(), storage: { append, replace },
  });
  writer.observe({ kind: 'message-create', message: { id: 'a1', role: 'assistant', timestamp: 't', content: '' } });
  return { writer, append, replace };
}

/** Only the text stream matters here; envelopes are not coalescing candidates. */
function appendsOf(append: ReturnType<typeof setup>['append']) {
  return append.mock.calls
    .flatMap(([, batch]) => batch.operations)
    .filter((operation): operation is Extract<TranscriptOperation, { kind: 'text-append' }> => operation.kind === 'text-append');
}

/** Replay every persisted append the way the reader would, checking offsets. */
function replay(batches: TranscriptBatch[]): string {
  const text = new Map<string, string>();
  for (const batch of batches) {
    for (const operation of batch.operations) {
      if (operation.kind !== 'text-append') continue;
      const key = `${operation.messageId}/${operation.blockId ?? ''}/${operation.field}`;
      const previous = text.get(key) ?? '';
      expect(operation.offset).toBe(previous.length);
      text.set(key, previous + String(operation.text));
    }
  }
  return [...text.values()].join('');
}

afterEach(() => vi.useRealTimers());

// A per-token stream spent ~200 bytes of JSON envelope on a few characters,
// which is how a 12.5 MB reasoning stream became 615 MB of history.
describe('persisted append coalescing', () => {
  it('writes per-token deltas as few contiguous operations', async () => {
    vi.useFakeTimers();
    const { writer, append } = setup();
    const tokens = ['Hel', 'lo', ' ', 'wor', 'ld'];
    let offset = 0;
    for (const token of tokens) {
      writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset, text: token });
      offset += token.length;
    }
    await vi.runAllTimersAsync();

    const batches = append.mock.calls.map(([, batch]) => batch);
    // Five deltas, one persisted operation: the envelope is paid once.
    expect(appendsOf(append)).toHaveLength(1);
    expect(replay(batches)).toBe('Hello world');
    expect(writer.projection.messages.get('a1')?.content).toBe('Hello world');
    await writer.close();
  });

  it('keeps the live revision range spanning every coalesced delta', async () => {
    vi.useFakeTimers();
    const { writer, append } = setup();
    for (let offset = 0; offset < 5; offset++) {
      writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset, text: 'x' });
    }
    await vi.runAllTimersAsync();

    // Five observations must still advance the durable revision by five.
    expect(append.mock.calls[0][1]).toMatchObject({ fromRevision: 1, revision: 6 });
    expect(writer.status).toMatchObject({ liveRevision: 6, durableRevision: 6 });
    await writer.close();
  });

  it('starts a new operation when a non-append breaks the run', async () => {
    vi.useFakeTimers();
    const { writer, append } = setup();
    writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset: 0, text: 'abc' });
    // A block update between deltas is a stream boundary (a reset or a new
    // block), so the following text must not be folded into the earlier entry.
    writer.observe({ kind: 'message-update', messageId: 'a1', details: { transcriptState: 'streaming' } });
    writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset: 3, text: 'def' });
    await vi.runAllTimersAsync();

    expect(appendsOf(append)).toHaveLength(2);
    expect(replay(append.mock.calls.map(([, batch]) => batch))).toBe('abcdef');
    await writer.close();
  });

  it('never merges two different text fields', async () => {
    vi.useFakeTimers();
    const { writer, append } = setup();
    writer.observe({ kind: 'block-upsert', messageId: 'a1', block: { id: 'b1', type: 'text', text: '' } });
    writer.observe({ kind: 'text-append', messageId: 'a1', blockId: 'b1', field: 'text', offset: 0, text: 'answer' });
    writer.observe({ kind: 'text-append', messageId: 'a1', blockId: 'b1', field: 'thinking', offset: 0, text: 'why' });
    await vi.runAllTimersAsync();

    const appends = appendsOf(append);
    expect(appends.map(operation => operation.field)).toEqual(['text', 'thinking']);
    expect(appends.map(operation => operation.text)).toEqual(['answer', 'why']);
    await writer.close();
  });

  it('does not merge past the coalescing bound', async () => {
    vi.useFakeTimers();
    const { writer, append } = setup();
    const chunk = 'x'.repeat(32 * 1024);
    for (let offset = 0; offset < 3 * chunk.length; offset += chunk.length) {
      writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset, text: chunk });
    }
    await vi.runAllTimersAsync();

    const appends = appendsOf(append);
    expect(appends.length).toBeGreaterThan(1);
    expect(replay(append.mock.calls.map(([, batch]) => batch))).toHaveLength(3 * chunk.length);
    await writer.close();
  });
});
