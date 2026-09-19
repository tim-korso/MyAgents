//! Conservative residual-echo evidence after AEC. This does not estimate a
//! device clock, subtract waveforms or silence a source because render is active.
//! It only identifies a waveform copy at a bounded acoustic propagation delay.
use crate::protocol::record_timeline::CaptureTimeQuality;
use crate::record_preprocessing::SourceFrame;
use crate::record_source::{RecordEchoReference, SourceAudioChunk};
use std::collections::VecDeque;
use zeroize::{Zeroize, Zeroizing};

const BLOCK: usize = 1_280; // 80 ms additional lookahead, within the live budget.
const MAX_DELAY: usize = 8_000; // 500 ms acoustic path; never a clock correction.
const HISTORY: usize = MAX_DELAY + BLOCK * 3;
const DECIMATION: usize = 8;
const MIN_REFERENCE_POWER: f64 = 0.000_025; // Active reference, not silence.
const MIN_RAW_COHERENCE: f64 = 0.9999;
const MIN_RESIDUAL_COHERENCE: f64 = 0.995;

#[derive(Default)]
struct History {
    start: u64,
    samples: VecDeque<f32>,
}
impl History {
    fn clear(&mut self) {
        self.samples.iter_mut().for_each(Zeroize::zeroize);
        self.samples.clear();
    }
    fn append(&mut self, frame: &SourceFrame) {
        if self.start + self.samples.len() as u64 != frame.start_sample {
            self.clear();
            self.start = frame.start_sample;
        }
        self.samples.extend(
            frame
                .samples
                .chunks_exact(frame.channels)
                .map(|s| s.iter().sum::<f32>() / frame.channels as f32),
        );
        while self.samples.len() > HISTORY {
            if let Some(sample) = self.samples.front_mut() {
                sample.zeroize();
            }
            self.samples.pop_front();
            self.start += 1;
        }
    }
    fn get(&self, start: u64, count: usize) -> Option<Zeroizing<Vec<f32>>> {
        let offset = usize::try_from(start.checked_sub(self.start)?).ok()?;
        if offset.checked_add(count)? > self.samples.len() {
            return None;
        }
        Some(Zeroizing::new(
            self.samples
                .iter()
                .skip(offset)
                .take(count)
                .copied()
                .collect(),
        ))
    }
}
impl Drop for History {
    fn drop(&mut self) {
        self.clear();
    }
}

