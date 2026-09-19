//! Callback-safe audio buffering and the one shared recording resampler.
//!
//! Capture callbacks only convert into a preallocated SPSC ring. Archive and
//! analysis workers both use the same Rubato-backed adapter off the callback
//! thread; domain modules remain responsible for persistence and lifecycle.

use ringbuf::{traits::*, HeapRb};
use rubato::{
    calculate_cutoff, Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};

use super::timing::{CaptureTimePoint, CaptureTimeline};
use myagents_media_worker_protocol::record_timeline::RecordTrackTimeline;

const RESAMPLER_CHUNK_FRAMES: usize = 1_024;
const RESAMPLER_SINC_LENGTH: usize = 128;
const RESAMPLER_OVERSAMPLING_FACTOR: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

impl SourceFormat {
    pub fn validate(self) -> Result<Self, String> {
        if !(8_000..=384_000).contains(&self.sample_rate) {
            return Err(format!(
                "unsupported capture sample rate: {}",
                self.sample_rate
            ));
        }
        if self.channels == 0 || self.channels > 32 {
            return Err(format!(
                "unsupported capture channel count: {}",
                self.channels
            ));
        }
        Ok(self)
    }
}

#[derive(Clone)]
pub struct RealtimeTrackSink {
    producer: Arc<Mutex<CaptureProducer>>,
    source_frames: Arc<AtomicU64>,
    timeline: Arc<Mutex<CaptureTimeline>>,
    format: SourceFormat,
    accepting: Arc<AtomicBool>,
    publication: Arc<RwLock<()>>,
    overrun_samples: Arc<AtomicU64>,
    wake: mpsc::SyncSender<()>,
}

impl RealtimeTrackSink {
    pub(super) fn source_format(&self) -> SourceFormat {
        self.format
    }

    pub fn set_accepting(&self, accepting: bool) {
        if !accepting {
            // Reject new work before waiting for callbacks already publishing.
            // A backend pause request is not a callback completion barrier.
            self.accepting.store(false, Ordering::Release);
        }
        let _boundary = self
            .publication
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if accepting {
            self.accepting.store(true, Ordering::Release);
        }
    }

    pub(super) fn wake_worker(&self) {
        let _ = self.wake.try_send(());
    }

    pub fn capture_timeline(&self) -> Result<Option<RecordTrackTimeline>, String> {
        self.timeline
            .lock()
            .map_err(|_| "capture timeline lock poisoned".to_string())?
            .snapshot()
            .map_err(str::to_string)
    }

    #[cfg(test)]
    pub fn push_f32(&self, samples: &[f32]) -> u8 {
        self.push_f32_at(samples, None)
    }

    pub(super) fn push_f32_at(&self, samples: &[f32], time: Option<CaptureTimePoint>) -> u8 {
        self.push_converted(samples.iter().copied(), time)
    }

    #[cfg(test)]
    pub fn push_i16(&self, samples: &[i16]) -> u8 {
        self.push_i16_at(samples, None)
    }

    pub(super) fn push_i16_at(&self, samples: &[i16], time: Option<CaptureTimePoint>) -> u8 {
        self.push_converted(
            samples
                .iter()
                .map(|sample| *sample as f32 / i16::MAX as f32),
            time,
        )
    }

    pub(super) fn push_i32_at(&self, samples: &[i32], time: Option<CaptureTimePoint>) -> u8 {
        self.push_converted(
            samples
                .iter()
                .map(|sample| *sample as f32 / i32::MAX as f32),
            time,
        )
    }

    pub(super) fn push_i8_at(&self, samples: &[i8], time: Option<CaptureTimePoint>) -> u8 {
        self.push_converted(
            samples.iter().map(|sample| *sample as f32 / i8::MAX as f32),
            time,
        )
    }

    #[cfg(target_os = "macos")]
    pub(super) fn push_planar_f32_at(
        &self,
        planes: &[&[f32]],
        time: Option<CaptureTimePoint>,
    ) -> u8 {
        if !self.accepting.load(Ordering::Acquire)
            || planes.len() != self.format.channels as usize
            || planes.is_empty()
        {
            return 0;
        }
        let frames = planes.iter().map(|plane| plane.len()).min().unwrap_or(0);
        let channels = self.format.channels as usize;
        self.push_converted(
            (0..frames * channels).map(|index| planes[index % channels][index / channels]),
            time,
        )
    }

