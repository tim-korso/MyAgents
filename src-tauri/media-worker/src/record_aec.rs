//! One workload's echo canceller. Both live and final supply capture-clock
//! aligned 10 ms frames; this module never estimates or changes Record time.

use sonora::high_pass_filter::HighPassFilter;
use sonora_aec3::{
    block::Block, block_framer::BlockFramer, block_processor::BlockProcessor,
    config::EchoCanceller3Config, frame_blocker::FrameBlocker,
};
use zeroize::Zeroize;

pub const AEC_FRAME_SAMPLES: usize = 160;
/// Sonora 0.2.0 at 16 kHz: block framing (64) + synthesis overlap-add (64).
/// The streaming caller drains this tail and maps output back to capture time.
pub const AEC_CAPTURE_DELAY_SAMPLES: usize = 128;
const SUB_FRAME_SAMPLES: usize = AEC_FRAME_SAMPLES / 2;
const PCM_SCALE: f32 = 32_768.0;

pub struct RecordEchoCanceller {
    microphone_channels: usize,
    system_channels: usize,
    processor: Option<Aec3Frames>,
}

impl RecordEchoCanceller {
    pub fn new(microphone_channels: usize, system_channels: usize) -> Result<Self, &'static str> {
        if !(1..=2).contains(&microphone_channels) || !(1..=2).contains(&system_channels) {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        Ok(Self {
            microphone_channels,
            system_channels,
            processor: None,
        })
    }

    /// Drop adaptive history at a pause, gap, or source boundary. Rebuild only
    /// when reliable reference resumes, not on every bypass frame.
    pub fn reset(&mut self) {
        self.processor = None;
    }

