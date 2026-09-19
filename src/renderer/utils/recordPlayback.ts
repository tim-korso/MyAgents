import type { RecordTrackTimeline } from '@/../shared/types/record';

const SAMPLE_RATE = 16_000;
const MAX_SAMPLES = 8 * 60 * 60 * SAMPLE_RATE;

export interface RecordPlaybackPosition {
  sourceSeconds: number;
  playbackRate: number;
  audible: boolean;
  /** Next Record boundary, including a silent interval before this source. */
  boundaryMs: number;
  spanIndex: number;
}

/** The capture contract uses half-open spans, with explicit source gaps and
 * legal gaps in Record time. A gap never borrows audio from a later span. */
export function validRecordPlaybackTimeline(timeline: RecordTrackTimeline): boolean {
  if (timeline.spans.length === 0 || timeline.spans.length > 512) return false;
  let sourceEnd = 0;
  let recordEnd = 0;
  for (const span of timeline.spans) {
    if (![span.sourceStart, span.sourceEnd, span.recordStart, span.recordEnd]
      .every((value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAMPLES)
      || span.sourceStart !== sourceEnd || span.sourceStart >= span.sourceEnd
      || span.recordStart < recordEnd || span.recordStart >= span.recordEnd
      || !['clock', 'estimated', 'gap'].includes(span.quality)) return false;
    sourceEnd = span.sourceEnd;
    recordEnd = span.recordEnd;
  }
  return true;
}

export function recordPlaybackPosition(
  timeline: RecordTrackTimeline | undefined,
  recordMs: number,
  sourceDurationSeconds = Infinity,
): RecordPlaybackPosition {
  if (!Number.isFinite(recordMs) || recordMs < 0
    || (timeline && !validRecordPlaybackTimeline(timeline))) throw new Error('Invalid Record playback timeline');
  if (!timeline) {
    const audible = recordMs / 1_000 < sourceDurationSeconds;
    // An ended legacy source has no future boundary, just like an exhausted
    // mapped timeline. Its old endpoint must not trap another track's clock.
    return { sourceSeconds: Math.min(recordMs / 1_000, sourceDurationSeconds), playbackRate: 1,
      audible, boundaryMs: audible ? sourceDurationSeconds * 1_000 : Infinity, spanIndex: 0 };
  }
  const frame = recordMs * SAMPLE_RATE / 1_000;
  const index = timeline.spans.findIndex((span) => frame < span.recordEnd);
  if (index < 0) {
    const last = timeline.spans[timeline.spans.length - 1];
    return { sourceSeconds: last.sourceEnd / SAMPLE_RATE, playbackRate: 1, audible: false,
      boundaryMs: Infinity, spanIndex: timeline.spans.length };
  }
  const span = timeline.spans[index];
  if (frame < span.recordStart) {
    return { sourceSeconds: span.sourceStart / SAMPLE_RATE, playbackRate: 1, audible: false,
      boundaryMs: span.recordStart * 1_000 / SAMPLE_RATE, spanIndex: index };
  }
  const playbackRate = (span.sourceEnd - span.sourceStart) / (span.recordEnd - span.recordStart);
  const sourceSeconds = (span.sourceStart + (frame - span.recordStart) * playbackRate) / SAMPLE_RATE;
  return { sourceSeconds, playbackRate, audible: span.quality !== 'gap' && sourceSeconds < sourceDurationSeconds,
    boundaryMs: span.recordEnd * 1_000 / SAMPLE_RATE, spanIndex: index };
}

export function sourcePlaybackRecordMs(timeline: RecordTrackTimeline | undefined, sourceSeconds: number): number {
  if (!Number.isFinite(sourceSeconds) || sourceSeconds < 0
    || (timeline && !validRecordPlaybackTimeline(timeline))) throw new Error('Invalid Record source position');
  if (!timeline) return sourceSeconds * 1_000;
  const frame = sourceSeconds * SAMPLE_RATE;
  const span = timeline.spans.find((span) => frame < span.sourceEnd);
  if (!span) return timeline.spans[timeline.spans.length - 1].recordEnd * 1_000 / SAMPLE_RATE;
  return (span.recordStart + (frame - span.sourceStart) * (span.recordEnd - span.recordStart)
    / (span.sourceEnd - span.sourceStart)) * 1_000 / SAMPLE_RATE;
}