    /// Preserve the source timeline while intentionally excluding its content.
    /// This stays allocation-free on the realtime callback thread.
    pub(super) fn push_silence_at(
        &self,
        sample_count: usize,
        time: Option<CaptureTimePoint>,
    ) -> u8 {
        self.push_converted(std::iter::repeat_n(0.0, sample_count), time)
    }

    fn push_converted(
        &self,
        samples: impl ExactSizeIterator<Item = f32>,
        time: Option<CaptureTimePoint>,
    ) -> u8 {
        // This guard defines admission and lives through reservation, PCM and
        // metadata publication, including overflow accounting. Never wait on
        // the realtime thread. The protected value is only a lifetime token.
        let Ok(_publication) = self.publication.try_read() else {
            return 0;
        };
        if !self.accepting.load(Ordering::Acquire) {
            return 0;
        }
        let channels = self.format.channels as usize;
        let sample_count = samples.len();
        let frame_count = sample_count / channels;
        let source_start = self
            .source_frames
            .fetch_add(frame_count as u64, Ordering::AcqRel);
        let Ok(mut producer) = self.producer.try_lock() else {
            self.overrun_samples
                .fetch_add((frame_count * channels) as u64, Ordering::Relaxed);
            self.wake_worker();
            return 0;
        };
        let accepted_frames = if producer.chunks.is_full() {
            0
        } else {
            frame_count.min(producer.samples.vacant_len() / channels)
        };
        let accepted_samples = accepted_frames * channels;
        let mut peak = 0.0_f32;
        for sample in samples.take(accepted_samples) {
            let sample = if sample.is_finite() {
                sample.clamp(-1.0, 1.0)
            } else {
                0.0
            };
            peak = peak.max(sample.abs());
            let pushed = producer.samples.try_push(sample);
            debug_assert!(pushed.is_ok());
        }
        if accepted_frames > 0 {
            // Publish metadata after PCM, so the consumer never observes an
            // available chunk whose samples have not been published yet.
            let pushed = producer.chunks.try_push(CaptureChunk {
                source_start,
                frames: accepted_frames as u64,
                time,
            });
            debug_assert!(pushed.is_ok());
        }
        let dropped = (frame_count - accepted_frames) * channels;
        drop(producer);
        if dropped > 0 {
            self.overrun_samples
                .fetch_add(dropped as u64, Ordering::Relaxed);
        }
        self.wake_worker();
        peak_percent(peak)
    }
}

