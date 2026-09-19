import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranscriptProjection, transcriptMessages } from '../../shared/sessionTranscript';
import { TranscriptWriter, type TranscriptStorage } from './writer';

function setup(storage?: Partial<TranscriptStorage>) {
  const append = vi.fn<TranscriptStorage['append']>().mockResolvedValue();
  const replace = vi.fn<TranscriptStorage['replace']>().mockImplementation(async (_expected, _snapshot, revision) => ({ generation: 'g2', revision }));
  const onStatus = vi.fn();
  const writer = new TranscriptWriter({
    sessionId: 's1', generation: 'g1', revision: 0,
    projection: createTranscriptProjection(), storage: { append, replace, ...storage },
    onStatus,
  });
  writer.observe({ kind: 'message-create', message: { id: 'a1', role: 'assistant', timestamp: 't', content: '' } });
  return { writer, append, replace, onStatus };
}

afterEach(() => vi.useRealTimers());

describe('V2 background persistence', () => {
  it('accepts one healthy 8 MiB tool result without discarding pending content', async () => {
    vi.useFakeTimers();
    const { writer, append, replace } = setup();
    const chunk = 'x'.repeat(32 * 1024);
    for (let offset = 0; offset < 8 * 1024 * 1024; offset += chunk.length) {
      writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset, text: chunk });
    }
    expect(writer.status.state).toBe('healthy');
    await vi.runAllTimersAsync();
    expect(replace).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalled();
    expect(writer.status.durableRevision).toBe(writer.status.liveRevision);
    expect((writer.projection.messages.get('a1')?.content as string).length).toBe(8 * 1024 * 1024);
    await writer.close();
  });

  it('commits an unfinished stream at a fixed deadline despite continuous deltas', async () => {
    vi.useFakeTimers();
    const { writer, append } = setup();
    for (let offset = 0; offset < 5; offset++) {
      writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset, text: 'x' });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1]).toMatchObject({ fromRevision: 1, revision: 6 });
    expect(writer.status).toMatchObject({ state: 'healthy', liveRevision: 6, durableRevision: 6 });
    await writer.close();
  });

  it('retains the exact uncertain batch on retry while new content proceeds', async () => {
    vi.useFakeTimers();
    const { writer, append } = setup();
    append.mockRejectedValueOnce(new Error('sync failed after append'));
    await vi.advanceTimersByTimeAsync(100);
    expect(writer.status.state).toBe('retrying');
    writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset: 0, text: 'still running' });
    expect(transcriptMessages(writer.projection)[0].content).toBe('still running');
    await vi.advanceTimersByTimeAsync(501);
    expect(append.mock.calls[1][1]).toEqual(append.mock.calls[0][1]);
    expect(writer.status.state).toBe('healthy');
    await writer.close();
  });

  it('does not launch a second writer when IO hangs, even after a flush timeout', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const append = vi.fn<TranscriptStorage['append']>()
      .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockResolvedValue();
    const { writer, replace } = setup({ append });
    await vi.advanceTimersByTimeAsync(100);
    const flushed = writer.flush(10);
    // A healthy burst can exceed both the former 8 MiB cap and the proposed
    // 16 MiB cap while one write is pending. No capacity policy owns admission.
    const chunk = 'x'.repeat(32 * 1024);
    const size = 20 * 1024 * 1024;
    for (let offset = 0; offset < size; offset += chunk.length) {
      writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset, text: chunk });
    }
    expect(writer.status.state).toBe('healthy');
    expect(writer.diagnostics.queuedBytes).toBeGreaterThan(size);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await flushed).toBe(false);
    expect(append).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(writer.status.reason).toBe('timeout');
    expect(transcriptMessages(writer.projection)[0].content).toHaveLength(size);
    release();
    await vi.runAllTimersAsync();
    expect(replace).not.toHaveBeenCalled();
    expect(writer.status).toMatchObject({ generation: 'g1', state: 'healthy', durableRevision: writer.status.liveRevision });
    const persistedText = append.mock.calls.flatMap(([, batch]) => batch.operations)
      .flatMap(operation => operation.kind === 'text-append' ? [operation.text] : []).join('');
    expect(persistedText).toBe(transcriptMessages(writer.projection)[0].content);
    expect(writer.diagnostics.queuedBytes).toBe(0);
    await writer.close();
  });

  it('waits for content received during a stalled baseline before claiming recovery', async () => {
    vi.useFakeTimers();
    let release!: (target: { generation: string; revision: number }) => void;
    const replace = vi.fn<TranscriptStorage['replace']>()
      .mockImplementationOnce(() => new Promise<{ generation: string; revision: number }>(resolve => { release = resolve; }));
    const { writer, append, onStatus } = setup({ replace });
    const source = createTranscriptProjection();
    source.messages.set('a1', { id: 'a1', role: 'assistant', timestamp: 't', content: 'baseline' });
    writer.replaceProjection(source);
    await vi.advanceTimersByTimeAsync(100);
    writer.observe({ kind: 'text-append', messageId: 'a1', field: 'text', offset: 8, text: ' after baseline' });
    await vi.advanceTimersByTimeAsync(10_001);
    const firstIncident = writer.status.incidentId;
    release({ generation: 'g2', revision: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(onStatus.mock.calls.filter(([status]) => status.generation === 'g2').every(([status]) => status.state !== 'healthy')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(1);
    expect(writer.status).toMatchObject({ generation: 'g2', state: 'healthy', durableRevision: 3, incidentId: firstIncident });
    await writer.close();
  });
});

it('waits for physical mutation IO beyond health/flush deadlines and reports real IO failure', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { writer } = setup({ append: async () => { await gate; } });
  let done = false;
  const waiting = writer.flushForMutation().then(result => { done = true; return result; });
  await vi.advanceTimersByTimeAsync(11_000);
  expect(done).toBe(false);
  release();
  expect(await waiting).toBe(true);
  await writer.close();
  const failed = setup({ append: async () => { throw new Error('disk unavailable'); } });
  expect(await failed.writer.flushForMutation()).toBe(false);
  expect(failed.writer.status.reason).toBe('io');
  await failed.writer.close();
});
