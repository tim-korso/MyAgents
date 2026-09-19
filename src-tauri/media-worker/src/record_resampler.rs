//! Apply one captured clock interval with the same Rubato sinc engine used by
//! recording and attachment decoding. The caller supplies bounded context from
//! the physical source; output excludes context and preserves absolute phase.

use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
    calculate_cutoff,
};
use zeroize::Zeroize;

pub const RECORD_RESAMPLER_CONTEXT: usize = 128;
const CHUNK_FRAMES: usize = 1_024;

pub struct RecordTimeResampler {
    channels: usize,
    source_frames: u64,
    target_frames: u64,
    preroll_frames: usize,
    received_frames: u64,
    emitted_frames: u64,
    skip_frames: usize,
    pending_frames: usize,
    resampler: Option<SincFixedIn<f32>>,
    input: Vec<Vec<f32>>,
    output: Vec<Vec<f32>>,
}

impl RecordTimeResampler {
    pub fn new(
        source_frames: u64,
        target_frames: u64,
        channels: usize,
        preroll_frames: usize,
    ) -> Result<Self, &'static str> {
        if source_frames == 0
            || target_frames == 0
            || !(1..=2).contains(&channels)
            || source_frames > crate::protocol::MAX_MEDIA_SAMPLES_PER_TRACK
            || target_frames > crate::protocol::MAX_MEDIA_SAMPLES_PER_TRACK
            || preroll_frames > RECORD_RESAMPLER_CONTEXT
        {
            return Err("SPEECH_CAPTURE_TIME_INVALID");
        }
        let ratio = target_frames as f64 / source_frames as f64;
        if !(0.5..=2.0).contains(&ratio) {
            return Err("SPEECH_CAPTURE_TIME_INVALID");
        }
        let resampler = if source_frames == target_frames {
            None
        } else {
            let window = WindowFunction::BlackmanHarris2;
            Some(
                SincFixedIn::new(
                    ratio,
                    1.0,
                    SincInterpolationParameters {
                        sinc_len: RECORD_RESAMPLER_CONTEXT,
                        f_cutoff: calculate_cutoff(RECORD_RESAMPLER_CONTEXT, window),
                        oversampling_factor: 128,
                        interpolation: SincInterpolationType::Cubic,
                        window,
                    },
                    CHUNK_FRAMES,
                    channels,
                )
                .map_err(|_| "SPEECH_RESOURCE_LIMIT")?,
            )
        };
        let input = resampler
            .as_ref()
            .map_or_else(Vec::new, |value| value.input_buffer_allocate(true));
        let output = resampler
            .as_ref()
            .map_or_else(Vec::new, |value| value.output_buffer_allocate(true));
        // SincFixedIn 0.16.2 starts its interpolation at -sinc_len/2,
        // cancelling the kernel's centre offset in the returned samples.
        // output_delay() describes lookahead; trimming it again removes real
        // source audio. Absolute-marker tests pin the actual phase contract.
        let skip_frames = (preroll_frames as f64 * ratio).round() as usize;
        Ok(Self {
            channels,
            source_frames,
            target_frames,
            preroll_frames,
            received_frames: 0,
            emitted_frames: 0,
            skip_frames,
            pending_frames: 0,
            resampler,
            input,
            output,
        })
    }

    pub fn push(&mut self, samples: &[f32], output: &mut Vec<f32>) -> Result<(), &'static str> {
        if !samples.len().is_multiple_of(self.channels)
            || samples.len() > CHUNK_FRAMES * self.channels
        {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        for frame in samples.chunks_exact(self.channels) {
            if !frame.iter().all(|value| value.is_finite()) {
                return Err("SPEECH_CORRUPT_MEDIA");
            }
            self.received_frames += 1;
            if self.received_frames
                > self.source_frames + self.preroll_frames as u64 + RECORD_RESAMPLER_CONTEXT as u64
            {
                return Err("SPEECH_CAPTURE_TIME_INVALID");
            }
            if self.resampler.is_none() {
                if self.skip_frames > 0 {
                    self.skip_frames -= 1;
                } else if self.emitted_frames < self.target_frames {
                    output.extend_from_slice(frame);
                    self.emitted_frames += 1;
                }
                continue;
            }
            for (channel, value) in frame.iter().enumerate() {
                self.input[channel][self.pending_frames] = *value;
            }
            self.pending_frames += 1;
            if self.pending_frames == CHUNK_FRAMES {
                self.process_chunk(output)?;
            }
        }
        Ok(())
    }

    pub fn finish(&mut self, output: &mut Vec<f32>) -> Result<(), &'static str> {
        if self.received_frames < self.source_frames + self.preroll_frames as u64 {
            return Err("SPEECH_CORRUPT_MEDIA");
        }
        if self.resampler.is_some() {
            for plane in &mut self.input {
                plane[self.pending_frames..].fill(0.0);
            }
            // Exact target extent, including a short final interval. This is
            // filter flushing, not new speech or new Record time.
            for _ in 0..4 {
                if self.emitted_frames == self.target_frames {
                    break;
                }
                self.process_chunk(output)?;
                for plane in &mut self.input {
                    plane.fill(0.0);
                }
            }
        }
        (self.emitted_frames == self.target_frames)
            .then_some(())
            .ok_or("SPEECH_INFERENCE_FAILED")
    }

    fn process_chunk(&mut self, output: &mut Vec<f32>) -> Result<(), &'static str> {
        let (_, frames) = self
            .resampler
            .as_mut()
            .ok_or("SPEECH_INFERENCE_FAILED")?
            .process_into_buffer(&self.input, &mut self.output, None)
            .map_err(|_| "SPEECH_INFERENCE_FAILED")?;
        self.pending_frames = 0;
        let first = self.skip_frames.min(frames);
        self.skip_frames -= first;
        let count = (frames - first).min((self.target_frames - self.emitted_frames) as usize);
        for frame in first..first + count {
            for plane in &self.output {
                let value = plane[frame];
                if !value.is_finite() {
                    return Err("SPEECH_INFERENCE_FAILED");
                }
                output.push(value.clamp(-1.0, 1.0));
            }
        }
        self.emitted_frames += count as u64;
        Ok(())
    }
}