#[derive(Default)]
pub struct ResidualEchoEvidence {
    microphone: History,
    render: History,
    pending: VecDeque<SourceAudioChunk>,
    pending_frames: usize,
}
impl ResidualEchoEvidence {
    pub fn observe(&mut self, microphone: &SourceFrame, system: &SourceFrame) {
        self.microphone.append(microphone);
        self.render.append(system);
    }
    pub fn accept(&mut self, chunk: SourceAudioChunk, output: &mut VecDeque<SourceAudioChunk>) {
        if chunk.track != crate::protocol::TrackKind::Microphone {
            output.push_back(chunk);
            return;
        }
        if !chunk.aec_applied || chunk.quality != CaptureTimeQuality::Clock || chunk.discontinuity {
            self.flush(output);
            output.push_back(chunk);
            return;
        }
        if self.pending.back().is_some_and(|last| {
            last.end_sample() != chunk.start_sample || last.channels != chunk.channels
        }) {
            self.flush(output);
        }
        self.pending_frames += chunk.frames();
        self.pending.push_back(chunk);
        while self.pending_frames >= BLOCK {
            self.emit(BLOCK, true, output);
        }
    }
    pub fn flush(&mut self, output: &mut VecDeque<SourceAudioChunk>) {
        // An incomplete final block has insufficient independent evidence.
        if self.pending_frames > 0 {
            self.emit(self.pending_frames, false, output);
        }
        self.microphone.clear();
        self.render.clear();
    }
    fn emit(&mut self, count: usize, classify: bool, output: &mut VecDeque<SourceAudioChunk>) {
        let first = self.pending.front().expect("nonempty bounded echo block");
        let start = first.start_sample;
        let channels = first.channels;
        let mut samples = Zeroizing::new(Vec::with_capacity(count * channels));
        while samples.len() < count * channels {
            let mut chunk = self.pending.pop_front().expect("accounted echo frames");
            let take = (count - samples.len() / channels).min(chunk.frames());
            samples.extend_from_slice(&chunk.samples[..take * channels]);
            if take < chunk.frames() {
                let remaining = chunk.samples.len() - take * channels;
                chunk.samples.copy_within(take * channels.., 0);
                chunk.samples[remaining..].zeroize();
                chunk.samples.truncate(remaining);
                chunk.start_sample += take as u64;
                self.pending.push_front(chunk);
            }
        }
        self.pending_frames -= count;
        let reference = if classify {
            self.classify(start, &samples, channels)
        } else {
            None
        };
        output.push_back(SourceAudioChunk {
            track: crate::protocol::TrackKind::Microphone,
            start_sample: start,
            channels,
            quality: CaptureTimeQuality::Clock,
            discontinuity: false,
            aec_applied: true,
            echo_reference: reference,
            samples,
        });
    }
    fn classify(
        &self,
        start: u64,
        samples: &[f32],
        channels: usize,
    ) -> Option<RecordEchoReference> {
        let raw = self.microphone.get(start, BLOCK)?;
        let cleaned = Zeroizing::new(
            samples
                .chunks_exact(channels)
                .map(|s| s.iter().sum::<f32>() / channels as f32)
                .collect::<Vec<_>>(),
        );
        let earliest = start
            .saturating_sub(MAX_DELAY as u64)
            .max(self.render.start);
        let render_count = usize::try_from(start.checked_sub(earliest)?)
            .ok()?
            .checked_add(BLOCK)?;
        let render = self.render.get(earliest, render_count)?;
        let maximum = render.len().checked_sub(BLOCK)?;
        let mut best = None;
        // Coarse search only proposes a delay. Full-band, both raw and cleaned
        // waveforms must independently satisfy the conservative copy test.
        for offset in 0..=maximum {
            let candidate = &render[offset..offset + BLOCK];
            let Some(score) = coherence(&raw, candidate, DECIMATION) else {
                continue;
            };
            if best.is_none_or(|(_, old)| score > old) {
                best = Some((offset, score));
            }
        }
        let (coarse, _) = best?;
        for offset in coarse.saturating_sub(DECIMATION)..=(coarse + DECIMATION).min(maximum) {
            let candidate = &render[offset..offset + BLOCK];
            if power(candidate) < MIN_REFERENCE_POWER
                || coherence(&raw, candidate, 1).unwrap_or(0.0) < MIN_RAW_COHERENCE
                || coherence(&cleaned, candidate, 1).unwrap_or(0.0) < MIN_RESIDUAL_COHERENCE
            {
                continue;
            }
            // Every 10 ms subframe must agree. A near-end onset/short response
            // anywhere in the block prevents deleting the whole observation.
            if !(0..channels).all(|channel| {
                let plane = Zeroizing::new(
                    samples
                        .chunks_exact(channels)
                        .map(|s| s[channel])
                        .collect::<Vec<_>>(),
                );
                plane
                    .chunks_exact(160)
                    .zip(candidate.chunks_exact(160))
                    .all(|(mic, reference)| {
                        coherence(mic, reference, 1).is_some_and(|c| c >= MIN_RESIDUAL_COHERENCE)
                    })
            }) {
                continue;
            }
            if raw
                .chunks_exact(160)
                .zip(cleaned.chunks_exact(160))
                .zip(candidate.chunks_exact(160))
                .all(|((mic, clean), reference)| {
                    coherence(mic, reference, 1).is_some_and(|c| c >= MIN_RAW_COHERENCE)
                        && coherence(clean, reference, 1)
                            .is_some_and(|c| c >= MIN_RESIDUAL_COHERENCE)
                })
            {
                let reference_start = earliest + offset as u64;
                return Some(RecordEchoReference {
                    start_sample: reference_start,
                    end_sample: reference_start + BLOCK as u64,
                });
            }
        }
        None
    }
}
fn power(samples: &[f32]) -> f64 {
    samples.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>() / samples.len() as f64
}
fn coherence(left: &[f32], right: &[f32], step: usize) -> Option<f64> {
    let mut cross = 0.0;
    let mut a = 0.0;
    let mut b = 0.0;
    for (left, right) in left.iter().zip(right).step_by(step) {
        let left = f64::from(*left);
        let right = f64::from(*right);
        cross += left * right;
        a += left * left;
        b += right * right;
    }
    if a <= 1e-12 || b <= 1e-12 {
        return None;
    }
    Some((cross * cross / (a * b)).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::TrackKind;
    use crate::record_preprocessing::SourceFrameRegion;
    fn signal(index: usize) -> f32 {
        let x = (index as u32)
            .wrapping_mul(747_796_405)
            .wrapping_add(2_891_336_453);
        let x = ((x >> ((x >> 28) + 4)) ^ x).wrapping_mul(277_803_737);
        (((x >> 22) ^ x) as f64 / u32::MAX as f64 * 0.4 - 0.2) as f32
    }
    fn fixture(channels: usize, near: bool) -> ResidualEchoEvidence {
        let mut evidence = ResidualEchoEvidence::default();
        for start in (0..3200).step_by(160) {
            let frame = |track, samples| SourceFrame {
                track,
                start_sample: start as u64,
                channels: if track == TrackKind::System {
                    1
                } else {
                    channels
                },
                samples: Zeroizing::new(samples),
                regions: vec![SourceFrameRegion {
                    first: 0,
                    end: 160,
                    quality: CaptureTimeQuality::Clock,
                    discontinuity: false,
                }],
            };
            let system = frame(
                TrackKind::System,
                (start..start + 160).map(signal).collect(),
            );
            let microphone = frame(
                TrackKind::Microphone,
                (start..start + 160)
                    .flat_map(|i| {
                        (0..channels).map(move |channel| {
                            let echo = if i >= 43 { signal(i - 43) * 0.5 } else { 0.0 };
                            echo + if near && (1800..1820).contains(&i) {
                                if channel == 0 { 0.05 } else { -0.05 }
                            } else {
                                0.0
                            }
                        })
                    })
                    .collect(),
            );
            evidence.observe(&microphone, &system);
        }
        evidence
    }
    fn cleaned(channels: usize, near: bool, count: usize) -> SourceAudioChunk {
        SourceAudioChunk {
            track: TrackKind::Microphone,
            start_sample: 1600,
            channels,
            quality: CaptureTimeQuality::Clock,
            discontinuity: false,
            aec_applied: true,
            echo_reference: None,
            samples: Zeroizing::new(
                (1600..1600 + count)
                    .flat_map(|i| {
                        (0..channels).map(move |channel| {
                            signal(i - 43) * 0.02
                                + if near && (1800..1820).contains(&i) {
                                    if channel == 0 { 0.05 } else { -0.05 }
                                } else {
                                    0.0
                                }
                        })
                    })
                    .collect(),
            ),
        }
    }
    #[test]
    fn delayed_waveform_copy_is_related_to_the_original_render_time() {
        let mut evidence = fixture(1, false);
        let mut output = VecDeque::new();
        let chunk = cleaned(1, false, BLOCK);
        let original = chunk.samples.to_vec();
        evidence.accept(chunk, &mut output);
        assert_eq!(output.len(), 1);
        let observed = output.pop_front().unwrap();
        assert_eq!(
            observed.echo_reference,
            Some(RecordEchoReference {
                start_sample: 1557,
                end_sample: 1557 + BLOCK as u64
            })
        );
        assert_eq!(*observed.samples, original); // Metadata, never waveform subtraction.
        assert_eq!(observed.start_sample, 1600);
    }
    #[test]
    fn every_channel_protects_even_a_twenty_sample_near_end_onset() {
        for channels in [1, 2] {
            let mut evidence = fixture(channels, true);
            let mut output = VecDeque::new();
            evidence.accept(cleaned(channels, true, BLOCK), &mut output);
            assert!(output.iter().all(|c| c.echo_reference.is_none()));
        }
    }
    #[test]
    fn unrelated_near_end_missing_reference_and_incomplete_tail_are_preserved() {
        for scenario in 0..3 {
            let mut evidence = if scenario == 1 {
                ResidualEchoEvidence::default()
            } else {
                fixture(1, false)
            };
            let mut chunk = cleaned(1, false, if scenario == 2 { BLOCK - 1 } else { BLOCK });
            if scenario == 0 {
                for (i, sample) in chunk.samples.iter_mut().enumerate() {
                    *sample = signal(i + 99_000);
                }
            }
            let original = chunk.samples.to_vec();
            let mut output = VecDeque::new();
            evidence.accept(chunk, &mut output);
            evidence.flush(&mut output);
            assert_eq!(output.len(), 1);
            assert!(output[0].echo_reference.is_none());
            assert_eq!(*output[0].samples, original);
        }
    }
}
