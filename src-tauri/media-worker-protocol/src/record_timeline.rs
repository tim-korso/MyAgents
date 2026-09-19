//! The shared coordinate contract for a physical Record track.
//!
//! All positions use 16 kHz sample frames (never interleaved sample counts).
//! Capture owns these observations; inference can consume them but cannot turn
//! an estimated timestamp or an archive gap into precise identity evidence.

use crate::MAX_MEDIA_SAMPLES_PER_TRACK;
use serde::{Deserialize, Serialize};

pub const MAX_TRACK_TIME_SPANS: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureTimeQuality {
    Clock,
    Estimated,
    Gap,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackTimeSpan {
    pub source_start: u64,
    pub source_end: u64,
    pub record_start: u64,
    pub record_end: u64,
    pub quality: CaptureTimeQuality,
    /// Pause/device/source boundaries reset DSP even if media time is adjacent.
    #[serde(default)]
    pub discontinuity: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordTrackTimeline {
    pub spans: Vec<TrackTimeSpan>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MappedInterval {
    pub start_sample: u64,
    pub end_sample: u64,
    pub reliable: bool,
}

impl RecordTrackTimeline {
    /// Gaps in the Record clock are legal; gaps in the original track's sample
    /// inventory must be explicit spans, not silently compressed away.
    pub fn is_valid(&self) -> bool {
        if self.spans.is_empty() || self.spans.len() > MAX_TRACK_TIME_SPANS {
            return false;
        }
        let mut source_end = 0;
        let mut record_end = 0;
        for span in &self.spans {
            if span.source_start != source_end
                || span.source_start >= span.source_end
                || span.record_start >= span.record_end
                || span.record_start < record_end
                || span.source_end > MAX_MEDIA_SAMPLES_PER_TRACK
                || span.record_end > MAX_MEDIA_SAMPLES_PER_TRACK
            {
                return false;
            }
            source_end = span.source_end;
            record_end = span.record_end;
        }
        true
    }

    pub fn source_samples(&self) -> u64 {
        self.spans.last().map_or(0, |span| span.source_end)
    }

    /// Capture metadata may be ahead of the last durable Opus page. Recovery
    /// and live readers can consume only the prefix backed by real samples.
    pub fn prefix(&self, end: u64) -> Option<Self> {
        if end == 0 || end > self.source_samples() || !self.is_valid() {
            return None;
        }
        let mut spans = self
            .spans
            .iter()
            .take_while(|span| span.source_start < end)
            .cloned()
            .collect::<Vec<_>>();
        let last = spans.last_mut()?;
        last.record_end = interpolate(
            end,
            last.source_start,
            last.source_end,
            last.record_start,
            last.record_end,
        );
        last.source_end = end;
        let prefix = Self { spans };
        prefix.is_valid().then_some(prefix)
    }

    /// Maps a half-open source interval. No extrapolation is allowed: a valid
    /// clock prefix does not authorize positions beyond its captured extent.
    pub fn map_interval(&self, start: u64, end: u64) -> Option<MappedInterval> {
        if start >= end || !self.is_valid() || end > self.source_samples() {
            return None;
        }
        let first = self.spans.partition_point(|span| span.source_end <= start);
        let last = self.spans.partition_point(|span| span.source_start < end) - 1;
        let selected = &self.spans[first..=last];
        let first_span = selected.first()?;
        let last_span = selected.last()?;
        let record_start = interpolate(
            start,
            first_span.source_start,
            first_span.source_end,
            first_span.record_start,
            first_span.record_end,
        );
        let record_end = interpolate(
            end,
            last_span.source_start,
            last_span.source_end,
            last_span.record_start,
            last_span.record_end,
        );
        (record_start < record_end).then_some(MappedInterval {
            start_sample: record_start,
            end_sample: record_end,
            reliable: selected
                .iter()
                .all(|span| span.quality == CaptureTimeQuality::Clock)
                && selected.iter().skip(1).all(|span| !span.discontinuity)
                && selected
                    .windows(2)
                    .all(|pair| pair[0].record_end == pair[1].record_start),
        })
    }

    /// Inverse lookup is used for source playback and old annotation anchors.
    /// A point in a missing Record-time interval has no fabricated source point.
    pub fn source_sample(&self, record_sample: u64) -> Option<u64> {
        if !self.is_valid() {
            return None;
        }
        let index = self
            .spans
            .partition_point(|span| span.record_end <= record_sample);
        if index == self.spans.len() {
            let last = self.spans.last()?;
            return (record_sample == last.record_end).then_some(last.source_end);
        }
        let span = &self.spans[index];
        if record_sample < span.record_start || span.quality == CaptureTimeQuality::Gap {
            return None;
        }
        Some(interpolate(
            record_sample,
            span.record_start,
            span.record_end,
            span.source_start,
            span.source_end,
        ))
    }

    /// Inverse half-open interval lookup. An end exactly before a Record gap
    /// belongs to the preceding span, although the same point cannot start
    /// playback. Do not use two point lookups for an utterance's endpoints.
    pub fn unmap_interval(&self, start: u64, end: u64) -> Option<MappedInterval> {
        if start >= end || !self.is_valid() {
            return None;
        }
        let first = self.spans.partition_point(|span| span.record_end <= start);
        let last = self
            .spans
            .partition_point(|span| span.record_start < end)
            .checked_sub(1)?;
        if first > last || last >= self.spans.len() {
            return None;
        }
        let selected = &self.spans[first..=last];
        let first_span = selected.first()?;
        let last_span = selected.last()?;
        if start < first_span.record_start || end > last_span.record_end {
            return None;
        }
        let start_sample = interpolate(
            start,
            first_span.record_start,
            first_span.record_end,
            first_span.source_start,
            first_span.source_end,
        );
        let end_sample = interpolate(
            end,
            last_span.record_start,
            last_span.record_end,
            last_span.source_start,
            last_span.source_end,
        );
        (start_sample < end_sample).then_some(MappedInterval {
            start_sample,
            end_sample,
            reliable: selected
                .iter()
                .all(|span| span.quality == CaptureTimeQuality::Clock)
                && selected.iter().skip(1).all(|span| !span.discontinuity)
                && selected
                    .windows(2)
                    .all(|pair| pair[0].record_end == pair[1].record_start),
        })
    }
}

fn interpolate(value: u64, from_start: u64, from_end: u64, to_start: u64, to_end: u64) -> u64 {
    let scaled = (value - from_start) as u128 * (to_end - to_start) as u128;
    to_start + (scaled / (from_end - from_start) as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_and_inference_share_the_capture_coordinate_contract() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Point {
            record_sample: u64,
            source_sample: Option<u64>,
        }
        #[derive(Deserialize)]
        struct Case {
            name: String,
            timeline: RecordTrackTimeline,
            #[serde(default)]
            points: Vec<Point>,
        }
        #[derive(Deserialize)]
        struct Fixture {
            valid: Vec<Case>,
            invalid: Vec<Case>,
        }
        let fixture: Fixture = serde_json::from_str(include_str!(
            "../../../src/shared/fixtures/record-timeline.json"
        ))
        .unwrap();
        for case in fixture.valid {
            assert!(case.timeline.is_valid(), "{}", case.name);
            for point in case.points {
                assert_eq!(
                    case.timeline.source_sample(point.record_sample),
                    point.source_sample,
                    "{} at {}",
                    case.name,
                    point.record_sample
                );
            }
        }
        for case in fixture.invalid {
            assert!(!case.timeline.is_valid(), "{}", case.name);
        }
    }

    fn span(
        source_start: u64,
        source_end: u64,
        record_start: u64,
        record_end: u64,
    ) -> TrackTimeSpan {
        TrackTimeSpan {
            source_start,
            source_end,
            record_start,
            record_end,
            quality: CaptureTimeQuality::Clock,
            discontinuity: false,
        }
    }

    #[test]
    fn maps_known_start_offset_and_clock_drift_to_absolute_record_time() {
        let timeline = RecordTrackTimeline {
            spans: vec![span(0, 160_000, 3_200, 163_360)],
        };
        assert_eq!(
            timeline.map_interval(0, 80_000),
            Some(MappedInterval {
                start_sample: 3_200,
                end_sample: 83_280,
                reliable: true,
            })
        );
        assert_eq!(timeline.source_sample(83_280), Some(80_000));
        assert_eq!(timeline.source_sample(3_199), None);
        assert_eq!(timeline.map_interval(160_000, 160_001), None);
    }

    #[test]
    fn utterance_end_before_a_gap_is_valid_without_making_the_gap_playable() {
        let timeline = RecordTrackTimeline {
            spans: vec![span(0, 160, 10, 170), span(160, 320, 200, 360)],
        };
        assert_eq!(timeline.source_sample(170), None);
        assert_eq!(
            timeline.unmap_interval(10, 170),
            Some(MappedInterval {
                start_sample: 0,
                end_sample: 160,
                reliable: true
            })
        );
        assert_eq!(timeline.unmap_interval(170, 200), None);
        assert!(!timeline.unmap_interval(10, 360).unwrap().reliable);
        assert_eq!(
            timeline.unmap_interval(200, 360),
            Some(MappedInterval {
                start_sample: 160,
                end_sample: 320,
                reliable: true
            })
        );
    }

    #[test]
    fn half_open_boundary_does_not_inherit_the_next_gap() {
        let timeline = RecordTrackTimeline {
            spans: vec![
                span(0, 16_000, 0, 16_000),
                TrackTimeSpan {
                    quality: CaptureTimeQuality::Gap,
                    ..span(16_000, 32_000, 16_000, 32_000)
                },
                span(32_000, 48_000, 32_000, 48_000),
            ],
        };
        assert!(timeline.map_interval(0, 16_000).unwrap().reliable);
        assert!(!timeline.map_interval(15_999, 16_001).unwrap().reliable);
        assert!(timeline.map_interval(32_000, 48_000).unwrap().reliable);
        assert_eq!(timeline.source_sample(16_000), None);
        assert_eq!(timeline.source_sample(32_000), Some(32_000));
    }

    #[test]
    fn missing_capture_time_does_not_become_confident_identity_evidence() {
        let timeline = RecordTrackTimeline {
            spans: vec![TrackTimeSpan {
                quality: CaptureTimeQuality::Estimated,
                ..span(0, 16_000, 0, 16_000)
            }],
        };
        assert!(!timeline.map_interval(0, 16_000).unwrap().reliable);
        assert_eq!(timeline.source_sample(8_000), Some(8_000));
        // A legacy absence is represented by Option::None at the owner, never
        // deserialized as an exact zero-offset clock by this contract.
        assert!(serde_json::from_str::<RecordTrackTimeline>("{}").is_err());
    }

    #[test]
    fn keeps_record_clock_holes_and_rejects_compressed_source_inventory() {
        let timeline = RecordTrackTimeline {
            spans: vec![span(0, 10, 0, 10), span(10, 20, 30, 40)],
        };
        assert!(timeline.is_valid());
        assert_eq!(timeline.source_sample(20), None);
        assert!(!timeline.map_interval(5, 15).unwrap().reliable);
        assert_eq!(timeline.map_interval(10, 20).unwrap().start_sample, 30);
        let invalid = RecordTrackTimeline {
            spans: vec![span(0, 10, 0, 10), span(11, 20, 11, 20)],
        };
        assert!(!invalid.is_valid());
    }

    #[test]
    fn rejects_non_monotonic_empty_and_unbounded_maps() {
        for spans in [
            vec![],
            vec![span(0, 0, 0, 1)],
            vec![span(0, 1, 1, 1)],
            vec![span(0, 10, 0, 10), span(10, 20, 9, 20)],
            vec![span(0, MAX_MEDIA_SAMPLES_PER_TRACK + 1, 0, 1)],
            (0..=MAX_TRACK_TIME_SPANS as u64)
                .map(|i| span(i, i + 1, i, i + 1))
                .collect(),
        ] {
            let timeline = RecordTrackTimeline { spans };
            assert!(!timeline.is_valid());
            assert_eq!(timeline.map_interval(0, 1), None);
        }
    }
}
