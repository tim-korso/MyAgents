//! Shared live/final 10 ms source preprocessing. It owns only bounded DSP
//! state; callers own input admission, replay, jobs and publication.

use crate::protocol::record_timeline::CaptureTimeQuality;
use crate::protocol::{RecordArtifactInput, TrackKind};
use crate::record_aec::{AEC_CAPTURE_DELAY_SAMPLES, AEC_FRAME_SAMPLES, RecordEchoCanceller};
use crate::record_echo_evidence::ResidualEchoEvidence;
use crate::record_source::{RecordSourceReader, SourceAudioChunk};
use std::collections::VecDeque;
use zeroize::Zeroizing;

#[derive(Clone, Copy)]
pub struct SourceFrameRegion {
    pub first: usize,
    pub end: usize,
    pub quality: CaptureTimeQuality,
    pub discontinuity: bool,
}

pub struct SourceFrame {
    pub track: TrackKind,
    pub start_sample: u64,
    pub channels: usize,
    pub samples: Zeroizing<Vec<f32>>,
    pub regions: Vec<SourceFrameRegion>,
}

impl SourceFrame {
    pub fn empty(track: TrackKind, channels: usize, start_sample: u64) -> Self {
        Self {
            track,
            channels,
            start_sample,
            samples: Zeroizing::new(vec![0.0; AEC_FRAME_SAMPLES * channels]),
            regions: Vec::new(),
        }
    }

    pub(crate) fn append(
        &mut self,
        chunk: &SourceAudioChunk,
        consumed: usize,
    ) -> Result<usize, &'static str> {
        let start = chunk.start_sample + consumed as u64;
        let end = self.start_sample + AEC_FRAME_SAMPLES as u64;
        if chunk.channels != self.channels || chunk.track != self.track || start < self.start_sample
        {
            return Err("SPEECH_CAPTURE_TIME_INVALID");
        }
        if start >= end {
            return Ok(0);
        }
        let count = (chunk.end_sample().min(end) - start) as usize;
        let first = (start - self.start_sample) as usize;
        self.samples[first * self.channels..(first + count) * self.channels].copy_from_slice(
            &chunk.samples[consumed * self.channels..(consumed + count) * self.channels],
        );
        self.regions.push(SourceFrameRegion {
            first,
            end: first + count,
            quality: chunk.quality,
            discontinuity: consumed == 0 && chunk.discontinuity,
        });
        Ok(count)
    }

    fn is_reliable_reference(&self) -> bool {
        let mut end = 0;
        for region in &self.regions {
            if region.first != end
                || region.discontinuity
                || region.quality != CaptureTimeQuality::Clock
            {
                return false;
            }
            end = region.end;
        }
        end == AEC_FRAME_SAMPLES
    }

    fn validate(&self) -> Result<(), &'static str> {
        if !(1..=2).contains(&self.channels)
            || self.samples.len() != AEC_FRAME_SAMPLES * self.channels
            || self.regions.len() > AEC_FRAME_SAMPLES
            || !self
                .samples
                .iter()
                .all(|value| value.is_finite() && (-1.0..=1.0).contains(value))
        {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        let mut end = 0;
        for region in &self.regions {
            if region.first < end || region.first >= region.end || region.end > AEC_FRAME_SAMPLES {
                return Err("SPEECH_WORKER_PROTOCOL_ERROR");
            }
            end = region.end;
        }
        Ok(())
    }

    fn bypass(&self, output: &mut VecDeque<SourceAudioChunk>) {
        for region in &self.regions {
            output.push_back(SourceAudioChunk {
                track: self.track,
                start_sample: self.start_sample + region.first as u64,
                channels: self.channels,
                quality: region.quality,
                discontinuity: region.discontinuity,
                echo_reference: None,
                aec_applied: false,
                samples: Zeroizing::new(
                    self.samples[region.first * self.channels..region.end * self.channels].to_vec(),
                ),
            });
        }
    }
}

struct AecEpoch {
    next_input: u64,
    next_output: u64,
    pending_frames: usize,
    discard_frames: usize,
}

