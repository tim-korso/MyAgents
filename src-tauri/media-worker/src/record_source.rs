//! Bounded physical-source decoding on the Record clock. Capture metadata is
//! authoritative; missing legacy metadata stays estimated, never an AEC clock.

use crate::protocol::record_timeline::{CaptureTimeQuality, RecordTrackTimeline, TrackTimeSpan};
use crate::protocol::{RecordArtifactInput, TrackKind};
use crate::record_opus::{RecordOpusDecoder, RecordOpusError};
use crate::record_resampler::{RECORD_RESAMPLER_CONTEXT, RecordTimeResampler};
use std::collections::VecDeque;
use std::path::Path;
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordEchoReference {
    pub start_sample: u64,
    pub end_sample: u64,
}

pub struct SourceAudioChunk {
    pub track: TrackKind,
    pub start_sample: u64,
    pub channels: usize,
    pub quality: CaptureTimeQuality,
    pub discontinuity: bool,
    pub aec_applied: bool,
    pub echo_reference: Option<RecordEchoReference>,
    pub samples: Zeroizing<Vec<f32>>,
}

impl SourceAudioChunk {
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels
    }
    pub fn end_sample(&self) -> u64 {
        self.start_sample + self.frames() as u64
    }
    pub fn mono_samples(&self) -> Zeroizing<Vec<f32>> {
        Zeroizing::new(
            self.samples
                .chunks_exact(self.channels)
                .map(|frame| frame.iter().sum::<f32>() / self.channels as f32)
                .collect(),
        )
    }
}

struct ClockInterval {
    span: TrackTimeSpan,
    read_position: u64,
    read_end: u64,
    output_frames: u64,
    resampler: RecordTimeResampler,
    finished: bool,
}

pub struct RecordSourceReader {
    track: TrackKind,
    decoder: RecordOpusDecoder,
    timeline: Option<RecordTrackTimeline>,
    span_index: usize,
    interval: Option<ClockInterval>,
    // At most one decoder chunk, one resampler chunk and filter context.
    buffered: VecDeque<f32>,
    buffered_start: u64,
    decoded_end: u64,
    finished: bool,
}

