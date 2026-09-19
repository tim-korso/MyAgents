//! Live transport adaptation for the same source-clock resampler and AEC used
//! by final processing. Accepted PCM is bounded independently of peer arrival.

use crate::protocol::record_timeline::{CaptureTimeQuality, TrackTimeSpan};
use crate::protocol::{MAX_PCM_SAMPLES_PER_FRAME, PcmFrame, PcmStreamStart, TrackKind};
use crate::record_aec::AEC_FRAME_SAMPLES;
use crate::record_preprocessing::{RecordPreprocessor, SourceFrame};
use crate::record_resampler::{RECORD_RESAMPLER_CONTEXT, RecordTimeResampler};
use crate::record_source::SourceAudioChunk;
use std::collections::VecDeque;
use zeroize::{Zeroize, Zeroizing};

struct PendingInterval {
    span: TrackTimeSpan,
    resampler: RecordTimeResampler,
    emitted: u64,
}

struct LiveSource {
    track: TrackKind,
    channels: usize,
    pending: Option<PendingInterval>,
    history: Zeroizing<Vec<f32>>,
    chunks: VecDeque<SourceAudioChunk>,
    consumed: usize,
    through: Option<u64>,
    latest_input_start: u64,
}

impl LiveSource {
    fn emit(&mut self, interval: &mut PendingInterval, samples: Zeroizing<Vec<f32>>) {
        if samples.is_empty() {
            return;
        }
        let start = interval.span.record_start + interval.emitted;
        let first = interval.emitted == 0;
        interval.emitted += (samples.len() / self.channels) as u64;
        self.through = Some(interval.span.record_start + interval.emitted);
        self.chunks.push_back(SourceAudioChunk {
            track: self.track,
            channels: self.channels,
            start_sample: start,
            quality: interval.span.quality,
            discontinuity: first && interval.span.discontinuity,
            echo_reference: None,
            aec_applied: false,
            samples,
        });
    }

    fn accept(&mut self, frame: &PcmFrame) -> Result<(), &'static str> {
        if usize::from(frame.channels) != self.channels
            || frame.frames() == 0
            || frame.frames() > MAX_PCM_SAMPLES_PER_FRAME
        {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        let mut span = frame.time_span.clone().unwrap_or(TrackTimeSpan {
            source_start: frame.start_sample,
            source_end: frame.start_sample + frame.frames() as u64,
            record_start: frame.start_sample,
            record_end: frame.start_sample + frame.frames() as u64,
            quality: CaptureTimeQuality::Estimated,
            discontinuity: false,
        });
        if span.source_start != frame.start_sample
            || span.source_end != frame.start_sample + frame.frames() as u64
            || span.record_start >= span.record_end
        {
            return Err("SPEECH_CAPTURE_TIME_INVALID");
        }
        let input = Zeroizing::new(
            frame
                .samples
                .iter()
                .map(|sample| f32::from(*sample) / 32_768.0)
                .collect::<Vec<_>>(),
        );
        let mut connected = false;
        if let Some(mut previous) = self.pending.take() {
            // Capture owns source discontinuities. A growing clock map may
            // refine either side of an already admitted transport boundary;
            // that does not interrupt continuous PCM. Join at our committed
            // frontier and apply the new endpoint only to unprocessed audio.
            let source_continuous = !span.discontinuity
                && previous.span.source_end == span.source_start
                && previous.span.quality != CaptureTimeQuality::Gap
                && span.quality != CaptureTimeQuality::Gap;
            if (source_continuous && span.record_start != previous.span.record_end)
                || span.record_start < previous.span.record_end
            {
                span.record_start = previous.span.record_end;
                if span.record_end <= span.record_start {
                    span.record_end = span.record_start + frame.frames() as u64;
                }
                span.quality = CaptureTimeQuality::Estimated;
                span.discontinuity |= !source_continuous;
            }
            connected = !span.discontinuity
                && previous.span.record_end == span.record_start
                && previous.span.source_end == span.source_start
                && previous.span.quality != CaptureTimeQuality::Gap
                && span.quality != CaptureTimeQuality::Gap;
            let mut output = Zeroizing::new(Vec::new());
            if connected {
                previous.resampler.push(
                    &input[..input.len().min(RECORD_RESAMPLER_CONTEXT * self.channels)],
                    &mut output,
                )?;
            }
            previous.resampler.finish(&mut output)?;
            self.emit(&mut previous, output);
        }
        self.latest_input_start = span.record_start;
        let before = if connected {
            self.history.len() / self.channels
        } else {
            0
        };
        let mut interval = PendingInterval {
            resampler: RecordTimeResampler::new(
                span.source_end - span.source_start,
                span.record_end - span.record_start,
                self.channels,
                before,
            )?,
            span,
            emitted: 0,
        };
        let mut output = Zeroizing::new(Vec::new());
        if before > 0 {
            interval.resampler.push(&self.history, &mut output)?;
        }
        for chunk in input.chunks(1_024 * self.channels) {
            interval.resampler.push(chunk, &mut output)?;
        }
        self.emit(&mut interval, output);
        if !connected {
            self.history.zeroize();
        }
        self.history.extend_from_slice(&input);
        let discard = self
            .history
            .len()
            .saturating_sub(RECORD_RESAMPLER_CONTEXT * self.channels);
        self.history[..discard].zeroize();
        self.history.drain(..discard);
        self.pending = Some(interval);
        Ok(())
    }