pub struct RecordPreprocessor {
    channels: Vec<(TrackKind, usize)>,
    echo: Option<RecordEchoCanceller>,
    epoch: Option<AecEpoch>,
    last_frame_end: Option<u64>,
    residual: ResidualEchoEvidence,
}

impl RecordPreprocessor {
    pub fn new(channels: &[(TrackKind, usize)]) -> Result<Self, &'static str> {
        if channels.is_empty()
            || channels.len() > 2
            || channels.iter().any(|(track, count)| {
                !(1..=2).contains(count)
                    || !matches!(
                        track,
                        TrackKind::Microphone | TrackKind::System | TrackKind::Mixed
                    )
            })
            || (channels.len() == 2
                && (channels[0].0 == channels[1].0
                    || channels.iter().any(|(track, _)| *track == TrackKind::Mixed)))
        {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        let microphone = channels
            .iter()
            .find(|(track, _)| *track == TrackKind::Microphone);
        let system = channels
            .iter()
            .find(|(track, _)| *track == TrackKind::System);
        let echo = match (microphone, system) {
            (Some((_, mic)), Some((_, sys))) => Some(RecordEchoCanceller::new(*mic, *sys)?),
            _ => None,
        };
        Ok(Self {
            channels: channels.to_vec(),
            echo,
            epoch: None,
            last_frame_end: None,
            residual: ResidualEchoEvidence::default(),
        })
    }

    pub fn process(
        &mut self,
        frames: &[SourceFrame],
        output: &mut VecDeque<SourceAudioChunk>,
    ) -> Result<(), &'static str> {
        if frames.len() != self.channels.len() {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        let start = frames[0].start_sample;
        if self.last_frame_end.is_some_and(|end| start < end) {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        for ((track, channels), frame) in self.channels.iter().zip(frames) {
            frame.validate()?;
            if frame.track != *track || frame.channels != *channels || frame.start_sample != start {
                return Err("SPEECH_WORKER_PROTOCOL_ERROR");
            }
        }
        let microphone = frames
            .iter()
            .find(|frame| frame.track == TrackKind::Microphone);
        let system = frames.iter().find(|frame| frame.track == TrackKind::System);
        let apply_aec = self.echo.is_some()
            && microphone.is_some_and(SourceFrame::is_reliable_reference)
            && system.is_some_and(SourceFrame::is_reliable_reference);
        if !apply_aec
            || self
                .epoch
                .as_ref()
                .is_some_and(|epoch| epoch.next_input != start)
        {
            self.flush(output)?;
        }
        for frame in frames {
            if !apply_aec || frame.track != TrackKind::Microphone {
                frame.bypass(output);
            }
        }
        if apply_aec {
            let mic = microphone.unwrap();
            let system = system.unwrap();
            let epoch = self.epoch.get_or_insert(AecEpoch {
                next_input: start,
                next_output: start,
                pending_frames: 0,
                discard_frames: AEC_CAPTURE_DELAY_SAMPLES,
            });
            epoch.next_input += AEC_FRAME_SAMPLES as u64;
            epoch.pending_frames += AEC_FRAME_SAMPLES;
            self.residual.observe(mic, system);
            let mut cleaned = Zeroizing::new(vec![0.0; mic.samples.len()]);
            self.echo.as_mut().unwrap().process(
                &mic.samples,
                Some(&system.samples),
                &mut cleaned,
            )?;
            self.emit_cleaned(&cleaned, mic.channels, output)?;
        }
        self.last_frame_end = Some(start + AEC_FRAME_SAMPLES as u64);
        Ok(())
    }

    /// Flush the delayed microphone tail before bypass/reset/end. Synthetic
    /// filter input is never published and never advances the Record clock.
    pub fn flush(&mut self, output: &mut VecDeque<SourceAudioChunk>) -> Result<(), &'static str> {
        if self.epoch.is_none() {
            self.residual.flush(output);
            return Ok(());
        }
        let mic_channels = self
            .channels
            .iter()
            .find(|(track, _)| *track == TrackKind::Microphone)
            .unwrap()
            .1;
        let sys_channels = self
            .channels
            .iter()
            .find(|(track, _)| *track == TrackKind::System)
            .unwrap()
            .1;
        let microphone = Zeroizing::new(vec![0.0; AEC_FRAME_SAMPLES * mic_channels]);
        let system = Zeroizing::new(vec![0.0; AEC_FRAME_SAMPLES * sys_channels]);
        let mut cleaned = Zeroizing::new(vec![0.0; microphone.len()]);
        self.echo
            .as_mut()
            .unwrap()
            .process(&microphone, Some(&system), &mut cleaned)?;
        self.emit_cleaned(&cleaned, mic_channels, output)?;
        if self
            .epoch
            .as_ref()
            .is_some_and(|epoch| epoch.pending_frames != 0)
        {
            return Err("SPEECH_INFERENCE_FAILED");
        }
        self.epoch = None;
        self.residual.flush(output);
        self.echo.as_mut().unwrap().reset();
        Ok(())
    }