    /// `None` means absent/unreliable reference: preserve capture exactly.
    /// The bool reports execution, never a claim that echo was removed.
    pub fn process(
        &mut self,
        microphone: &[f32],
        system: Option<&[f32]>,
        output: &mut [f32],
    ) -> Result<bool, &'static str> {
        if !valid_frame(microphone, self.microphone_channels) || output.len() != microphone.len() {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        let Some(system) = system else {
            self.reset();
            output.copy_from_slice(microphone);
            return Ok(false);
        };
        if !valid_frame(system, self.system_channels) {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        self.processor
            .get_or_insert_with(|| Aec3Frames::new(self.microphone_channels, self.system_channels))
            .process(microphone, system, output)?;
        Ok(true)
    }
}

/// The library's 80-to-64 sample framing and AEC3 processor, with fixed 16 kHz
/// capture/render channels. No device inference, output switching or DSP fork.
struct Aec3Frames {
    processor: BlockProcessor,
    high_pass: HighPassFilter,
    render_blocker: FrameBlocker,
    capture_blocker: FrameBlocker,
    output_framer: BlockFramer,
    render_block: Block,
    capture_block: Block,
    microphone: Vec<Vec<f32>>,
    system: Vec<Vec<f32>>,
    cleaned: Vec<Vec<Vec<f32>>>,
}
impl Aec3Frames {
    fn new(microphone_channels: usize, system_channels: usize) -> Self {
        let mut config = if system_channels > 1 {
            EchoCanceller3Config::create_default_multichannel_config()
        } else {
            EchoCanceller3Config::default()
        };
        // Aligned system playback is not evidence of an acoustic echo path.
        // Until AEC3 can use its learned linear path, its default unit-gain
        // residual estimate suppresses unrelated headphone speech. Use no
        // assumed path; learned residual estimation remains enabled. During
        // convergence, uncertain echo survives instead of losing near-end.
        config.ep_strength.default_gain = 0.0;
        Self {
            processor: BlockProcessor::new(&config, 16_000, system_channels, microphone_channels),
            high_pass: HighPassFilter::new(16_000, microphone_channels),
            render_blocker: FrameBlocker::new(1, system_channels),
            capture_blocker: FrameBlocker::new(1, microphone_channels),
            output_framer: BlockFramer::new(1, microphone_channels),
            render_block: Block::new(1, system_channels),
            capture_block: Block::new(1, microphone_channels),
            microphone: vec![vec![0.0; AEC_FRAME_SAMPLES]; microphone_channels],
            system: vec![vec![0.0; AEC_FRAME_SAMPLES]; system_channels],
            cleaned: vec![vec![vec![0.0; SUB_FRAME_SAMPLES]; microphone_channels]],
        }
    }
    fn process(
        &mut self,
        microphone: &[f32],
        system: &[f32],
        output: &mut [f32],
    ) -> Result<(), &'static str> {
        deinterleave(microphone, &mut self.microphone);
        deinterleave(system, &mut self.system);
        let saturated = microphone.iter().any(|v| v.abs() * PCM_SCALE >= 32_700.0);
        self.high_pass.process_channels(&mut self.microphone);
        // These sources already share a media clock. Feed matching blocks in
        // order instead of adding a fluctuating 2/3-block render lead.
        for start in [0, SUB_FRAME_SAMPLES] {
            let input = [self
                .system
                .iter()
                .map(|ch| &ch[start..start + SUB_FRAME_SAMPLES])
                .collect()];
            self.render_blocker
                .insert_sub_frame_and_extract_block(&input, &mut self.render_block);
            self.processor.buffer_render(&self.render_block);
            let input = [self
                .microphone
                .iter()
                .map(|ch| &ch[start..start + SUB_FRAME_SAMPLES])
                .collect()];
            self.capture_blocker
                .insert_sub_frame_and_extract_block(&input, &mut self.capture_block);
            self.processor
                .process_capture(false, saturated, None, &mut self.capture_block);
            self.output_framer
                .insert_block_and_extract_sub_frame(&self.capture_block, &mut self.cleaned);
            for (index, frame) in output
                .chunks_exact_mut(self.microphone.len())
                .skip(start)
                .take(SUB_FRAME_SAMPLES)
                .enumerate()
            {
                for (channel, sample) in frame.iter_mut().enumerate() {
                    let value = self.cleaned[0][channel][index] / PCM_SCALE;
                    if !value.is_finite() {
                        return Err("SPEECH_INFERENCE_FAILED");
                    }
                    *sample = value.clamp(-1.0, 1.0);
                }
            }
        }
        if self.capture_blocker.is_block_available() {
            self.render_blocker.extract_block(&mut self.render_block);
            self.processor.buffer_render(&self.render_block);
            self.capture_blocker.extract_block(&mut self.capture_block);
            self.processor
                .process_capture(false, saturated, None, &mut self.capture_block);
            self.output_framer.insert_block(&self.capture_block);
        }
        Ok(())
    }
}
impl Drop for Aec3Frames {
    fn drop(&mut self) {
        self.microphone.zeroize();
        self.system.zeroize();
        self.cleaned.zeroize();
        for ch in 0..self.render_block.num_channels() {
            self.render_block.view_mut(0, ch).zeroize();
        }
        for ch in 0..self.capture_block.num_channels() {
            self.capture_block.view_mut(0, ch).zeroize();
        }
    }
}
fn valid_frame(samples: &[f32], channels: usize) -> bool {
    samples.len() == AEC_FRAME_SAMPLES * channels
        && samples
            .iter()
            .all(|sample| sample.is_finite() && sample.abs() <= 1.0)
}
fn deinterleave(samples: &[f32], planes: &mut [Vec<f32>]) {
    for (index, frame) in samples.chunks_exact(planes.len()).enumerate() {
        for (channel, sample) in frame.iter().enumerate() {
            planes[channel][index] = *sample * PCM_SCALE;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_reference_preserves_near_end_including_stereo_and_short_replies() {
        for channels in [1, 2] {
            let mut aec = RecordEchoCanceller::new(channels, 2).unwrap();
            let microphone = (0..AEC_FRAME_SAMPLES * channels)
                .map(|i| (i as f32 * 0.17).sin() * 0.25)
                .collect::<Vec<_>>();
            let mut output = vec![0.0; microphone.len()];
            assert!(!aec.process(&microphone, None, &mut output).unwrap());
            assert_eq!(microphone, output);
            assert!(aec.processor.is_none());
        }
    }

    #[test]
    fn system_reference_cannot_become_a_second_output_voice() {
        for microphone_channels in [1, 2] {
            for system_channels in [1, 2] {
                let mut aec =
                    RecordEchoCanceller::new(microphone_channels, system_channels).unwrap();
                let microphone = vec![0.0; AEC_FRAME_SAMPLES * microphone_channels];
                let system = (0..AEC_FRAME_SAMPLES * system_channels)
                    .map(|i| (i as f32 * 0.13).sin() * 0.25)
                    .collect::<Vec<_>>();
                let original_system = system.clone();
                let mut output = vec![0.0; microphone.len()];
                let mut energy = 0.0_f64;
                let mut correlation = 0.0_f64;
                let mut reference_energy = 0.0_f64;
                for _ in 0..100 {
                    assert!(
                        aec.process(&microphone, Some(&system), &mut output)
                            .unwrap()
                    );
                    assert!(output.iter().all(|v| v.is_finite()));
                    for frame in 0..AEC_FRAME_SAMPLES {
                        let value = output[frame * microphone_channels] as f64;
                        let reference = system[frame * system_channels] as f64;
                        energy += value * value;
                        correlation += value * reference;
                        reference_energy += reference * reference;
                    }
                }
                // AEC3 adds comfort noise even for a silent capture input. It
                // must stay quiet and must not carry the reference waveform.
                assert!((energy / 16_000.0).sqrt() < 0.001);
                assert!(correlation.abs() / (energy * reference_energy).sqrt().max(1e-20) < 0.05);
                assert_eq!(system, original_system);
                assert!(!aec.process(&microphone, None, &mut output).unwrap());
                assert!(aec.processor.is_none());
            }
        }
    }

    #[test]
    fn measures_capture_delay_separately_from_echo_path_delay() {
        let mut aec = RecordEchoCanceller::new(1, 1).unwrap();
        let mut random = 0x12345678_u32;
        let mut source = Vec::new();
        let mut cleaned = Vec::new();
        for _ in 0..200 {
            let mut microphone = [0.0; AEC_FRAME_SAMPLES];
            for value in &mut microphone {
                random ^= random << 13;
                random ^= random >> 17;
                random ^= random << 5;
                *value = (random as f64 / u32::MAX as f64 - 0.5) as f32 * 0.4;
            }
            let mut output = [0.0; AEC_FRAME_SAMPLES];
            aec.process(&microphone, Some(&[0.0; AEC_FRAME_SAMPLES]), &mut output)
                .unwrap();
            source.extend_from_slice(&microphone);
            cleaned.extend_from_slice(&output);
        }
        let lag = (0..320)
            .max_by(|left, right| {
                let dot = |lag: usize| {
                    (1600..source.len() - 320)
                        .map(|i| source[i] as f64 * cleaned[i + lag] as f64)
                        .sum::<f64>()
                };
                dot(*left).total_cmp(&dot(*right))
            })
            .unwrap();
        // 64 samples from frame/block adaptation and 64 from overlap-add.
        assert_eq!(lag, AEC_CAPTURE_DELAY_SAMPLES);
    }

    #[test]
    fn unrelated_headphone_render_preserves_near_end_from_cold_start() {
        // Independent, speech-band signals with a quiet near-end onset while
        // remote playback is already strong. Reliable clocks do not establish
        // an acoustic echo path (headphones are an ordinary dual-track input).
        let length = 8 * 16_000;
        let mut random = 0x18abcdef_u32;
        let mut noise = || {
            random ^= random << 13;
            random ^= random >> 17;
            random ^= random << 5;
            (random as f64 / u32::MAX as f64 - 0.5) as f32
        };
        let mut mic = vec![0.0; length];
        let mut render = vec![0.0; length];
        let mut mic_filter = 0.0;
        let mut render_filter = 0.0;
        for index in 0..length {
            render_filter = render_filter * 0.85 + noise() * 0.15;
            mic_filter = mic_filter * 0.7 + noise() * 0.3;
            if (16_000..7 * 16_000).contains(&index) {
                render[index] = render_filter * 2.0;
            }
            if (3 * 16_000..6 * 16_000).contains(&index) {
                mic[index] = mic_filter * 0.25;
            }
        }
        for microphone_channels in [1, 2] {
            for system_channels in [1, 2] {
                let mut aec =
                    RecordEchoCanceller::new(microphone_channels, system_channels).unwrap();
                let mut without_playback =
                    RecordEchoCanceller::new(microphone_channels, system_channels).unwrap();
                let mut cleaned = Vec::new();
                let mut baseline = Vec::new();
                for start in (0..length).step_by(AEC_FRAME_SAMPLES) {
                    // Repeat the onset protection after a media epoch reset,
                    // with near-end and render already active at that boundary.
                    if start == 72_000 {
                        aec.reset();
                        without_playback.reset();
                    }
                    let interleave = |samples: &[f32], channels: usize| {
                        samples
                            .iter()
                            .flat_map(|v| {
                                (0..channels).map(move |ch| *v * if ch == 0 { 1.0 } else { -0.6 })
                            })
                            .collect::<Vec<_>>()
                    };
                    let microphone =
                        interleave(&mic[start..start + AEC_FRAME_SAMPLES], microphone_channels);
                    let system =
                        interleave(&render[start..start + AEC_FRAME_SAMPLES], system_channels);
                    let mut output = vec![0.0; microphone.len()];
                    aec.process(&microphone, Some(&system), &mut output)
                        .unwrap();
                    cleaned.extend_from_slice(&output);
                    without_playback
                        .process(&microphone, Some(&vec![0.0; system.len()]), &mut output)
                        .unwrap();
                    baseline.extend_from_slice(&output);
                }
                for start in (3 * 16_000..6 * 16_000).step_by(8_000) {
                    for channel in 0..microphone_channels {
                        let mut reference_energy = 0.0;
                        let mut retained = 0.0;
                        for sample in start..start + 8_000 {
                            let index = (sample + AEC_CAPTURE_DELAY_SAMPLES) * microphone_channels
                                + channel;
                            let reference = f64::from(baseline[index]);
                            reference_energy += reference.powi(2);
                            retained += reference * f64::from(cleaned[index]);
                        }
                        assert!(
                            retained / reference_energy > 0.85,
                            "near-end gain at {start}, channels {microphone_channels}/{system_channels}, channel {channel}: {}",
                            retained / reference_energy
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn invalid_pcm_is_a_computation_error_not_an_uncertain_match() {
        assert!(RecordEchoCanceller::new(0, 1).is_err());
        assert!(RecordEchoCanceller::new(1, 3).is_err());
        let mut aec = RecordEchoCanceller::new(1, 1).unwrap();
        let mut microphone = [0.0; AEC_FRAME_SAMPLES];
        let mut output = microphone;
        assert!(aec.process(&microphone[..159], None, &mut output).is_err());
        assert!(
            aec.process(&microphone, Some(&[0.0; 159]), &mut output)
                .is_err()
        );
        microphone[0] = f32::NAN;
        assert!(aec.process(&microphone, None, &mut output).is_err());
    }
}