    fn flush(&mut self) -> Result<(), &'static str> {
        if let Some(mut interval) = self.pending.take() {
            let mut output = Zeroizing::new(Vec::new());
            interval.resampler.finish(&mut output)?;
            self.emit(&mut interval, output);
        }
        self.history.zeroize();
        Ok(())
    }

    fn first_sample(&self) -> Option<u64> {
        self.chunks
            .front()
            .map(|chunk| chunk.start_sample + self.consumed as u64)
    }

    fn read_frame(&mut self, start: u64) -> Result<SourceFrame, &'static str> {
        let mut frame = SourceFrame::empty(self.track, self.channels, start);
        while let Some(chunk) = self.chunks.front() {
            let count = frame.append(chunk, self.consumed)?;
            if count == 0 {
                break;
            }
            self.consumed += count;
            if self.consumed == chunk.frames() {
                self.chunks.pop_front();
                self.consumed = 0;
            }
        }
        Ok(frame)
    }

    // A late source still owns its speech. Publish the elapsed part without
    // AEC instead of deleting it to satisfy a common processing watermark.
    fn drain_late(&mut self, before: u64, output: &mut VecDeque<SourceAudioChunk>) {
        while let Some(chunk) = self.chunks.front() {
            let start = chunk.start_sample + self.consumed as u64;
            if start >= before {
                break;
            }
            let count = ((chunk.end_sample().min(before) - start) as usize).min(AEC_FRAME_SAMPLES);
            output.push_back(SourceAudioChunk {
                track: self.track,
                channels: self.channels,
                start_sample: start,
                quality: chunk.quality,
                discontinuity: self.consumed == 0 && chunk.discontinuity,
                echo_reference: None,
                aec_applied: false,
                samples: Zeroizing::new(
                    chunk.samples
                        [self.consumed * self.channels..(self.consumed + count) * self.channels]
                        .to_vec(),
                ),
            });
            self.consumed += count;
            if self.consumed == chunk.frames() {
                self.chunks.pop_front();
                self.consumed = 0;
            }
        }
    }
}

pub struct LiveRecordAudio {
    sources: Vec<LiveSource>,
    processor: RecordPreprocessor,
    next_sample: Option<u64>,
}