    fn emit_cleaned(
        &mut self,
        samples: &[f32],
        channels: usize,
        output: &mut VecDeque<SourceAudioChunk>,
    ) -> Result<(), &'static str> {
        let epoch = self.epoch.as_mut().ok_or("SPEECH_INFERENCE_FAILED")?;
        let first = epoch.discard_frames.min(AEC_FRAME_SAMPLES);
        epoch.discard_frames -= first;
        let count = (AEC_FRAME_SAMPLES - first).min(epoch.pending_frames);
        if count != 0 {
            self.residual.accept(
                SourceAudioChunk {
                    track: TrackKind::Microphone,
                    start_sample: epoch.next_output,
                    channels,
                    quality: CaptureTimeQuality::Clock,
                    discontinuity: false,
                    echo_reference: None,
                    aec_applied: true,
                    samples: Zeroizing::new(
                        samples[first * channels..(first + count) * channels].to_vec(),
                    ),
                },
                output,
            );
            epoch.next_output += count as u64;
            epoch.pending_frames -= count;
        }
        Ok(())
    }
}

struct SourceFrameReader {
    source: RecordSourceReader,
    next: Option<SourceAudioChunk>,
    consumed: usize,
}

impl SourceFrameReader {
    fn new(input: &RecordArtifactInput) -> Result<Self, &'static str> {
        let mut source = RecordSourceReader::open(input)?;
        let next = source.read_chunk()?;
        Ok(Self {
            source,
            next,
            consumed: 0,
        })
    }

    fn read_frame(&mut self, start: u64) -> Result<SourceFrame, &'static str> {
        let mut frame = SourceFrame::empty(self.source.track(), self.source.channels(), start);
        while let Some(chunk) = &self.next {
            let count = frame.append(chunk, self.consumed)?;
            if count == 0 {
                break;
            }
            self.consumed += count;
            if self.consumed == chunk.frames() {
                self.next = self.source.read_chunk()?;
                self.consumed = 0;
            }
        }
        Ok(frame)
    }
}

/// Reused by both final ASR and diarization: no mixer, temporary full recording
/// or separate model instance per physical source.
pub struct RecordAudioReader {
    sources: Vec<SourceFrameReader>,
    processor: RecordPreprocessor,
    output: VecDeque<SourceAudioChunk>,
    next_sample: u64,
    finished: bool,
}