impl Drop for RecordTimeResampler {
    fn drop(&mut self) {
        for plane in &mut self.input {
            plane.zeroize();
        }
        for plane in &mut self.output {
            plane.zeroize();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_absolute_markers_and_channels_while_correcting_clock_drift() {
        for target in [15_984, 16_016] {
            let mut resampler = RecordTimeResampler::new(16_000, target, 2, 128).unwrap();
            let mut output = Vec::new();
            let mut input = Vec::new();
            for frame in 0..16_256 {
                let source = frame as f32 - 128.0;
                input.push((-((source - 4_000.0) / 8.0).powi(2)).exp() * 0.5);
                input.push((-((source - 12_000.0) / 8.0).powi(2)).exp() * 0.5);
            }
            for chunk in input.chunks(320 * 2) {
                resampler.push(chunk, &mut output).unwrap();
            }
            resampler.finish(&mut output).unwrap();
            assert_eq!(output.len(), target as usize * 2);
            for (channel, source_marker) in [(0, 4_000), (1, 12_000)] {
                let marker = (0..target as usize)
                    .max_by(|a, b| output[a * 2 + channel].total_cmp(&output[b * 2 + channel]))
                    .unwrap();
                let expected = (source_marker * target / 16_000) as usize;
                assert!(
                    marker.abs_diff(expected) <= 2,
                    "actual={marker} expected={expected}"
                );
            }
        }
    }

    #[test]
    fn equal_clock_is_sample_exact_and_does_not_append_filter_context() {
        let mut resampler = RecordTimeResampler::new(3, 3, 2, 1).unwrap();
        let mut output = Vec::new();
        resampler
            .push(
                &[0.9, 0.8, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
                &mut output,
            )
            .unwrap();
        resampler.finish(&mut output).unwrap();
        assert_eq!(output, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        assert!(RecordTimeResampler::new(16_000, 1, 1, 0).is_err());
    }

    #[test]
    fn short_tail_is_not_lost_to_filter_delay() {
        let mut resampler = RecordTimeResampler::new(80, 81, 1, 0).unwrap();
        let mut output = Vec::new();
        resampler.push(&[0.2; 80], &mut output).unwrap();
        resampler.finish(&mut output).unwrap();
        assert_eq!(output.len(), 81);
        assert!(output[16..64].iter().all(|sample| *sample > 0.1));
    }
}