fn peak_percent(peak: f32) -> u8 {
    const FLOOR_DB: f32 = -60.0;
    let peak = peak.clamp(0.0, 1.0);
    if peak <= 0.0 {
        return 0;
    }
    let decibels = 20.0 * peak.log10();
    (((decibels - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0) * 100.0).round() as u8
}

/// Original source coordinates survive ring overrun. Small metadata records
/// accompany the existing PCM ring; audio remains in its preallocated buffer.
#[derive(Clone, Copy)]
struct CaptureChunk {
    source_start: u64,
    frames: u64,
    time: Option<CaptureTimePoint>,
}

struct CaptureProducer {
    samples: ringbuf::HeapProd<f32>,
    chunks: ringbuf::HeapProd<CaptureChunk>,
}

pub(super) struct RealtimeTrackReader {
    samples: ringbuf::HeapCons<f32>,
    chunks: ringbuf::HeapCons<CaptureChunk>,
    current: Option<CaptureChunk>,
    position: u64,
    channels: usize,
    source_frames: Arc<AtomicU64>,
    finishing: bool,
    sample_rate: u32,
    timeline: Arc<Mutex<CaptureTimeline>>,
}

impl RealtimeTrackReader {
    pub fn close_resampler_epoch(&mut self, output_frames: u64) {
        if let Ok(mut timeline) = self.timeline.lock() {
            timeline.close_resampler_epoch(self.sample_rate, self.position, output_frames);
        }
    }
    /// Call only after the producer has stopped. Until then an unpublished
    /// callback cannot be treated as a missing tail.
    pub fn finish_input(&mut self) {
        self.finishing = true;
    }

    pub fn resume_input(&mut self) {
        self.finishing = false;
    }

    pub fn is_empty(&self) -> bool {
        self.current.is_none()
            && self.chunks.is_empty()
            && (!self.finishing || self.position >= self.source_frames.load(Ordering::Acquire))
    }

    #[cfg(test)]
    pub fn occupied_len(&self) -> usize {
        self.samples.occupied_len()
    }

    pub fn pop_slice(&mut self, output: &mut [f32]) -> usize {
        let capacity = output.len() / self.channels;
        let mut written = 0;
        while written < capacity {
            if self.current.is_none() {
                self.current = self.chunks.try_pop();
                if let Some(chunk) = self.current {
                    if let Ok(mut timeline) = self.timeline.lock() {
                        if self.position < chunk.source_start {
                            timeline.observe(
                                self.sample_rate,
                                self.position,
                                chunk.source_start - self.position,
                                None,
                                true,
                            );
                        }
                        timeline.observe(
                            self.sample_rate,
                            chunk.source_start,
                            chunk.frames,
                            chunk.time,
                            false,
                        );
                    }
                }
            }
            let Some(chunk) = self.current.as_mut() else {
                if self.finishing {
                    let tail = self
                        .source_frames
                        .load(Ordering::Acquire)
                        .saturating_sub(self.position);
                    let frames = (tail as usize).min(capacity - written);
                    if let Ok(mut timeline) = self.timeline.lock() {
                        timeline.observe(
                            self.sample_rate,
                            self.position,
                            frames as u64,
                            None,
                            true,
                        );
                    }
                    output[written * self.channels..(written + frames) * self.channels].fill(0.0);
                    written += frames;
                    self.position += frames as u64;
                }
                break;
            };
            // An overflow hole is inserted where it occurred, never appended
            // at the end after compressing the following real speech.
            if self.position < chunk.source_start {
                let frames =
                    ((chunk.source_start - self.position) as usize).min(capacity - written);
                output[written * self.channels..(written + frames) * self.channels].fill(0.0);
                written += frames;
                self.position += frames as u64;
                continue;
            }
            let frames = (chunk.frames as usize).min(capacity - written);
            let destination =
                &mut output[written * self.channels..(written + frames) * self.channels];
            let count = self.samples.pop_slice(destination);
            debug_assert_eq!(count, destination.len());
            written += frames;
            self.position += frames as u64;
            chunk.source_start += frames as u64;
            chunk.frames -= frames as u64;
            if chunk.frames == 0 {
                self.current = None;
            }
        }
        written * self.channels
    }
}

pub(super) struct RealtimeRingParts {
    pub sink: RealtimeTrackSink,
    pub consumer: RealtimeTrackReader,
    pub stop: Arc<AtomicBool>,
    pub overrun_samples: Arc<AtomicU64>,
    pub wake_rx: mpsc::Receiver<()>,
}

pub(super) fn create_realtime_ring(
    format: SourceFormat,
    seconds: usize,
) -> Result<RealtimeRingParts, String> {
    let format = format.validate()?;
    if seconds == 0 || seconds > 60 {
        return Err("realtime ring duration is invalid".to_string());
    }
    let capacity = (format.sample_rate as usize)
        .checked_mul(format.channels as usize)
        .and_then(|samples| samples.checked_mul(seconds))
        .ok_or_else(|| "realtime ring capacity overflow".to_string())?;
    let (producer, consumer) = HeapRb::<f32>::new(capacity).split();
    let (chunks, chunk_reader) = HeapRb::<CaptureChunk>::new(4_096).split();
    let producer = Arc::new(Mutex::new(CaptureProducer {
        samples: producer,
        chunks,
    }));
    let source_frames = Arc::new(AtomicU64::new(0));
    let timeline = Arc::new(Mutex::new(CaptureTimeline::default()));
    let accepting = Arc::new(AtomicBool::new(true));
    let overrun_samples = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let (wake, wake_rx) = mpsc::sync_channel(1);
    Ok(RealtimeRingParts {
        sink: RealtimeTrackSink {
            producer,
            source_frames: source_frames.clone(),
            timeline: timeline.clone(),
            format,
            accepting,
            publication: Arc::new(RwLock::new(())),
            overrun_samples: overrun_samples.clone(),
            wake,
        },
        consumer: RealtimeTrackReader {
            samples: consumer,
            chunks: chunk_reader,
            current: None,
            position: 0,
            channels: usize::from(format.channels),
            source_frames,
            finishing: false,
            sample_rate: format.sample_rate,
            timeline,
        },
        stop,
        overrun_samples,
        wake_rx,
    })
}

pub(super) struct StreamingAudioResampler {
    input_sample_rate: u32,
    output_sample_rate: u32,
    input_channels: usize,
    output_channels: usize,
    resampler: Option<SincFixedIn<f32>>,
    input_planes: Vec<Vec<f32>>,
    output_planes: Vec<Vec<f32>>,
    pending_input_frame: Vec<f32>,
    pending_frames: usize,
    input_frames: u64,
    emitted_frames: u64,
}

impl StreamingAudioResampler {
    pub fn new(
        format: SourceFormat,
        output_sample_rate: u32,
        output_channels: usize,
    ) -> Result<Self, String> {
        let format = format.validate()?;
        if !(8_000..=384_000).contains(&output_sample_rate) {
            return Err("audio output sample rate is invalid".to_string());
        }
        if output_channels == 0 || output_channels > 2 {
            return Err("audio resampler supports one or two output channels".to_string());
        }
        let input_channels = format.channels as usize;
        if format.sample_rate == output_sample_rate {
            return Ok(Self {
                input_sample_rate: format.sample_rate,
                output_sample_rate,
                input_channels,
                output_channels,
                resampler: None,
                input_planes: Vec::new(),
                output_planes: Vec::new(),
                pending_input_frame: Vec::with_capacity(input_channels),
                pending_frames: 0,
                input_frames: 0,
                emitted_frames: 0,
            });
        }

        let window = WindowFunction::BlackmanHarris2;
        let parameters = SincInterpolationParameters {
            sinc_len: RESAMPLER_SINC_LENGTH,
            f_cutoff: calculate_cutoff(RESAMPLER_SINC_LENGTH, window),
            oversampling_factor: RESAMPLER_OVERSAMPLING_FACTOR,
            interpolation: SincInterpolationType::Cubic,
            window,
        };
        let ratio = output_sample_rate as f64 / format.sample_rate as f64;
        let resampler = SincFixedIn::<f32>::new(
            ratio,
            1.0,
            parameters,
            RESAMPLER_CHUNK_FRAMES,
            output_channels,
        )
        .map_err(|error| format!("create audio resampler: {error}"))?;
        let input_planes = resampler.input_buffer_allocate(true);
        let output_planes = resampler.output_buffer_allocate(true);
        Ok(Self {
            input_sample_rate: format.sample_rate,
            output_sample_rate,
            input_channels,
            output_channels,
            resampler: Some(resampler),
            input_planes,
            output_planes,
            pending_input_frame: Vec::with_capacity(input_channels),
            pending_frames: 0,
            input_frames: 0,
            emitted_frames: 0,
        })
    }

    pub fn process(&mut self, input: &[f32], output: &mut Vec<f32>) -> Result<(), String> {
        let mut remaining = input;
        if !self.pending_input_frame.is_empty() {
            let needed = self.input_channels - self.pending_input_frame.len();
            let taken = needed.min(remaining.len());
            self.pending_input_frame
                .extend_from_slice(&remaining[..taken]);
            remaining = &remaining[taken..];
            if self.pending_input_frame.len() == self.input_channels {
                let mixed = mix_frame(&self.pending_input_frame, self.output_channels);
                self.pending_input_frame.fill(0.0);
                self.pending_input_frame.clear();
                self.process_mixed_frame(mixed, output)?;
            } else {
                return Ok(());
            }
        }

        let mut frames = remaining.chunks_exact(self.input_channels);
        for frame in &mut frames {
            let mixed = mix_frame(frame, self.output_channels);
            self.process_mixed_frame(mixed, output)?;
        }
        self.pending_input_frame
            .extend_from_slice(frames.remainder());
        Ok(())
    }

    pub fn finish(&mut self, output: &mut Vec<f32>) -> Result<(), String> {
        if !self.pending_input_frame.is_empty() {
            return Err("audio input ended inside a source channel frame".to_string());
        }
        let target_frames = self.expected_output_frames();
        if self.resampler.is_none() {
            return if self.emitted_frames == target_frames {
                Ok(())
            } else {
                Err("audio passthrough duration drifted".to_string())
            };
        }

        if self.pending_frames > 0 {
            for plane in &mut self.input_planes {
                plane[self.pending_frames..RESAMPLER_CHUNK_FRAMES].fill(0.0);
            }
            self.process_full_chunk(output, Some(target_frames))?;
        }
        for plane in &mut self.input_planes {
            plane[..RESAMPLER_CHUNK_FRAMES].fill(0.0);
        }
        let mut flush_count = 0;
        while self.emitted_frames < target_frames {
            self.process_full_chunk(output, Some(target_frames))?;
            flush_count += 1;
            if flush_count > 8 {
                return Err("audio resampler failed to flush its bounded delay".to_string());
            }
        }
        if self.emitted_frames != target_frames {
            return Err("audio resampler duration drifted".to_string());
        }
        Ok(())
    }

    fn process_mixed_frame(
        &mut self,
        mixed: [f32; 2],
        output: &mut Vec<f32>,
    ) -> Result<(), String> {
        self.input_frames = self.input_frames.saturating_add(1);
        if self.resampler.is_none() {
            output.extend_from_slice(&mixed[..self.output_channels]);
            self.emitted_frames = self.emitted_frames.saturating_add(1);
            return Ok(());
        }
        for (channel, value) in mixed[..self.output_channels].iter().enumerate() {
            self.input_planes[channel][self.pending_frames] = *value;
        }
        self.pending_frames += 1;
        if self.pending_frames == RESAMPLER_CHUNK_FRAMES {
            self.process_full_chunk(output, None)?;
        }
        Ok(())
    }

    fn process_full_chunk(
        &mut self,
        output: &mut Vec<f32>,
        target_frames: Option<u64>,
    ) -> Result<(), String> {
        let (_, produced_frames) = self
            .resampler
            .as_mut()
            .expect("resampling chunks require a resampler")
            .process_into_buffer(&self.input_planes, &mut self.output_planes, None)
            .map_err(|error| format!("resample audio: {error}"))?;
        self.pending_frames = 0;
        // SincFixedIn 0.16.2 already centres its returned samples at the
        // source origin. Trimming output_delay() here shifts real speech;
        // lookahead is satisfied by finish(), not by discarding the head.
        let emitted_now = target_frames.map_or(produced_frames, |target| {
            produced_frames.min(target.saturating_sub(self.emitted_frames) as usize)
        });
        for frame in 0..emitted_now {
            for channel in 0..self.output_channels {
                output.push(self.output_planes[channel][frame]);
            }
        }
        self.emitted_frames = self.emitted_frames.saturating_add(emitted_now as u64);
        Ok(())
    }

    fn expected_output_frames(&self) -> u64 {
        let numerator = self.input_frames as u128 * self.output_sample_rate as u128
            + self.input_sample_rate as u128 / 2;
        (numerator / self.input_sample_rate as u128) as u64
    }

    #[cfg(test)]
    fn buffered_input_frames(&self) -> usize {
        self.pending_frames
    }
}

fn mix_frame(frame: &[f32], output_channels: usize) -> [f32; 2] {
    if output_channels == 1 {
        return [frame.iter().copied().sum::<f32>() / frame.len() as f32, 0.0];
    }
    if frame.len() == 1 {
        return [frame[0], frame[0]];
    }
    let left_count = frame.len().div_ceil(2);
    let right_count = frame.len() / 2;
    [
        frame.iter().step_by(2).copied().sum::<f32>() / left_count as f32,
        frame.iter().skip(1).step_by(2).copied().sum::<f32>() / right_count as f32,
    ]
}

impl Drop for StreamingAudioResampler {
    fn drop(&mut self) {
        self.pending_input_frame.fill(0.0);
        for plane in &mut self.input_planes {
            plane.fill(0.0);
        }
        for plane in &mut self.output_planes {
            plane.fill(0.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_admission_waits_for_the_last_accepted_callback_before_tail_flush() {
        let mut parts = create_realtime_ring(
            SourceFormat {
                sample_rate: 16_000,
                channels: 1,
            },
            1,
        )
        .unwrap();
        let (entered_tx, entered_rx) = mpsc::sync_channel(0);
        let (release_tx, release_rx) = mpsc::sync_channel(0);
        let producer = parts.sink.clone();
        let callback = std::thread::spawn(move || {
            producer.push_converted(
                (0..320).map(|i| {
                    if i == 0 {
                        entered_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                    }
                    0.25
                }),
                None,
            );
        });
        entered_rx.recv().unwrap();
        let closing = parts.sink.clone();
        let (closed_tx, closed_rx) = mpsc::sync_channel(1);
        let close = std::thread::spawn(move || {
            closing.set_accepting(false);
            closed_tx.send(()).unwrap();
        });
        while parts.sink.accepting.load(Ordering::Acquire) {
            std::thread::yield_now();
        }
        let closed_before_callback = closed_rx
            .recv_timeout(std::time::Duration::from_millis(30))
            .is_ok();
        release_tx.send(()).unwrap();
        callback.join().unwrap();
        close.join().unwrap();
        assert!(
            !closed_before_callback,
            "pause/stop can flush an unpublished accepted callback as a missing tail"
        );
        parts.consumer.finish_input();
        let mut output = vec![0.0; 320];
        assert_eq!(parts.consumer.pop_slice(&mut output), 320);
        assert!(output.iter().all(|sample| *sample == 0.25));
        assert!(parts.consumer.is_empty());
        parts.sink.push_f32(&[0.5; 320]);
        assert!(parts.consumer.is_empty());
    }

    #[test]
    fn resampler_keeps_markers_at_absolute_capture_time() {
        for (source_rate, output_rate) in [(44_100, 48_000), (48_000, 16_000), (8_000, 48_000)] {
            let mut resampler = StreamingAudioResampler::new(
                SourceFormat {
                    sample_rate: source_rate,
                    channels: 1,
                },
                output_rate,
                1,
            )
            .unwrap();
            let input = (0..source_rate * 2)
                .map(|i| {
                    let offset = (i as f32 - source_rate as f32) / (source_rate as f32 * 0.0005);
                    (-offset * offset).exp() * 0.5
                })
                .collect::<Vec<_>>();
            let mut output = Vec::new();
            for chunk in input.chunks(777) {
                resampler.process(chunk, &mut output).unwrap();
            }
            resampler.finish(&mut output).unwrap();
            let peak = (0..output.len())
                .max_by(|a, b| output[*a].total_cmp(&output[*b]))
                .unwrap();
            assert!(
                peak.abs_diff(output_rate as usize) <= 8,
                "rate={source_rate}/{output_rate} peak={peak}"
            );
        }
    }

    #[test]
    fn mature_resampler_preserves_exact_media_time_with_bounded_input() {
        for sample_rate in [8_000, 16_000, 44_100, 48_000, 96_000, 192_000, 384_000] {
            for output_rate in [16_000, 48_000] {
                let format = SourceFormat {
                    sample_rate,
                    channels: 1,
                };
                let mut resampler = StreamingAudioResampler::new(format, output_rate, 1).unwrap();
                let source = vec![0.25_f32; sample_rate as usize + 137];
                let mut output = Vec::new();
                for chunk in source.chunks(777) {
                    resampler.process(chunk, &mut output).unwrap();
                    assert!(resampler.buffered_input_frames() < RESAMPLER_CHUNK_FRAMES);
                }
                resampler.finish(&mut output).unwrap();
                let expected = ((source.len() as u128 * output_rate as u128
                    + sample_rate as u128 / 2)
                    / sample_rate as u128) as usize;
                assert_eq!(
                    output.len(),
                    expected,
                    "input {sample_rate}, output {output_rate}"
                );
            }
        }
    }

    #[test]
    fn streaming_resampler_preserves_multichannel_frames_split_across_reads() {
        let mut resampler = StreamingAudioResampler::new(
            SourceFormat {
                sample_rate: 48_000,
                channels: 2,
            },
            48_000,
            1,
        )
        .unwrap();
        let mut output = Vec::new();

        resampler.process(&[0.2], &mut output).unwrap();
        assert!(output.is_empty());
        resampler.process(&[0.4, 0.6], &mut output).unwrap();
        assert!((output[0] - 0.3).abs() < f32::EPSILON);
        resampler.process(&[0.8], &mut output).unwrap();
        resampler.finish(&mut output).unwrap();

        assert_eq!(output.len(), 2);
        assert!((output[0] - 0.3).abs() < f32::EPSILON);
        assert!((output[1] - 0.7).abs() < 0.000_001);
    }

    #[test]
    fn capture_activity_uses_a_perceptual_audio_scale() {
        assert_eq!(peak_percent(0.0), 0);
        assert_eq!(peak_percent(1.0), 100);
        assert!(peak_percent(0.05) >= 50);
        assert!(peak_percent(0.01) >= 30);
        assert!(peak_percent(0.001) <= 1);
    }

    #[test]
    fn sinc_resampler_suppresses_downsampling_aliases() {
        fn resample_tone(frequency: f32) -> Vec<f32> {
            let sample_rate = 96_000_u32;
            let source = (0..sample_rate)
                .map(|index| {
                    (std::f32::consts::TAU * frequency * index as f32 / sample_rate as f32).sin()
                })
                .collect::<Vec<_>>();
            let mut resampler = StreamingAudioResampler::new(
                SourceFormat {
                    sample_rate,
                    channels: 1,
                },
                48_000,
                1,
            )
            .unwrap();
            let mut output = Vec::new();
            for chunk in source.chunks(613) {
                resampler.process(chunk, &mut output).unwrap();
            }
            resampler.finish(&mut output).unwrap();
            output
        }

        fn rms(samples: &[f32]) -> f32 {
            (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32)
                .sqrt()
        }

        let passband = resample_tone(1_000.0);
        let stopband = resample_tone(30_000.0);
        let settled = 4_800;
        let passband_rms = rms(&passband[settled..passband.len() - settled]);
        let stopband_rms = rms(&stopband[settled..stopband.len() - settled]);
        assert!(passband_rms > 0.6, "passband RMS was {passband_rms}");
        assert!(
            stopband_rms < passband_rms * 0.02,
            "stopband RMS {stopband_rms} was not suppressed relative to {passband_rms}"
        );
    }

    #[test]
    fn ring_overflow_keeps_the_hole_before_following_speech_and_at_the_tail() {
        let mut parts = create_realtime_ring(
            SourceFormat {
                sample_rate: 8_000,
                channels: 2,
            },
            1,
        )
        .unwrap();
        parts.sink.push_f32(&vec![0.1; 16_006]);
        let mut first = vec![0.0; 16_000];
        assert_eq!(parts.consumer.pop_slice(&mut first), 16_000);
        assert!(first.iter().all(|value| *value == 0.1));
        parts.sink.push_f32(&[0.2, 0.3, 0.4, 0.5]);
        let mut next = [1.0; 10];
        assert_eq!(parts.consumer.pop_slice(&mut next), 10);
        assert_eq!(&next[..6], &[0.0; 6]);
        assert_eq!(&next[6..], &[0.2, 0.3, 0.4, 0.5]);

        parts.sink.push_f32(&vec![0.6; 16_004]);
        assert_eq!(parts.consumer.pop_slice(&mut first), 16_000);
        parts.sink.set_accepting(false);
        parts.consumer.finish_input();
        let mut tail = [1.0; 4];
        assert_eq!(parts.consumer.pop_slice(&mut tail), 4);
        assert_eq!(tail, [0.0; 4]);
        assert!(parts.consumer.is_empty());
        assert_eq!(parts.overrun_samples.load(Ordering::Relaxed), 10);
    }

    #[test]
    fn callback_ring_reports_overrun_instead_of_blocking() {
        let parts = create_realtime_ring(
            SourceFormat {
                sample_rate: 8_000,
                channels: 1,
            },
            1,
        )
        .unwrap();
        let oversized = vec![0.1; 8_002];
        let peak = parts.sink.push_f32(&oversized);
        assert_eq!(peak, 67);
        assert_eq!(parts.overrun_samples.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn callback_overrun_never_splits_a_multichannel_frame() {
        let format = SourceFormat {
            sample_rate: 8_000,
            channels: 2,
        };
        let parts = create_realtime_ring(format, 1).unwrap();
        let mut source = vec![0.1; 16_002];
        source[16_001] = 0.2;
        let peak = parts.sink.push_f32(&source);
        assert_eq!(peak, 67, "dropped samples must not affect activity");
        assert_eq!(parts.overrun_samples.load(Ordering::Relaxed), 2);
        assert_eq!(parts.consumer.occupied_len() % 2, 0);
    }
}
