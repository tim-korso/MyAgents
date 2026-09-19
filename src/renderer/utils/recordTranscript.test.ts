import { describe, expect, it } from 'vitest';

import type {
  RecordTranscriptDelta,
  RecordTranscriptSnapshot,
  RecordSpeechProjection,
} from '@/../shared/types/record';
import {
  applyRecordTranscriptDelta,
  reconcileRecordTranscriptSnapshot,
  reconcileRecordSpeechProjection,
} from './recordTranscript';

const BASE: RecordTranscriptSnapshot = {
  schemaVersion: 1,
  recordId: 'record-1',
  projectionRevision: 2,
  state: 'live',
  sampleRate: 16_000,
  provenance: {
    provider: 'local',
    modelPackRevision: 'v1',
    onnxRuntimeVersion: '1.28',
  },
  segments: [
    {
      segmentId: 'later',
      track: 'microphone',
      startSample: 32_000,
      endSample: 48_000,
      text: 'later',
      revision: 1,
    },
  ],
};

function delta(
  overrides: Partial<RecordTranscriptDelta>,
): RecordTranscriptDelta {
  return {
    recordId: 'record-1',
    projectionRevision: 3,
    state: 'live',
    upserts: [],
    cursor: { journalBytes: 100, projectionRevision: 3 },
    ...overrides,
  };
}

describe('applyRecordTranscriptDelta', () => {
  it('merges newer upserts and keeps timeline order', () => {
    const result = applyRecordTranscriptDelta(
      BASE,
      delta({
        upserts: [
          {
            segmentId: 'earlier',
            track: 'microphone',
            startSample: 1_000,
            endSample: 2_000,
            text: 'earlier',
            revision: 1,
          },
        ],
      }),
    );
    expect(result?.segments.map((segment) => segment.segmentId)).toEqual([
      'earlier',
      'later',
    ]);
    expect(result?.projectionRevision).toBe(3);
  });

  it('ignores stale deltas and accepts authoritative resets', () => {
    expect(
      applyRecordTranscriptDelta(
        BASE,
        delta({ projectionRevision: 1, state: 'recovering' }),
      ),
    ).toBe(BASE);
    const reset = { ...BASE, projectionRevision: 8, segments: [] };
    expect(
      applyRecordTranscriptDelta(
        BASE,
        delta({ projectionRevision: 8, resetSnapshot: reset }),
      ),
    ).toBe(reset);
  });

  it('reuses the segment projection for state-only deltas', () => {
    const result = applyRecordTranscriptDelta(
      BASE,
      delta({ state: 'finalizing', upserts: [] }),
    );

    expect(result?.segments).toBe(BASE.segments);
    expect(result?.state).toBe('finalizing');
  });

  it('adopts the finalized projection across the live revision boundary', () => {
    const live = { ...BASE, projectionRevision: 42, state: 'live' as const };
    const finalized = {
      ...BASE,
      projectionRevision: 1,
      state: 'recording_final' as const,
      segments: [{ ...BASE.segments[0], text: 'final text' }],
    };

    expect(reconcileRecordTranscriptSnapshot(live, finalized)).toBe(finalized);
    expect(reconcileRecordTranscriptSnapshot(finalized, live)).toBe(finalized);
  });
});

describe('Record text and people publication', () => {
  function result(processingId: string, textRevision: number, peopleRevision: number, overrideRevision = 0): RecordSpeechProjection {
    return {
      transcript: { ...BASE, schemaVersion: 2, processingId, projectionRevision: textRevision, state: 'recording_final' },
      diarization: { schemaVersion: 3, recordId: BASE.recordId, processingId, projectionRevision: peopleRevision,
        sampleRate: BASE.sampleRate, provenance: BASE.provenance, turns: [], overrideRevision,
        speakers: [], segmentSpeakerOverrides: {}, segmentSpeakerAttributions: {}, conflicts: [] },
    };
  }
  it('switches the whole rerun even when the old people counter was larger', () => {
    const old = result('old', 1, 50);
    const next = result('new', 2, 1);
    const published = reconcileRecordSpeechProjection(old, next);
    expect(published).toEqual(next);
    expect(reconcileRecordSpeechProjection(published, old)).toBe(published);
  });
  it('rejects an incomplete cross-processing pair and keeps newer human edits', () => {
    const current = result('current', 2, 7, 4);
    const mismatched = { ...result('new', 3, 8), diarization: current.diarization };
    expect(reconcileRecordSpeechProjection(current, mismatched)).toBe(current);
    const staleEditRead = result('current', 2, 7, 3);
    expect(reconcileRecordSpeechProjection(current, staleEditRead).diarization).toBe(current.diarization);
  });
  it('keeps a final pair when delayed live events or empty reads arrive', () => {
    const current = result('final', 1, 1);
    expect(reconcileRecordSpeechProjection(current, { transcript: { ...BASE, projectionRevision: 99 }, diarization: null })).toBe(current);
    expect(reconcileRecordSpeechProjection(current, { transcript: null, diarization: null })).toBe(current);
  });
});
