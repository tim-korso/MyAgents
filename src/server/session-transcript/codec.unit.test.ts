import { describe, expect, it } from 'vitest';
import { decodeTranscript, encodeTranscriptBatch, type TranscriptBatch, type TranscriptHeader } from './codec';
import { transcriptMessages } from '../../shared/sessionTranscript';
import fixtures from '../../shared/fixtures/session-transcript-v2.json';
import { resolveTranscriptFormat } from '../../shared/transcriptFormat';

const header: TranscriptHeader = { kind: 'session-transcript', version: 2, sessionId: 'session-test', generation: 'g1', baseRevision: 0, baseline: false };
const batch: TranscriptBatch = {
  id: 'b1', mode: 'delta', fromRevision: 1, revision: 1,
  operations: [{ kind: 'message-create', message: { id: 'a1', role: 'assistant', timestamp: 't', content: '尚未结束🙂' } }],
};
const prefix = JSON.stringify(header) + '\n' + encodeTranscriptBatch(batch);

describe('V2 transcript valid prefix', () => {
  it.each(fixtures.cases)('shares Node/Rust semantics: $name', fixture => {
    if (fixture.error) {
      expect(() => decodeTranscript(fixture.wire, 'fixture-session')).toThrow();
      return;
    }
    const result = decodeTranscript(fixture.wire, 'fixture-session');
    expect({
      messages: [...result.projection.messages.values()], turns: [...result.projection.turns.values()],
      revision: result.revision, lastBatchId: result.lastBatchId,
      validBytes: result.validBytes, tail: result.tail,
    }).toEqual(fixture.expected);
  });

  it.each(fixtures.formats)('shares the immutable format decision: %j', fixture => {
    expect(resolveTranscriptFormat({
      metadataExists: Boolean(fixture.metadata),
      transcriptFormat: fixture.metadata?.transcriptFormat,
      legacyFileExists: fixture.legacyFileExists, v2FileExists: fixture.v2FileExists,
    })).toBe(fixture.expected);
  });
  it('restores a completed batch while discarding a torn tail without requiring terminal', () => {
    const restored = decodeTranscript(prefix + '{"batch":', header.sessionId);
    expect(restored).toMatchObject({ revision: 1, validBytes: Buffer.byteLength(prefix), tail: 'incomplete' });
    expect(transcriptMessages(restored.projection)[0].content).toBe('尚未结束🙂');
  });

  it('does not skip corruption and does not expose the first operation of a bad batch', () => {
    const invalid = encodeTranscriptBatch({
      id: 'b2', mode: 'delta', fromRevision: 2, revision: 3,
      operations: [
        { kind: 'text-append', messageId: 'a1', field: 'text', offset: 6, text: 'must roll back' },
        { kind: 'text-append', messageId: 'unknown', field: 'text', offset: 0, text: 'bad' },
      ],
    });
    const restored = decodeTranscript(prefix + invalid + encodeTranscriptBatch({ ...batch, id: 'b3', fromRevision: 4, revision: 4 }), header.sessionId);
    expect(restored).toMatchObject({ revision: 1, validBytes: Buffer.byteLength(prefix), tail: 'invalid' });
    expect(transcriptMessages(restored.projection)[0].content).toBe('尚未结束🙂');
  });

  it('requires complete replacement baselines and rejects the wrong identity or version', () => {
    const replacement = { ...header, generation: 'g2', baseline: true, baseRevision: 17, sourceGeneration: 'g1' };
    const baseline = { ...batch, mode: 'baseline' as const, fromRevision: 0, revision: 17 };
    expect(() => decodeTranscript(JSON.stringify(replacement) + '\n' + encodeTranscriptBatch(baseline), header.sessionId)).toThrow('Incomplete transcript baseline');
    const restored = decodeTranscript(JSON.stringify(replacement) + '\n' + encodeTranscriptBatch({ ...baseline, baselineEnd: true }), header.sessionId);
    expect(restored.revision).toBe(17);
    expect(() => decodeTranscript(prefix, 'another-session')).toThrow('header');
    expect(() => decodeTranscript(prefix.replace('"version":2', '"version":3'), header.sessionId)).toThrow('header');
  });
});
