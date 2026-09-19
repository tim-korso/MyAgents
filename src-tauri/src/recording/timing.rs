//! Capture-owned observations, compressed off the realtime callback thread.

use myagents_media_worker_protocol::record_timeline::{
    CaptureTimeQuality, RecordTrackTimeline, TrackTimeSpan, MAX_TRACK_TIME_SPANS,
};

#[derive(Clone, Copy, Debug)]
pub(super) struct CaptureTimePoint {
    pub record_sample: u64,
    pub quality: CaptureTimeQuality,
    pub epoch: u64,
}

#[derive(Default)]
pub(super) struct CaptureTimeline {
    spans: Vec<TrackTimeSpan>,
    epoch: Option<u64>,
    error: Option<&'static str>,
    source_offset: i64,
}

impl CaptureTimeline {
    pub fn observe(
        &mut self,
        sample_rate: u32,
        source_start: u64,
        frames: u64,
        time: Option<CaptureTimePoint>,
        gap: bool,
    ) {
        if self.error.is_some() || frames == 0 {
            return;
        }
        // Ceil gives an available prefix until resampler/Opus flush fixes its
        // exact final length. It never extrapolates beyond a capture observation.
        let scale = |value: u64| ((value as u128 * 16_000).div_ceil(sample_rate as u128)) as u64;
        let Some(start) = scale(source_start).checked_add_signed(self.source_offset) else {
            self.error = Some("RECORDING_CAPTURE_TIME_INVALID");
            return;
        };
        let Some(end) =
            scale(source_start.saturating_add(frames)).checked_add_signed(self.source_offset)
        else {
            self.error = Some("RECORDING_CAPTURE_TIME_INVALID");
            return;
        };
        if start == end {
            return;
        }
        if self.spans.last().map_or(0, |span| span.source_end) != start {
            self.error = Some("RECORDING_CAPTURE_TIME_INVALID");
            return;
        }
        let epoch = time.map(|time| time.epoch);
        let mut boundary = epoch != self.epoch;
        let mut quality = if gap {
            CaptureTimeQuality::Gap
        } else {
            time.map_or(CaptureTimeQuality::Estimated, |time| time.quality)
        };
        let previous_end = self.spans.last().map_or(0, |span| span.record_end);
        let mut record_start = time.map_or(previous_end, |time| time.record_sample);
        if let Some(previous) = self.spans.last_mut() {
            // Arrival timestamps cannot measure device-clock drift: scheduler
            // bursts would compress real speech. Keep nominal sample duration
            // after the estimated epoch's first arrival anchor.
            if !boundary && quality == CaptureTimeQuality::Estimated && previous.quality == quality
            {
                record_start = previous_end;
            }
            // A clock jump is a hole/device boundary, not a whole-minute
            // resampling correction. Native callback jitter below 10 ms is
            // retained in the measured endpoints and assessed by quality tests.
            boundary |= record_start.abs_diff(previous.record_end) > 160;
            if !boundary && record_start > previous.record_start {
                // The next native timestamp closes the previous interval,
                // replacing its nominal last-buffer duration. This captures
                // drift instead of assuming equal frame counts mean equal time.
                previous.record_end = record_start;
            } else if record_start < previous_end {
                record_start = previous_end;
                if quality != CaptureTimeQuality::Gap {
                    quality = CaptureTimeQuality::Estimated;
                }
            }
        }
        let record_end = record_start.saturating_add(end - start);
        if record_end > myagents_media_worker_protocol::MAX_MEDIA_SAMPLES_PER_TRACK {
            self.error = Some("RECORDING_CAPTURE_TIME_LIMIT");
            return;
        }
        if let Some(previous) = self.spans.last_mut() {
            if !boundary
                && quality == previous.quality
                && start - previous.source_start < 60 * 16_000
            {
                previous.source_end = end;
                previous.record_end = record_end;
                return;
            }
        }
        if self.spans.len() == MAX_TRACK_TIME_SPANS {
            self.error = Some("RECORDING_CAPTURE_TIME_LIMIT");
            return;
        }
        self.spans.push(TrackTimeSpan {
            source_start: start,
            source_end: end,
            record_start,
            record_end,
            quality,
            discontinuity: boundary || gap,
        });
        self.epoch = epoch;
    }

