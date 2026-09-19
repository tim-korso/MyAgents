import { describe, expect, it } from 'vitest';
import type { RecordTrackTimeline } from '@/../shared/types/record';
import { recordPlaybackPosition, sourcePlaybackRecordMs, validRecordPlaybackTimeline } from './recordPlayback';
import coordinateFixture from '../../shared/fixtures/record-timeline.json';

const timeline: RecordTrackTimeline = { spans: [
  { sourceStart: 0, sourceEnd: 32_000, recordStart: 16_000, recordEnd: 48_032, quality: 'clock', discontinuity: false },
  { sourceStart: 32_000, sourceEnd: 48_000, recordStart: 48_032, recordEnd: 64_032, quality: 'gap', discontinuity: true },
  { sourceStart: 48_000, sourceEnd: 80_000, recordStart: 80_000, recordEnd: 112_000, quality: 'estimated', discontinuity: true },
] };

describe('Record playback source and media clocks', () => {
  for (const fixture of coordinateFixture.valid) {
    it(`shares the Rust inference coordinate contract: ${fixture.name}`, () => {
      const map = fixture.timeline as RecordTrackTimeline;
      expect(validRecordPlaybackTimeline(map)).toBe(true);
      for (const point of fixture.points) {
        const position = recordPlaybackPosition(map, point.recordSample / 16);
        expect(position.audible).toBe(point.audible);
        if (point.sourceSample !== null) {
          // Rust rounds down to a sample; media playback keeps sub-sample time.
          const difference = position.sourceSeconds * 16_000 - point.sourceSample;
          expect(difference).toBeGreaterThanOrEqual(-1e-7);
          expect(difference).toBeLessThan(1);
        }
      }
    });
  }
  for (const fixture of coordinateFixture.invalid) {
    it(`rejects the same invalid coordinates as Rust: ${fixture.name}`, () => {
      const map = fixture.timeline as RecordTrackTimeline;
      expect(validRecordPlaybackTimeline(map)).toBe(false);
      expect(() => recordPlaybackPosition(map, 0)).toThrow('Invalid Record playback timeline');
    });
  }
  it('keeps the leading offset, archived gap, Record gap and exact resume boundary', () => {
    expect(recordPlaybackPosition(timeline, 0)).toMatchObject({ sourceSeconds: 0, audible: false, boundaryMs: 1_000 });
    expect(recordPlaybackPosition(timeline, 1_000)).toMatchObject({ sourceSeconds: 0, audible: true });
    expect(recordPlaybackPosition(timeline, 3_002)).toMatchObject({ sourceSeconds: 2, audible: false });
    expect(recordPlaybackPosition(timeline, 4_500)).toMatchObject({ sourceSeconds: 3, audible: false, boundaryMs: 5_000 });
    expect(recordPlaybackPosition(timeline, 5_000)).toMatchObject({ sourceSeconds: 3, audible: true });
    expect(recordPlaybackPosition(timeline, 7_000)).toMatchObject({ sourceSeconds: 5, audible: false });
  });
  it('corrects drift in playback rate and in both seek directions', () => {
    const position = recordPlaybackPosition(timeline, 2_001);
    expect(position.sourceSeconds).toBeCloseTo(1, 10);
    expect(position.playbackRate).toBeCloseTo(32_000 / 32_032, 10);
    expect(sourcePlaybackRecordMs(timeline, position.sourceSeconds)).toBeCloseTo(2_001, 10);
    expect(sourcePlaybackRecordMs(timeline, 3)).toBe(5_000);
  });
  it('plays original legacy samples without inventing a capture clock', () => {
    expect(recordPlaybackPosition(undefined, 1_250, 2)).toMatchObject({ sourceSeconds: 1.25, playbackRate: 1, audible: true });
    expect(recordPlaybackPosition(undefined, 2_000, 2)).toMatchObject({ sourceSeconds: 2, audible: false, boundaryMs: Infinity });
    expect(recordPlaybackPosition(undefined, 2_500, 2)).toMatchObject({ sourceSeconds: 2, audible: false, boundaryMs: Infinity });
    expect(sourcePlaybackRecordMs(undefined, 1.25)).toBe(1_250);
  });
  it('does not use an invalid map or silently compress missing source samples', () => {
    const invalid = { spans: [{ ...timeline.spans[0], sourceStart: 1 }] };
    expect(validRecordPlaybackTimeline(invalid)).toBe(false);
    expect(() => recordPlaybackPosition(invalid, 0)).toThrow('Invalid Record playback timeline');
  });
});
