import type {
  RecordTranscriptDelta,
  RecordTranscriptSnapshot,
  RecordSpeechProjection,
} from '@/../shared/types/record';

/** Publish text and people together; their revision counters have different
 * domains, so independently picking the largest counter can mix two reruns. */
export function reconcileRecordSpeechProjection(
  current: RecordSpeechProjection,
  next: RecordSpeechProjection,
): RecordSpeechProjection {
  if (next.diarization && (!next.transcript
    || next.diarization.recordId !== next.transcript.recordId
    || next.diarization.processingId !== next.transcript.processingId)) return current;
  const transcript = reconcileRecordTranscriptSnapshot(current.transcript, next.transcript);
  if (transcript !== next.transcript) return current;
  const sameProcessing = current.transcript?.recordId === next.transcript?.recordId
    && current.transcript?.processingId === next.transcript?.processingId;
  const diarization = sameProcessing && current.diarization && next.diarization
    && current.diarization.projectionRevision === next.diarization.projectionRevision
    && current.diarization.overrideRevision > next.diarization.overrideRevision
    ? current.diarization : next.diarization;
  return { transcript, diarization };
}

/**
 * Live journal revisions and the finalized transcript projection are separate
 * revision domains. A finalized snapshot is authoritative even when its first
 * revision is numerically lower than the last live-journal revision.
 */
export function reconcileRecordTranscriptSnapshot(
  current: RecordTranscriptSnapshot | null,
  next: RecordTranscriptSnapshot | null,
): RecordTranscriptSnapshot | null {
  if (!next) return current;
  if (!current || current.recordId !== next.recordId) return next;

  const currentIsFinal = current.state === 'recording_final';
  const nextIsFinal = next.state === 'recording_final';
  if (currentIsFinal !== nextIsFinal) return nextIsFinal ? next : current;
  return next.projectionRevision >= current.projectionRevision ? next : current;
}

export function applyRecordTranscriptDelta(
  current: RecordTranscriptSnapshot | null,
  delta: RecordTranscriptDelta,
): RecordTranscriptSnapshot | null {
  if (delta.resetSnapshot) return delta.resetSnapshot;
  if (
    !current ||
    current.recordId !== delta.recordId ||
    delta.projectionRevision <= current.projectionRevision
  ) {
    return current;
  }

  if (delta.upserts.length === 0) {
    return {
      ...current,
      projectionRevision: delta.projectionRevision,
      state: delta.state,
    };
  }

  const segments = [...current.segments];
  let orderChanged = false;
  for (const segment of delta.upserts) {
    const existingIndex = segments.findIndex(
      (candidate) => candidate.segmentId === segment.segmentId,
    );
    if (existingIndex >= 0) {
      const existing = segments[existingIndex];
      if (segment.revision <= existing.revision) continue;
      orderChanged ||=
        segment.startSample !== existing.startSample ||
        segment.endSample !== existing.endSample;
      segments[existingIndex] = segment;
      continue;
    }
    const previous = segments.at(-1);
    orderChanged ||=
      !!previous &&
      (segment.startSample < previous.startSample ||
        (segment.startSample === previous.startSample &&
          (segment.endSample < previous.endSample ||
            (segment.endSample === previous.endSample &&
              segment.segmentId.localeCompare(previous.segmentId) < 0))));
    segments.push(segment);
  }
  if (orderChanged) {
    segments.sort(
      (left, right) =>
        left.startSample - right.startSample ||
        left.endSample - right.endSample ||
        left.segmentId.localeCompare(right.segmentId),
    );
  }
  return {
    ...current,
    projectionRevision: delta.projectionRevision,
    state: delta.state,
    segments,
  };
}