impl RecordSourceReader {
    pub fn open(input: &RecordArtifactInput) -> Result<Self, &'static str> {
        if input
            .timeline
            .as_ref()
            .is_some_and(|value| !value.is_valid())
        {
            return Err("SPEECH_CAPTURE_TIME_INVALID");
        }
        Ok(Self {
            track: input.track,
            decoder: RecordOpusDecoder::open(Path::new(&input.input_path))
                .map_err(record_decode_error)?,
            timeline: input.timeline.clone(),
            span_index: 0,
            interval: None,
            buffered: VecDeque::new(),
            buffered_start: 0,
            decoded_end: 0,
            finished: false,
        })
    }

    pub fn track(&self) -> TrackKind {
        self.track
    }
    pub fn channels(&self) -> usize {
        self.decoder.channels()
    }
    pub fn source_position(&self) -> u64 {
        self.decoded_end
    }

    pub fn read_chunk(&mut self) -> Result<Option<SourceAudioChunk>, &'static str> {
        if self.finished {
            return Ok(None);
        }
        if self.timeline.is_none() {
            let Some(chunk) = self.decoder.read_chunk().map_err(record_decode_error)? else {
                self.finished = true;
                return Ok(None);
            };
            self.decoded_end = chunk.start_sample() + chunk.frames() as u64;
            return Ok(Some(SourceAudioChunk {
                track: self.track,
                start_sample: chunk.start_sample(),
                channels: chunk.channels(),
                quality: CaptureTimeQuality::Estimated,
                discontinuity: chunk.start_sample() == 0,
                echo_reference: None,
                aec_applied: false,
                samples: Zeroizing::new(chunk.samples().to_vec()),
            }));
        }
        loop {
            if self.interval.is_none() && !self.begin_interval()? {
                // Metadata cannot silently truncate a valid longer archive.
                if self
                    .decoder
                    .read_chunk()
                    .map_err(record_decode_error)?
                    .is_some()
                    || self.decoded_end
                        != self
                            .timeline
                            .as_ref()
                            .unwrap()
                            .spans
                            .last()
                            .unwrap()
                            .source_end
                {
                    return Err("SPEECH_CAPTURE_TIME_INVALID");
                }
                self.finished = true;
                return Ok(None);
            }
            let mut interval = self.interval.take().ok_or("SPEECH_CAPTURE_TIME_INVALID")?;
            let mut output = Zeroizing::new(Vec::new());
            while output.is_empty() && !interval.finished {
                if interval.read_position < interval.read_end {
                    let end = (interval.read_position + 1_024).min(interval.read_end);
                    self.fill_through(end)?;
                    let channels = self.channels();
                    let start_index =
                        (interval.read_position - self.buffered_start) as usize * channels;
                    let count = (end - interval.read_position) as usize * channels;
                    let input = Zeroizing::new(
                        self.buffered
                            .iter()
                            .skip(start_index)
                            .take(count)
                            .copied()
                            .collect::<Vec<_>>(),
                    );
                    interval.resampler.push(&input, &mut output)?;
                    interval.read_position = end;
                    self.discard_before(
                        end.min(interval.span.source_end)
                            .saturating_sub(RECORD_RESAMPLER_CONTEXT as u64),
                    );
                } else {
                    interval.resampler.finish(&mut output)?;
                    interval.finished = true;
                }
            }
            let first = interval.output_frames;
            interval.output_frames += (output.len() / self.channels()) as u64;
            let result = (!output.is_empty()).then(|| SourceAudioChunk {
                track: self.track,
                start_sample: interval.span.record_start + first,
                channels: self.channels(),
                quality: interval.span.quality,
                discontinuity: first == 0 && interval.span.discontinuity,
                echo_reference: None,
                aec_applied: false,
                samples: output,
            });
            if !interval.finished {
                self.interval = Some(interval);
            }
            if result.is_some() {
                return Ok(result);
            }
        }
    }

    fn begin_interval(&mut self) -> Result<bool, &'static str> {
        let timeline = self
            .timeline
            .as_ref()
            .ok_or("SPEECH_CAPTURE_TIME_INVALID")?;
        let Some(span) = timeline.spans.get(self.span_index).cloned() else {
            return Ok(false);
        };
        let previous = self
            .span_index
            .checked_sub(1)
            .and_then(|index| timeline.spans.get(index));
        let next = timeline.spans.get(self.span_index + 1);
        let connected = |left: &TrackTimeSpan, right: &TrackTimeSpan| {
            !right.discontinuity
                && left.record_end == right.record_start
                && left.quality != CaptureTimeQuality::Gap
                && right.quality != CaptureTimeQuality::Gap
        };
        let before = previous
            .filter(|left| connected(left, &span))
            .map_or(0, |left| {
                (left.source_end - left.source_start).min(RECORD_RESAMPLER_CONTEXT as u64)
            });
        let after = next
            .filter(|right| connected(&span, right))
            .map_or(0, |right| {
                (right.source_end - right.source_start).min(RECORD_RESAMPLER_CONTEXT as u64)
            });
        self.interval = Some(ClockInterval {
            read_position: span.source_start - before,
            read_end: span.source_end + after,
            output_frames: 0,
            resampler: RecordTimeResampler::new(
                span.source_end - span.source_start,
                span.record_end - span.record_start,
                self.channels(),
                before as usize,
            )?,
            span,
            finished: false,
        });
        self.span_index += 1;
        Ok(true)
    }

    fn fill_through(&mut self, end: u64) -> Result<(), &'static str> {
        while self.decoded_end < end {
            let chunk = self
                .decoder
                .read_chunk()
                .map_err(record_decode_error)?
                .ok_or("SPEECH_CORRUPT_MEDIA")?;
            if chunk.start_sample() != self.decoded_end {
                return Err("SPEECH_CORRUPT_MEDIA");
            }
            self.decoded_end += chunk.frames() as u64;
            self.buffered.extend(chunk.samples());
            if self.buffered.len() > (1_024 + 320 + 2 * RECORD_RESAMPLER_CONTEXT) * self.channels()
            {
                return Err("SPEECH_RESOURCE_LIMIT");
            }
        }
        Ok(())
    }

    fn discard_before(&mut self, start: u64) {
        let count = start.saturating_sub(self.buffered_start) as usize * self.channels();
        for _ in 0..count {
            if let Some(mut sample) = self.buffered.pop_front() {
                sample.zeroize();
            }
        }
        self.buffered_start = self.buffered_start.max(start);
    }
}

