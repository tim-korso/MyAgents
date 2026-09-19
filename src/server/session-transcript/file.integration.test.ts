import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTranscriptOperation, createTranscriptProjection, transcriptMessages } from '../../shared/sessionTranscript';
import { withFileLock } from '../utils/file-lock';
import { TranscriptFile } from './file';
import type { TranscriptBatch } from './codec';
import { TranscriptWriter } from './writer';
import { ProductTranscriptContent } from './content';

const faults = vi.hoisted(() => ({ mode: '' as '' | 'partial' | 'sync' | 'access' | 'short' }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (faults.mode === 'access') {
        faults.mode = '';
        throw Object.assign(new Error('injected access denied'), { code: 'EACCES' });
      }
      const file = await actual.open(...args);
      return new Proxy(file, {
        get(target, name) {
          if (name === 'write') return async (...params: [Buffer, number, number, number]) => {
            if (faults.mode === 'partial' && Buffer.isBuffer(params[0])) {
              faults.mode = '';
              const bytes = params[0];
              await target.write(bytes, 0, Math.max(1, Math.floor(bytes.length / 2)), params[3]);
              throw new Error('injected partial write');
            }
            if (faults.mode === 'short') return target.write(params[0], params[1], Math.min(params[2], 17), params[3]);
            return target.write(...params);
          };
          if (name === 'sync') return async () => {
            if (faults.mode === 'sync') { faults.mode = ''; throw new Error('injected sync failure'); }
            return target.sync();
          };
          const value: unknown = Reflect.get(target, name);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

const roots: string[] = [];
async function setup(publishBirth?: () => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'myagents-transcript-v2-'));
  roots.push(root);
  const filePath = join(root, 'session-test.jsonl');
  const file = new TranscriptFile({
    sessionId: 'session-test', filePath, generation: 'g1', allowCreate: true,
    withLock: run => withFileLock({ lockPath: join(root, 'session.lock') }, run), publishBirth,
  });
  const initial: TranscriptBatch = {
    id: 'b1', mode: 'delta', fromRevision: 1, revision: 1,
    operations: [{ kind: 'message-create', message: { id: 'a', role: 'assistant', content: '', timestamp: 't' } }],
  };
  await file.append({ generation: 'g1', revision: 0 }, initial);
  return { file, filePath };
}

afterEach(async () => {
  faults.mode = '';
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('V2 real file commit and replacement', () => {
  it.each(['partial', 'sync', 'access'] as const)('retries the exact batch after %s failure without duplicates', async mode => {
    const { file, filePath } = await setup();
    const batch: TranscriptBatch = {
      id: 'b2', mode: 'delta', fromRevision: 2, revision: 2,
      operations: [{ kind: 'text-append', messageId: 'a', field: 'text', offset: 0, text: '未结束🙂' }],
    };
    faults.mode = mode;
    await expect(file.append({ generation: 'g1', revision: 1 }, batch)).rejects.toThrow('injected');
    await file.append({ generation: 'g1', revision: 1 }, batch);
    const restored = await file.read();
    expect(restored).toMatchObject({ revision: 2, tail: 'clean' });
    expect(transcriptMessages(restored.projection)[0].content).toBe('未结束🙂');
    expect((await readFile(filePath, 'utf8')).split('\n').filter(line => line.includes('"id":"b2"'))).toHaveLength(1);
  });

  it('continues successful short writes until the complete record is synced', async () => {
    const { file } = await setup();
    faults.mode = 'short';
    await file.append({ generation: 'g1', revision: 1 }, {
      id: 'short', mode: 'delta', fromRevision: 2, revision: 2,
      operations: [{ kind: 'text-append', messageId: 'a', field: 'text', offset: 0, text: '完整记录🙂' }],
    });
    expect((await file.read()).projection.messages.get('a')?.content).toBe('完整记录🙂');
    expect((await file.read()).tail).toBe('clean');
  });

  it.each(['x'.repeat(8 * 1024 * 1024), '\u0000'.repeat(2 * 1024 * 1024)])('persists large user content and the following turn without poisoning the queue (%#)', async text => {
    const { file } = await setup();
    const decoded = await file.read();
    const writer = new TranscriptWriter({ sessionId: 'session-test', generation: 'g1', revision: 1, projection: decoded.projection, storage: file });
    try {
      const content = new ProductTranscriptContent(writer);
      content.admitUser({ id: 'u1', role: 'user', timestamp: 't', content: text });
      content.append(content.block('reply', 'text', { text: '' }), 'text', 'received');
      content.finishTurn('complete');
      content.admitUser({ id: 'u2', role: 'user', timestamp: 't', content: 'next turn' });
      expect(await writer.flush(5000)).toBe(true);
      expect(transcriptMessages((await file.read()).projection)).toEqual(transcriptMessages(writer.projection));
      expect(transcriptMessages((await file.read()).projection).find(row => row.id === 'u1')?.content).toBe(text);
    } finally { await writer.close(); }
  });

  it('publishes a complete chunked baseline and preserves optional metadata and late tool content', async () => {
    const { file } = await setup();
    const projection = createTranscriptProjection();
    const text = '🙂'.repeat(40_000);
    applyTranscriptOperation(projection, { kind: 'message-create', message: {
      id: 'a', role: 'assistant', timestamp: 't', usage: undefined,
      content: [{ id: 'tool', type: 'tool_use', tool: { id: 'call', name: 'Bash', result: text, subagentCalls: [{ id: 'child', name: 'Read', inputJson: text, result: 'done' }] } }],
    } });
    const committed = await file.replace({ generation: 'g1', revision: 1 }, projection, 19);
    expect(committed.revision).toBe(19);
    const restored = await file.read();
    expect(restored).toMatchObject({ revision: 19, tail: 'clean', header: { generation: committed.generation, baseline: true } });
    expect(transcriptMessages(restored.projection)).toEqual(transcriptMessages(projection));
  });

  it('confirms a replacement whose publication ack failed instead of overwriting it', async () => {
    let failPublication = false;
    const { file } = await setup(async () => {
      if (failPublication) { failPublication = false; throw new Error('publication ack failed'); }
    });
    const projection = (await file.read()).projection;
    applyTranscriptOperation(projection, { kind: 'text-append', messageId: 'a', field: 'text', offset: 0, text: 'first snapshot' });
    failPublication = true;
    await expect(file.replace({ generation: 'g1', revision: 1 }, projection, 2)).rejects.toThrow('publication ack');
    const published = await file.read();
    applyTranscriptOperation(projection, { kind: 'text-append', messageId: 'a', field: 'text', offset: 14, text: ' later' });
    const confirmed = await file.replace({ generation: 'g1', revision: 1 }, projection, 3);
    expect(confirmed).toEqual({ generation: published.header.generation, revision: 2 });
    expect(transcriptMessages((await file.read()).projection)[0].content).toBe('first snapshot');
  });
});