impl RecordAudioReader {
    pub fn open(inputs: &[RecordArtifactInput]) -> Result<Self, &'static str> {
        let sources = inputs
            .iter()
            .map(SourceFrameReader::new)
            .collect::<Result<Vec<_>, _>>()?;
        let channels = sources
            .iter()
            .map(|reader| (reader.source.track(), reader.source.channels()))
            .collect::<Vec<_>>();
        let next_sample = sources
            .iter()
            .filter_map(|reader| reader.next.as_ref().map(|chunk| chunk.start_sample))
            .min()
            .unwrap_or(0)
            / AEC_FRAME_SAMPLES as u64
            * AEC_FRAME_SAMPLES as u64;
        Ok(Self {
            sources,
            processor: RecordPreprocessor::new(&channels)?,
            output: VecDeque::new(),
            next_sample,
            finished: false,
        })
    }

    pub fn stream_positions(&self) -> Vec<u64> {
        self.sources
            .iter()
            .map(|reader| reader.source.source_position())
            .collect()
    }

    pub fn read_chunk(&mut self) -> Result<Option<SourceAudioChunk>, &'static str> {
        loop {
            if let Some(output) = self.output.pop_front() {
                return Ok(Some(output));
            }
            if self.finished {
                return Ok(None);
            }
            if self.sources.iter().all(|source| source.next.is_none()) {
                self.processor.flush(&mut self.output)?;
                self.finished = true;
                continue;
            }
            // Skip intervals with no source; no PCM is invented for a gap.
            let first = self
                .sources
                .iter()
                .filter_map(|reader| {
                    reader
                        .next
                        .as_ref()
                        .map(|chunk| chunk.start_sample + reader.consumed as u64)
                })
                .min()
                .unwrap();
            self.next_sample = self
                .next_sample
                .max(first / AEC_FRAME_SAMPLES as u64 * AEC_FRAME_SAMPLES as u64);
            let frames = self
                .sources
                .iter_mut()
                .map(|source| source.read_frame(self.next_sample))
                .collect::<Result<Vec<_>, _>>()?;
            self.processor.process(&frames, &mut self.output)?;
            self.next_sample += AEC_FRAME_SAMPLES as u64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::record_timeline::{RecordTrackTimeline, TrackTimeSpan};
    use crate::record_opus::tests::write_signal_fixture;

    fn frame(
        track: TrackKind,
        start: u64,
        quality: CaptureTimeQuality,
        samples: &[f32],
    ) -> SourceFrame {
        SourceFrame {
            track,
            start_sample: start,
            channels: 1,
            samples: Zeroizing::new(samples.to_vec()),
            regions: vec![SourceFrameRegion {
                first: 0,
                end: 160,
                quality,
                discontinuity: false,
            }],
        }
    }

    #[test]
    fn aec_flush_preserves_absolute_markers_and_the_last_short_reply_before_bypass() {
        let mut processor =
            RecordPreprocessor::new(&[(TrackKind::Microphone, 1), (TrackKind::System, 1)]).unwrap();
        let mut output = VecDeque::new();
        let input = (0..3_200)
            .map(|index| {
                // Isolated near-end bursts, including the last 128 delayed frames.
                let envelope = (-((index as f32 - 1_500.0) / 15.0).powi(2)).exp()
                    + (-((index as f32 - 3_150.0) / 15.0).powi(2)).exp();
                (index as f32 * 0.43).sin() * envelope * 0.3
            })
            .collect::<Vec<_>>();
        for (index, chunk) in input.chunks(160).enumerate() {
            processor
                .process(
                    &[
                        frame(
                            TrackKind::Microphone,
                            index as u64 * 160,
                            CaptureTimeQuality::Clock,
                            chunk,
                        ),
                        frame(
                            TrackKind::System,
                            index as u64 * 160,
                            CaptureTimeQuality::Clock,
                            &[0.0; 160],
                        ),
                    ],
                    &mut output,
                )
                .unwrap();
        }
        // Losing reference flushes old speech, then publishes new mic exactly.
        processor
            .process(
                &[
                    frame(
                        TrackKind::Microphone,
                        3_200,
                        CaptureTimeQuality::Clock,
                        &[0.125; 160],
                    ),
                    frame(
                        TrackKind::System,
                        3_200,
                        CaptureTimeQuality::Estimated,
                        &[0.0; 160],
                    ),
                ],
                &mut output,
            )
            .unwrap();
        processor.flush(&mut output).unwrap();
        let mut mic = Vec::new();
        for chunk in output
            .iter()
            .filter(|chunk| chunk.track == TrackKind::Microphone)
        {
            assert_eq!(chunk.start_sample, mic.len() as u64);
            mic.extend_from_slice(&chunk.samples);
        }
        assert_eq!(mic.len(), 3_360);
        assert_eq!(&mic[3_200..], &[0.125; 160]);
        for (first, end) in [(1_400, 1_600), (3_080, 3_200)] {
            let lag = (-12_i32..=12)
                .max_by(|left, right| {
                    let correlation = |lag: i32| {
                        (first..end)
                            .map(|index| {
                                let output_index = index as i32 + lag;
                                if (0..3_200).contains(&output_index) {
                                    input[index] * mic[output_index as usize]
                                } else {
                                    0.0
                                }
                            })
                            .sum::<f32>()
                    };
                    correlation(*left).total_cmp(&correlation(*right))
                })
                .unwrap();
            assert!(lag.abs() <= 1, "uncompensated marker lag: {lag}");
            assert!(
                mic[first..end]
                    .iter()
                    .map(|sample| sample * sample)
                    .sum::<f32>()
                    > 0.1
            );
        }
    }

    #[test]
    fn legacy_reference_is_never_promoted_to_exact_clock_or_mixed_with_microphone() {
        let mut processor =
            RecordPreprocessor::new(&[(TrackKind::Microphone, 1), (TrackKind::System, 1)]).unwrap();
        let mut output = VecDeque::new();
        processor
            .process(
                &[
                    frame(
                        TrackKind::Microphone,
                        160,
                        CaptureTimeQuality::Estimated,
                        &[0.2; 160],
                    ),
                    frame(
                        TrackKind::System,
                        160,
                        CaptureTimeQuality::Estimated,
                        &[-0.3; 160],
                    ),
                ],
                &mut output,
            )
            .unwrap();
        assert_eq!(output.len(), 2);
        assert_eq!(&output[0].samples[..], &[0.2; 160]);
        assert_eq!(&output[1].samples[..], &[-0.3; 160]);
        assert!(output.iter().all(|chunk| !chunk.aec_applied));
    }

    #[test]
    fn real_opus_sources_keep_start_offsets_gaps_and_discontinuities_inside_a_frame() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("source.opus");
        write_signal_fixture(&path, 2, 10, 0.2, 0.017);
        let input = RecordArtifactInput {
            input_path: path.to_string_lossy().into(),
            track: TrackKind::System,
            timeline: Some(RecordTrackTimeline {
                spans: vec![
                    TrackTimeSpan {
                        source_start: 0,
                        source_end: 1_601,
                        record_start: 77,
                        record_end: 1_678,
                        quality: CaptureTimeQuality::Clock,
                        discontinuity: false,
                    },
                    TrackTimeSpan {
                        source_start: 1_601,
                        source_end: 1_650,
                        record_start: 1_678,
                        record_end: 1_727,
                        quality: CaptureTimeQuality::Gap,
                        discontinuity: true,
                    },
                    TrackTimeSpan {
                        source_start: 1_650,
                        source_end: 3_200,
                        record_start: 1_800,
                        record_end: 3_350,
                        quality: CaptureTimeQuality::Clock,
                        discontinuity: true,
                    },
                ],
            }),
        };
        let mut reader = RecordAudioReader::open(&[input]).unwrap();
        let mut frames = 0;
        let mut boundaries = Vec::new();
        while let Some(chunk) = reader.read_chunk().unwrap() {
            assert_eq!(chunk.track, TrackKind::System);
            assert_eq!(chunk.channels, 2);
            if chunk.quality == CaptureTimeQuality::Gap {
                assert_eq!((chunk.start_sample, chunk.end_sample()), (1_678, 1_727));
                continue;
            }
            assert!(chunk.end_sample() <= 1_678 || chunk.start_sample >= 1_800);
            if chunk.discontinuity {
                boundaries.push(chunk.start_sample);
            }
            if frames == 0 {
                assert_eq!(chunk.start_sample, 77);
            }
            frames += chunk.frames();
        }
        assert_eq!(frames, 3_151);
        assert_eq!(boundaries, [1_800]);
        assert_eq!(reader.stream_positions(), [3_200]);
    }
}