impl Drop for RecordSourceReader {
    fn drop(&mut self) {
        for sample in &mut self.buffered {
            sample.zeroize();
        }
    }
}

pub fn record_decode_error(error: RecordOpusError) -> &'static str {
    match error {
        RecordOpusError::SourceUnavailable => "SPEECH_SOURCE_UNAVAILABLE",
        RecordOpusError::UnsafeSource => "SPEECH_SOURCE_UNSAFE",
        RecordOpusError::SourceTooLarge | RecordOpusError::DurationExceeded => {
            "SPEECH_MEDIA_LIMIT_EXCEEDED"
        }
        RecordOpusError::CorruptContainer | RecordOpusError::DecodeFailed => "SPEECH_CORRUPT_MEDIA",
        RecordOpusError::UnsupportedStream => "SPEECH_UNSUPPORTED_CODEC",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record_opus::tests::write_signal_fixture;

    #[test]
    fn continuous_drift_spans_keep_context_and_stereo_without_losing_the_tail() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("source.opus");
        write_signal_fixture(&path, 2, 100, 0.25, 0.017);
        let mut reader = RecordSourceReader::open(&RecordArtifactInput {
            input_path: path.to_string_lossy().into(),
            track: TrackKind::System,
            timeline: Some(RecordTrackTimeline {
                spans: vec![
                    TrackTimeSpan {
                        source_start: 0,
                        source_end: 16_000,
                        record_start: 701,
                        record_end: 16_685,
                        quality: CaptureTimeQuality::Clock,
                        discontinuity: false,
                    },
                    TrackTimeSpan {
                        source_start: 16_000,
                        source_end: 32_000,
                        record_start: 16_685,
                        record_end: 32_701,
                        quality: CaptureTimeQuality::Clock,
                        discontinuity: false,
                    },
                ],
            }),
        })
        .unwrap();
        let mut end = 701;
        let mut left_power = 0.0;
        let mut right_power = 0.0;
        while let Some(chunk) = reader.read_chunk().unwrap() {
            assert_eq!(chunk.start_sample, end);
            assert_eq!(chunk.channels, 2);
            assert!(chunk.frames() <= 2_048);
            end = chunk.end_sample();
            for samples in chunk.samples.chunks_exact(2) {
                left_power += samples[0].powi(2);
                right_power += samples[1].powi(2);
            }
        }
        assert_eq!(end, 32_701);
        assert!((left_power / right_power - 4.0).abs() < 0.2);
        assert_eq!(reader.source_position(), 32_000);
    }

    #[test]
    fn supplied_timeline_cannot_truncate_or_invent_source_audio() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("source.opus");
        write_signal_fixture(&path, 1, 10, 0.2, 0.017);
        for end in [3_000, 3_500] {
            let mut reader = RecordSourceReader::open(&RecordArtifactInput {
                input_path: path.to_string_lossy().into(),
                track: TrackKind::Microphone,
                timeline: Some(RecordTrackTimeline {
                    spans: vec![TrackTimeSpan {
                        source_start: 0,
                        source_end: end,
                        record_start: 0,
                        record_end: end,
                        quality: CaptureTimeQuality::Clock,
                        discontinuity: false,
                    }],
                }),
            })
            .unwrap();
            let error = loop {
                match reader.read_chunk() {
                    Ok(Some(_)) => (),
                    Ok(None) => panic!("invalid duration was accepted"),
                    Err(error) => break error,
                }
            };
            assert!(matches!(
                error,
                "SPEECH_CAPTURE_TIME_INVALID" | "SPEECH_CORRUPT_MEDIA"
            ));
        }
    }
}