    pub fn snapshot(&self) -> Result<Option<RecordTrackTimeline>, &'static str> {
        if let Some(error) = self.error {
            return Err(error);
        }
        if self.spans.is_empty() {
            return Ok(None);
        }
        let timeline = RecordTrackTimeline {
            spans: self.spans.clone(),
        };
        if !timeline.is_valid() {
            return Err("RECORDING_CAPTURE_TIME_INVALID");
        }
        Ok(Some(timeline))
    }

    /// A pause flush rounds the actual analysis output independently from the
    /// continuous archive resampler. Carry that exact output frontier into the
    /// next epoch instead of accumulating a one-sample coordinate error.
    pub fn close_resampler_epoch(
        &mut self,
        sample_rate: u32,
        native_frames: u64,
        output_frames: u64,
    ) {
        if self.error.is_some() {
            return;
        }
        while self
            .spans
            .last()
            .is_some_and(|span| span.source_start >= output_frames)
        {
            self.spans.pop();
        }
        if let Some(last) = self.spans.last_mut() {
            if output_frames < last.source_end {
                let length = last.source_end - last.source_start;
                let retained = output_frames - last.source_start;
                last.record_end = last.record_start
                    + ((last.record_end - last.record_start) as u128 * retained as u128
                        / length as u128) as u64;
            }
            last.source_end = output_frames;
        }
        let unrounded_frames = (native_frames as u128 * 16_000).div_ceil(sample_rate as u128);
        self.source_offset = output_frames as i64 - unrounded_frames as i64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clock(record_sample: u64, epoch: u64) -> Option<CaptureTimePoint> {
        Some(CaptureTimePoint {
            record_sample,
            epoch,
            quality: CaptureTimeQuality::Clock,
        })
    }

    #[test]
    fn captures_absolute_start_and_native_clock_drift_without_one_span_per_callback() {
        let mut capture = CaptureTimeline::default();
        for second in 0..180 {
            capture.observe(
                48_000,
                second * 48_000,
                48_000,
                clock(3_200 + second * 16_008, 1),
                false,
            );
        }
        let timeline = capture.snapshot().unwrap().unwrap();
        assert_eq!(timeline.spans.len(), 3);
        assert_eq!(
            timeline.map_interval(0, 60 * 16_000).unwrap().end_sample,
            3_200 + 60 * 16_008
        );
        assert_eq!(
            timeline.source_sample(3_200 + 60 * 16_008),
            Some(60 * 16_000)
        );
        assert!(timeline
            .spans
            .iter()
            .all(|span| span.quality == CaptureTimeQuality::Clock));
    }

    #[test]
    fn pause_and_missing_samples_remain_explicit_even_at_adjacent_media_times() {
        let mut capture = CaptureTimeline::default();
        capture.observe(16_000, 0, 160, clock(0, 1), false);
        capture.observe(16_000, 160, 160, clock(160, 2), false);
        capture.observe(16_000, 320, 160, None, true);
        capture.observe(16_000, 480, 160, clock(480, 2), false);
        let timeline = capture.snapshot().unwrap().unwrap();
        assert_eq!(timeline.spans.len(), 4);
        assert!(timeline.spans[1].discontinuity);
        assert_eq!(timeline.spans[2].quality, CaptureTimeQuality::Gap);
        assert!(!timeline.map_interval(0, 640).unwrap().reliable);
        assert_eq!(timeline.prefix(520).unwrap().source_samples(), 520);
        assert!(timeline.prefix(641).is_none());
    }

    #[test]
    fn pause_flush_rounding_does_not_accumulate_analysis_coordinate_errors() {
        let mut capture = CaptureTimeline::default();
        for epoch in 0..10 {
            capture.observe(
                44_100,
                epoch * 1_001,
                1_001,
                clock(epoch * 363, epoch),
                false,
            );
            capture.close_resampler_epoch(44_100, (epoch + 1) * 1_001, (epoch + 1) * 363);
        }
        let timeline = capture.snapshot().unwrap().unwrap();
        assert_eq!(timeline.source_samples(), 3_630);
        assert_eq!(timeline.spans.len(), 10);
        assert_eq!(timeline.spans[9].source_start, 3_267);
    }

    #[test]
    fn missing_and_backwards_clock_never_become_reliable() {
        let mut capture = CaptureTimeline::default();
        capture.observe(16_000, 0, 160, None, false);
        capture.observe(16_000, 160, 160, clock(80, 1), false);
        let timeline = capture.snapshot().unwrap().unwrap();
        assert!(!timeline.map_interval(0, 320).unwrap().reliable);
        assert!(timeline
            .spans
            .iter()
            .all(|span| span.quality == CaptureTimeQuality::Estimated));
    }
}