impl LiveRecordAudio {
    pub fn new(streams: &[PcmStreamStart]) -> Result<Self, &'static str> {
        let channels = streams
            .iter()
            .map(|stream| (stream.track, usize::from(stream.channels)))
            .collect::<Vec<_>>();
        Ok(Self {
            processor: RecordPreprocessor::new(&channels)?,
            next_sample: None,
            sources: channels
                .into_iter()
                .map(|(track, channels)| LiveSource {
                    track,
                    channels,
                    pending: None,
                    history: Zeroizing::new(Vec::new()),
                    chunks: VecDeque::new(),
                    consumed: 0,
                    through: None,
                    latest_input_start: 0,
                })
                .collect(),
        })
    }

    /// Caller acknowledges admitted input even if peer reference has not yet
    /// arrived, then processes returned chunks before its settlement heartbeat.
    pub fn accept(
        &mut self,
        frame: &PcmFrame,
        output: &mut VecDeque<SourceAudioChunk>,
    ) -> Result<(), &'static str> {
        let source = self
            .sources
            .iter_mut()
            .find(|source| source.track == frame.track)
            .ok_or("SPEECH_WORKER_PROTOCOL_ERROR")?;
        source.accept(frame)?;
        if source
            .chunks
            .iter()
            .map(SourceAudioChunk::frames)
            .sum::<usize>()
            > 4 * MAX_PCM_SAMPLES_PER_FRAME
        {
            return Err("SPEECH_RESOURCE_LIMIT");
        }
        self.pump(false, output)
    }

    pub fn flush(&mut self, output: &mut VecDeque<SourceAudioChunk>) -> Result<(), &'static str> {
        for source in &mut self.sources {
            source.flush()?;
        }
        self.pump(true, output)?;
        self.processor.flush(output)?;
        Ok(())
    }

    fn pump(
        &mut self,
        force: bool,
        output: &mut VecDeque<SourceAudioChunk>,
    ) -> Result<(), &'static str> {
        if let Some(next) = self.next_sample {
            for source in &mut self.sources {
                source.drain_late(next, output);
            }
        }
        loop {
            let Some(first) = self
                .sources
                .iter()
                .filter_map(LiveSource::first_sample)
                .min()
            else {
                return Ok(());
            };
            let first_frame = first / AEC_FRAME_SAMPLES as u64 * AEC_FRAME_SAMPLES as u64;
            let start = self.next_sample.unwrap_or(first_frame).max(first_frame);
            let end = start + AEC_FRAME_SAMPLES as u64;
            // The manager sends sources round-robin, awaiting an ACK and
            // heartbeat for each. Keep the current transport interval for its
            // peer; a subsequent interval proves we must bypass missing peer
            // data rather than grow a queue or block all live transcription.
            let bypass_through = self
                .sources
                .iter()
                .map(|source| source.latest_input_start)
                .max()
                .unwrap_or(0);
            if !force
                && end > bypass_through
                && !self
                    .sources
                    .iter()
                    .all(|source| source.through.is_some_and(|through| through >= end))
            {
                return Ok(());
            }
            let frames = self
                .sources
                .iter_mut()
                .map(|source| source.read_frame(start))
                .collect::<Result<Vec<_>, _>>()?;
            self.processor.process(&frames, output)?;
            self.next_sample = Some(end);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_refinements_do_not_break_continuous_source_audio() {
        for channels in [1, 2] {
            for direction in [-1_i64, 1] {
                let mut stream = streams()[0].clone();
                stream.channels = channels;
                let mut live = LiveRecordAudio::new(&[stream]).unwrap();
                let mut output = VecDeque::new();
                for index in 0..4 {
                    let mut frame = pcm(
                        TrackKind::Microphone,
                        index * 16_000,
                        16_000,
                        4_000,
                        CaptureTimeQuality::Clock,
                    );
                    frame.channels = channels;
                    frame.samples.resize(16_000 * usize::from(channels), 4_000);
                    let span = frame.time_span.as_mut().unwrap();
                    let adjustment = direction * (index % 2) as i64;
                    span.record_start = (100 + span.source_start)
                        .checked_add_signed(adjustment)
                        .unwrap();
                    span.record_end = (100 + span.source_end)
                        .checked_add_signed(adjustment)
                        .unwrap();
                    live.accept(&frame, &mut output).unwrap();
                }
                live.flush(&mut output).unwrap();
                let mut end = 100;
                for chunk in output {
                    assert_eq!(chunk.start_sample, end, "clock refinement fabricated a gap");
                    assert!(
                        !chunk.discontinuity,
                        "clock refinement fabricated an endpoint"
                    );
                    assert_eq!(chunk.channels, usize::from(channels));
                    end = chunk.end_sample();
                }
                assert_eq!(end, (64_100_u64).checked_add_signed(direction).unwrap());
            }
        }
    }

    #[test]
    fn physical_boundaries_survive_clock_reconciliation() {
        for (discontinuity, quality, source_hole) in [
            (true, CaptureTimeQuality::Clock, 0),
            (false, CaptureTimeQuality::Gap, 0),
            (false, CaptureTimeQuality::Clock, 160),
        ] {
            let mut live = LiveRecordAudio::new(&streams()[..1]).unwrap();
            let mut output = VecDeque::new();
            live.accept(
                &pcm(
                    TrackKind::Microphone,
                    0,
                    1_600,
                    4_000,
                    CaptureTimeQuality::Clock,
                ),
                &mut output,
            )
            .unwrap();
            let mut next = pcm(
                TrackKind::Microphone,
                1_600 + source_hole,
                1_600,
                4_000,
                quality,
            );
            let span = next.time_span.as_mut().unwrap();
            span.record_start = 1_760;
            span.record_end = 3_360;
            span.discontinuity = discontinuity;
            live.accept(&next, &mut output).unwrap();
            live.flush(&mut output).unwrap();
            let boundary = output
                .iter()
                .find(|chunk| chunk.start_sample >= 1_760)
                .unwrap();
            assert_eq!(boundary.start_sample, 1_760);
            assert_eq!(boundary.discontinuity, discontinuity);
            assert_eq!(boundary.quality, quality);
            assert!(
                !output
                    .iter()
                    .any(|chunk| chunk.start_sample >= 1_600 && chunk.start_sample < 1_760)
            );
        }
    }
    use crate::protocol::PROTOCOL_VERSION;

    fn streams() -> Vec<PcmStreamStart> {
        [TrackKind::Microphone, TrackKind::System]
            .into_iter()
            .map(|track| PcmStreamStart {
                track,
                channels: 1,
                first_sequence: 0,
                first_sample: 0,
                publish_from_record_sample: 0,
            })
            .collect()
    }

    fn pcm(
        track: TrackKind,
        start: u64,
        count: usize,
        value: i16,
        quality: CaptureTimeQuality,
    ) -> PcmFrame {
        PcmFrame {
            protocol_version: PROTOCOL_VERSION,
            worker_generation: 1,
            track,
            sequence: start / count as u64,
            start_sample: start,
            channels: 1,
            samples: vec![value; count],
            time_span: Some(TrackTimeSpan {
                source_start: start,
                source_end: start + count as u64,
                record_start: start,
                record_end: start + count as u64,
                quality,
                discontinuity: false,
            }),
        }
    }

    #[test]
    fn round_robin_waits_for_reference_without_blocking_ack_or_creating_duplicate_samples() {
        let mut live = LiveRecordAudio::new(&streams()).unwrap();
        let mut output = VecDeque::new();
        for start in [0, 1_600, 3_200] {
            live.accept(
                &pcm(
                    TrackKind::Microphone,
                    start,
                    1_600,
                    0,
                    CaptureTimeQuality::Clock,
                ),
                &mut output,
            )
            .unwrap();
            if start == 0 {
                assert!(output.is_empty());
            }
            live.accept(
                &pcm(
                    TrackKind::System,
                    start,
                    1_600,
                    1_000,
                    CaptureTimeQuality::Clock,
                ),
                &mut output,
            )
            .unwrap();
        }
        live.flush(&mut output).unwrap();
        for track in [TrackKind::Microphone, TrackKind::System] {
            let mut end = 0;
            for chunk in output.iter().filter(|chunk| chunk.track == track) {
                assert_eq!(chunk.start_sample, end);
                end = chunk.end_sample();
                assert_eq!(chunk.aec_applied, track == TrackKind::Microphone);
            }
            assert_eq!(end, 4_800);
        }
    }

    #[test]
    fn absent_reference_stays_bounded_and_a_late_source_keeps_every_sample() {
        let mut live = LiveRecordAudio::new(&streams()).unwrap();
        let mut output = VecDeque::new();
        for start in (0..32_000).step_by(1_600) {
            live.accept(
                &pcm(
                    TrackKind::Microphone,
                    start,
                    1_600,
                    2_000,
                    CaptureTimeQuality::Estimated,
                ),
                &mut output,
            )
            .unwrap();
            assert!(
                live.sources[0]
                    .chunks
                    .iter()
                    .map(SourceAudioChunk::frames)
                    .sum::<usize>()
                    <= 1_600
            );
        }
        for start in (0..32_000).step_by(1_600) {
            live.accept(
                &pcm(
                    TrackKind::System,
                    start,
                    1_600,
                    -3_000,
                    CaptureTimeQuality::Estimated,
                ),
                &mut output,
            )
            .unwrap();
        }
        live.flush(&mut output).unwrap();
        for (track, expected) in [
            (TrackKind::Microphone, 2_000.0 / 32_768.0),
            (TrackKind::System, -3_000.0 / 32_768.0),
        ] {
            let mut end = 0;
            for chunk in output.iter().filter(|chunk| chunk.track == track) {
                assert_eq!(chunk.start_sample, end);
                end = chunk.end_sample();
                assert!(chunk.samples.iter().all(|sample| *sample == expected));
                assert!(!chunk.aec_applied);
            }
            assert_eq!(end, 32_000);
        }
    }

    #[test]
    fn drift_correction_keeps_absolute_markers_across_transport_boundaries_and_pause() {
        let mut live = LiveRecordAudio::new(&streams()[..1]).unwrap();
        let mut output = VecDeque::new();
        for index in 0..4 {
            let mut frame = pcm(
                TrackKind::Microphone,
                index * 4_000,
                4_000,
                0,
                CaptureTimeQuality::Clock,
            );
            frame.samples = (0..4_000)
                .map(|sample| {
                    let position = sample as f32 + index as f32 * 4_000.0;
                    ((-((position - 8_000.0) / 12.0).powi(2)).exp() * 12_000.0) as i16
                })
                .collect();
            let span = frame.time_span.as_mut().unwrap();
            span.record_start = 77 + index * 4_004;
            span.record_end = span.record_start + 4_004;
            live.accept(&frame, &mut output).unwrap();
        }
        live.flush(&mut output).unwrap();
        let mut samples = Vec::new();
        for chunk in &output {
            assert_eq!(chunk.start_sample, 77 + samples.len() as u64);
            samples.extend_from_slice(&chunk.samples);
        }
        assert_eq!(samples.len(), 16_016);
        let marker = samples
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.total_cmp(right))
            .unwrap()
            .0;
        assert!(marker.abs_diff(8_008) <= 2, "marker moved to {marker}");
        output.clear();
        let mut resumed = pcm(
            TrackKind::Microphone,
            16_000,
            81,
            5_000,
            CaptureTimeQuality::Clock,
        );
        let span = resumed.time_span.as_mut().unwrap();
        span.record_start = 16_093;
        span.record_end = 16_174;
        span.discontinuity = true;
        live.accept(&resumed, &mut output).unwrap();
        live.flush(&mut output).unwrap();
        assert_eq!(output.front().unwrap().start_sample, 16_093);
        assert!(output.front().unwrap().discontinuity);
        assert_eq!(
            output.iter().map(SourceAudioChunk::frames).sum::<usize>(),
            81
        );
        assert!(
            output
                .iter()
                .flat_map(|chunk| chunk.samples.iter())
                .all(|sample| *sample == 5_000.0 / 32_768.0)
        );
    }
}
