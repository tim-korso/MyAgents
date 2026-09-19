//! Platform capture adapters behind one RecordingManager-owned contract.

use super::timing::CaptureTimePoint;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, SupportedStreamConfig};
use myagents_media_worker_protocol::record_timeline::CaptureTimeQuality;
use serde::{Deserialize, Serialize};
use std::any::Any;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

use super::audio::{RealtimeTrackSink, SourceFormat};
use crate::record::AudioTrackKind;
#[cfg(target_os = "linux")]
use crate::ulog_warn;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSelection {
    pub microphone: bool,
    pub system: bool,
}

impl Default for CaptureSelection {
    fn default() -> Self {
        Self {
            microphone: true,
            system: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSource {
    pub track: AudioTrackKind,
    pub label: String,
    pub format: CaptureFormat,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

impl From<SourceFormat> for CaptureFormat {
    fn from(value: SourceFormat) -> Self {
        Self {
            sample_rate: value.sample_rate,
            channels: value.channels,
        }
    }
}

impl From<CaptureFormat> for SourceFormat {
    fn from(value: CaptureFormat) -> Self {
        Self {
            sample_rate: value.sample_rate,
            channels: value.channels,
        }
    }
}

#[derive(Clone)]
pub struct CapturePlan {
    pub sources: Vec<PreparedSource>,
    pub warnings: Vec<String>,
    token: Arc<dyn Any + Send + Sync>,
}

impl std::fmt::Debug for CapturePlan {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CapturePlan")
            .field("sources", &self.sources)
            .field("warnings", &self.warnings)
            .finish_non_exhaustive()
    }
}

impl CapturePlan {
    #[cfg(test)]
    pub fn for_test(sources: Vec<PreparedSource>) -> Self {
        Self {
            sources,
            warnings: Vec::new(),
            token: Arc::new(()),
        }
    }
}

#[derive(Debug, Clone)]
pub enum CaptureEvent {
    DeviceGap { track: AudioTrackKind, code: String },
    Fatal { track: AudioTrackKind, code: String },
}

#[derive(Clone)]
pub struct CaptureSinks {
    pub microphone: Option<CaptureTrackSink>,
    pub system: Option<CaptureTrackSink>,
}

/// Lightweight UI projection of the latest capture-buffer peak. The archive
/// and analysis sinks remain authoritative for audio; this meter only exposes
/// whether an admitted source is currently producing samples.
#[derive(Clone, Default)]
pub(crate) struct CaptureActivity {
    level_percent: Arc<AtomicU8>,
}

impl CaptureActivity {
    pub(crate) fn level_percent(&self) -> u8 {
        self.level_percent.load(Ordering::Relaxed)
    }

    fn set_level_percent(&self, level_percent: u8) {
        self.level_percent.store(level_percent, Ordering::Relaxed);
    }
}

/// The capture callback has one bounded fan-out point. Archive delivery is
/// always attempted first because the durable recording remains authoritative;
/// live analysis may fail independently without degrading the archive.
#[derive(Clone)]
pub struct CaptureTrackSink {
    archive: RealtimeTrackSink,
    analysis: Option<RealtimeTrackSink>,
    activity: CaptureActivity,
    enabled: Arc<AtomicBool>,
    clock: Arc<Mutex<CaptureClockEpoch>>,
}

#[derive(Default)]
struct CaptureClockEpoch {
    started: Option<Instant>,
    media_sample: u64,
    epoch: u64,
}

impl CaptureTrackSink {
    pub fn new(archive: RealtimeTrackSink, analysis: Option<RealtimeTrackSink>) -> Self {
        Self {
            archive,
            analysis,
            activity: CaptureActivity::default(),
            enabled: Arc::new(AtomicBool::new(true)),
            clock: Arc::new(Mutex::new(CaptureClockEpoch::default())),
        }
    }

    pub(crate) fn timeline(
        &self,
    ) -> Result<Option<myagents_media_worker_protocol::record_timeline::RecordTrackTimeline>, String>
    {
        self.archive.capture_timeline()
    }

    pub(crate) fn set_media_epoch(&self, started: Option<Instant>, media_ms: u64) {
        if let Ok(mut clock) = self.clock.lock() {
            clock.started = started;
            clock.media_sample = media_ms.saturating_mul(16);
            clock.epoch = clock.epoch.saturating_add(1);
        }
    }

    fn capture_time(
        &self,
        captured: Option<Instant>,
        frames: usize,
    ) -> Option<(
        std::sync::MutexGuard<'_, CaptureClockEpoch>,
        CaptureTimePoint,
        usize,
    )> {
        let clock = self.clock.try_lock().ok()?;
        let started = clock.started?;
        let sample_rate = u128::from(self.archive.source_format().sample_rate);
        let (elapsed, quality, skipped_frames) = match captured {
            Some(at) if at < started => {
                // Capture timestamps refer to the first frame. A delayed
                // pre-pause buffer is outside this admission epoch; retain only
                // complete frames at/after resume, without losing their onset.
                let skipped =
                    (started.duration_since(at).as_nanos() * sample_rate).div_ceil(1_000_000_000);
                if skipped >= frames as u128 {
                    return None;
                }
                let offset =
                    Duration::from_nanos((skipped * 1_000_000_000).div_ceil(sample_rate) as u64);
                (
                    (at + offset).duration_since(started),
                    CaptureTimeQuality::Clock,
                    skipped as usize,
                )
            }
            Some(at) => (at.duration_since(started), CaptureTimeQuality::Clock, 0),
            None => (started.elapsed(), CaptureTimeQuality::Estimated, 0),
        };
        let time = CaptureTimePoint {
            record_sample: clock
                .media_sample
                .saturating_add((elapsed.as_nanos() * 16_000 / 1_000_000_000) as u64),
            quality,
            epoch: clock.epoch,
        };
        Some((clock, time, skipped_frames))
    }

    pub(crate) fn activity(&self) -> CaptureActivity {
        self.activity.clone()
    }

    pub(crate) fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    pub(crate) fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
        if !enabled {
            self.activity.set_level_percent(0);
        }
    }

    #[cfg(test)]
    pub(crate) fn push_f32(&self, samples: &[f32]) {
        self.push_f32_captured(samples, None);
    }

    fn push_f32_captured(&self, samples: &[f32], captured: Option<Instant>) {
        // Hold the existing epoch owner across both deliveries. Pause cannot
        // split one physical callback between archive and analysis generations.
        let channels = usize::from(self.archive.source_format().channels);
        let Some((_epoch, time, skipped)) = self.capture_time(captured, samples.len() / channels)
        else {
            return;
        };
        let samples = &samples[skipped * channels..];
        let time = Some(time);
        if !self.enabled() {
            self.activity.set_level_percent(0);
            self.archive.push_silence_at(
                samples.len(),
                time.map(|mut time| {
                    time.quality = CaptureTimeQuality::Gap;
                    time
                }),
            );
            if let Some(analysis) = self.analysis.as_ref() {
                analysis.push_silence_at(
                    samples.len(),
                    time.map(|mut time| {
                        time.quality = CaptureTimeQuality::Gap;
                        time
                    }),
                );
            }
            return;
        }
        self.activity
            .set_level_percent(self.archive.push_f32_at(samples, time));
        if let Some(analysis) = self.analysis.as_ref() {
            let _ = analysis.push_f32_at(samples, time);
        }
    }

    fn push_i16_captured(&self, samples: &[i16], captured: Option<Instant>) {
        // Hold the existing epoch owner across both deliveries. Pause cannot
        // split one physical callback between archive and analysis generations.
        let channels = usize::from(self.archive.source_format().channels);
        let Some((_epoch, time, skipped)) = self.capture_time(captured, samples.len() / channels)
        else {
            return;
        };
        let samples = &samples[skipped * channels..];
        let time = Some(time);
        if !self.enabled() {
            self.activity.set_level_percent(0);
            self.archive.push_silence_at(
                samples.len(),
                time.map(|mut time| {
                    time.quality = CaptureTimeQuality::Gap;
                    time
                }),
            );
            if let Some(analysis) = self.analysis.as_ref() {
                analysis.push_silence_at(
                    samples.len(),
                    time.map(|mut time| {
                        time.quality = CaptureTimeQuality::Gap;
                        time
                    }),
                );
            }
            return;
        }
        self.activity
            .set_level_percent(self.archive.push_i16_at(samples, time));
        if let Some(analysis) = self.analysis.as_ref() {
            let _ = analysis.push_i16_at(samples, time);
        }
    }

    fn push_i32_captured(&self, samples: &[i32], captured: Option<Instant>) {
        // Hold the existing epoch owner across both deliveries. Pause cannot
        // split one physical callback between archive and analysis generations.
        let channels = usize::from(self.archive.source_format().channels);
        let Some((_epoch, time, skipped)) = self.capture_time(captured, samples.len() / channels)
        else {
            return;
        };
        let samples = &samples[skipped * channels..];
        let time = Some(time);
        if !self.enabled() {
            self.activity.set_level_percent(0);
            self.archive.push_silence_at(
                samples.len(),
                time.map(|mut time| {
                    time.quality = CaptureTimeQuality::Gap;
                    time
                }),
            );
            if let Some(analysis) = self.analysis.as_ref() {
                analysis.push_silence_at(
                    samples.len(),
                    time.map(|mut time| {
                        time.quality = CaptureTimeQuality::Gap;
                        time
                    }),
                );
            }
            return;
        }
        self.activity
            .set_level_percent(self.archive.push_i32_at(samples, time));
        if let Some(analysis) = self.analysis.as_ref() {
            let _ = analysis.push_i32_at(samples, time);
        }
    }

    fn push_i8_captured(&self, samples: &[i8], captured: Option<Instant>) {
        // Hold the existing epoch owner across both deliveries. Pause cannot
        // split one physical callback between archive and analysis generations.
        let channels = usize::from(self.archive.source_format().channels);
        let Some((_epoch, time, skipped)) = self.capture_time(captured, samples.len() / channels)
        else {
            return;
        };
        let samples = &samples[skipped * channels..];
        let time = Some(time);
        if !self.enabled() {
            self.activity.set_level_percent(0);
            self.archive.push_silence_at(
                samples.len(),
                time.map(|mut time| {
                    time.quality = CaptureTimeQuality::Gap;
                    time
                }),
            );
            if let Some(analysis) = self.analysis.as_ref() {
                analysis.push_silence_at(
                    samples.len(),
                    time.map(|mut time| {
                        time.quality = CaptureTimeQuality::Gap;
                        time
                    }),
                );
            }
            return;
        }
        self.activity
            .set_level_percent(self.archive.push_i8_at(samples, time));
        if let Some(analysis) = self.analysis.as_ref() {
            let _ = analysis.push_i8_at(samples, time);
        }
    }

    #[cfg(target_os = "macos")]
    fn push_planar_f32_captured(&self, planes: &[&[f32]], captured: Option<Instant>) {
        // Hold the existing epoch owner across both deliveries. Pause cannot
        // split one physical callback between archive and analysis generations.
        let channels = usize::from(self.archive.source_format().channels);
        if planes.len() != channels {
            return;
        }
        let frames = planes.iter().map(|plane| plane.len()).min().unwrap_or(0);
        let Some((_epoch, time, skipped)) = self.capture_time(captured, frames) else {
            return;
        };
        // SourceFormat caps channels at 32. Slice on the stack so capture
        // callbacks never allocate while clipping the epoch boundary.
        let mut remaining = [&[][..]; 32];
        for (target, plane) in remaining.iter_mut().zip(planes) {
            *target = &plane[skipped..frames];
        }
        let planes = &remaining[..channels];
        let time = Some(time);
        let sample_count = planes.iter().map(|plane| plane.len()).min().unwrap_or(0) * planes.len();
        if !self.enabled() {
            self.activity.set_level_percent(0);
            self.archive.push_silence_at(
                sample_count,
                time.map(|mut time| {
                    time.quality = CaptureTimeQuality::Gap;
                    time
                }),
            );
            if let Some(analysis) = self.analysis.as_ref() {
                analysis.push_silence_at(
                    sample_count,
                    time.map(|mut time| {
                        time.quality = CaptureTimeQuality::Gap;
                        time
                    }),
                );
            }
            return;
        }
        self.activity
            .set_level_percent(self.archive.push_planar_f32_at(planes, time));
        if let Some(analysis) = self.analysis.as_ref() {
            let _ = analysis.push_planar_f32_at(planes, time);
        }
    }
}

pub trait CaptureSession: Send {
    fn pause(&mut self) -> Result<(), String>;
    fn resume(&mut self) -> Result<(), String>;
    fn stop(&mut self) -> Result<(), String>;
}

pub trait CaptureBackend: Send + Sync {
    fn preflight(&self, selection: CaptureSelection) -> Result<CapturePlan, String>;
    fn open(
        &self,
        plan: &CapturePlan,
        sinks: CaptureSinks,
        events: mpsc::UnboundedSender<CaptureEvent>,
    ) -> Result<Box<dyn CaptureSession>, String>;
}

#[derive(Default)]
pub struct PlatformCaptureBackend;

#[derive(Clone)]
struct PlatformPlan {
    microphone: Option<CpalEndpoint>,
    #[cfg(not(target_os = "macos"))]
    system: Option<CpalEndpoint>,
    #[cfg(target_os = "macos")]
    system_display_id: Option<u32>,
}

#[derive(Clone)]
struct CpalEndpoint {
    device_id: String,
    config: SupportedStreamConfig,
    track: AudioTrackKind,
}

impl CaptureBackend for PlatformCaptureBackend {
    fn preflight(&self, selection: CaptureSelection) -> Result<CapturePlan, String> {
        if !selection.microphone && !selection.system {
            return Err("at least one recording source must be selected".to_string());
        }
        #[cfg(target_os = "macos")]
        {
            if selection.microphone {
                ensure_macos_microphone_access()?;
            }
            if selection.system {
                ensure_macos_screen_capture_access()?;
            }
        }
        let host = capture_host()?;
        let microphone = if selection.microphone {
            let device = host
                .default_input_device()
                .ok_or_else(|| "RECORDING_MICROPHONE_UNAVAILABLE".to_string())?;
            Some(cpal_endpoint(&device, AudioTrackKind::Microphone, false)?)
        } else {
            None
        };

        #[cfg(target_os = "macos")]
        let (system_display_id, system_source) = if selection.system {
            use screencapturekit::prelude::SCShareableContent;
            let content = SCShareableContent::get()
                .map_err(|error| format!("RECORDING_SYSTEM_AUDIO_UNAVAILABLE {error}"))?;
            let display = content
                .displays()
                .into_iter()
                .next()
                .ok_or_else(|| "RECORDING_SYSTEM_AUDIO_UNAVAILABLE".to_string())?;
            (
                Some(display.display_id()),
                Some(PreparedSource {
                    track: AudioTrackKind::System,
                    label: "macOS system audio".to_string(),
                    format: CaptureFormat {
                        sample_rate: 48_000,
                        channels: 2,
                    },
                }),
            )
        } else {
            (None, None)
        };

        #[cfg(all(not(target_os = "macos"), not(target_os = "linux")))]
        let (system, system_source) = if selection.system {
            let device = system_capture_device(&host)?;
            let endpoint = cpal_endpoint(&device, AudioTrackKind::System, true)?;
            let source = prepared_source(&device, &endpoint)?;
            (Some(endpoint), Some(source))
        } else {
            (None, None)
        };

        #[cfg(target_os = "linux")]
        let mut warnings = Vec::new();
        #[cfg(not(target_os = "linux"))]
        let warnings = Vec::new();

        #[cfg(target_os = "linux")]
        let (system, system_source) = if selection.system {
            match system_capture_device(&host).and_then(|device| {
                let endpoint = cpal_endpoint(&device, AudioTrackKind::System, true)?;
                let source = prepared_source(&device, &endpoint)?;
                Ok((endpoint, source))
            }) {
                Ok((endpoint, source)) => (Some(endpoint), Some(source)),
                Err(error) => {
                    ulog_warn!(
                        "[recording] PipeWire system audio unavailable; continuing microphone-only: {}",
                        error
                    );
                    warnings.push("RECORDING_SYSTEM_AUDIO_UNAVAILABLE".to_string());
                    (None, None)
                }
            }
        } else {
            (None, None)
        };

        let mut sources = Vec::new();
        if let Some(endpoint) = microphone.as_ref() {
            let device = resolve_device(&host, &endpoint.device_id)?;
            sources.push(prepared_source(&device, endpoint)?);
        }
        if let Some(source) = system_source {
            sources.push(source);
        }
        if sources.is_empty() {
            return Err("RECORDING_NO_AVAILABLE_SOURCE".to_string());
        }
        Ok(CapturePlan {
            sources,
            warnings,
            token: Arc::new(PlatformPlan {
                microphone,
                #[cfg(not(target_os = "macos"))]
                system,
                #[cfg(target_os = "macos")]
                system_display_id,
            }),
        })
    }

    fn open(
        &self,
        plan: &CapturePlan,
        sinks: CaptureSinks,
        events: mpsc::UnboundedSender<CaptureEvent>,
    ) -> Result<Box<dyn CaptureSession>, String> {
        let token = plan
            .token
            .downcast_ref::<PlatformPlan>()
            .ok_or_else(|| "capture plan/backend mismatch".to_string())?;
        let host = capture_host()?;
        let mut streams = Vec::new();
        if let Some(endpoint) = token.microphone.as_ref() {
            let sink = sinks
                .microphone
                .ok_or_else(|| "microphone archive sink missing".to_string())?;
            streams.push(open_cpal_stream(&host, endpoint, sink, events.clone())?);
        }

        #[cfg(not(target_os = "macos"))]
        if let Some(endpoint) = token.system.as_ref() {
            let sink = sinks
                .system
                .ok_or_else(|| "system archive sink missing".to_string())?;
            streams.push(open_cpal_stream(&host, endpoint, sink, events.clone())?);
        }

        #[cfg(target_os = "macos")]
        let screen_stream = if let Some(display_id) = token.system_display_id {
            let sink = sinks
                .system
                .ok_or_else(|| "system archive sink missing".to_string())?;
            Some(open_macos_system_stream(display_id, sink, events.clone())?)
        } else {
            None
        };

        for stream in &streams {
            stream
                .play()
                .map_err(|error| format!("start capture stream: {error}"))?;
        }
        #[cfg(target_os = "macos")]
        if let Some(stream) = screen_stream.as_ref() {
            stream
                .start_capture()
                .map_err(|error| format!("start system audio capture: {error}"))?;
        }
        Ok(Box::new(PlatformCaptureSession {
            streams,
            #[cfg(target_os = "macos")]
            screen_stream,
            state: CaptureRunState::Running,
        }))
    }
}

#[cfg(target_os = "macos")]
fn ensure_macos_microphone_access() -> Result<(), String> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};

    let media_type = unsafe { AVMediaTypeAudio }
        .ok_or_else(|| "RECORDING_MICROPHONE_UNAVAILABLE".to_string())?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    let granted = microphone_access_granted(status, || {
        // Apple invokes this callback on an arbitrary queue. Preflight already
        // runs on spawn_blocking, so waiting here keeps both the UI thread and
        // audio callbacks free while retaining the Objective-C block.
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let completion = RcBlock::new(move |granted: Bool| {
            let _ = sender.send(granted.as_bool());
        });
        unsafe {
            AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &completion);
        }
        receiver.recv().unwrap_or(false)
    });
    granted
        .then_some(())
        .ok_or_else(|| "RECORDING_MICROPHONE_PERMISSION_REQUIRED".to_string())
}

#[cfg(target_os = "macos")]
fn microphone_access_granted(
    status: objc2_av_foundation::AVAuthorizationStatus,
    request: impl FnOnce() -> bool,
) -> bool {
    use objc2_av_foundation::AVAuthorizationStatus;

    match status {
        AVAuthorizationStatus::Authorized => true,
        AVAuthorizationStatus::NotDetermined => request(),
        AVAuthorizationStatus::Denied | AVAuthorizationStatus::Restricted => false,
        _ => false,
    }
}

#[cfg(target_os = "macos")]
fn ensure_macos_screen_capture_access() -> Result<(), String> {
    let access = core_graphics::access::ScreenCaptureAccess;
    request_access_when_missing(|| access.preflight(), || access.request())
        .then_some(())
        .ok_or_else(|| "RECORDING_SCREEN_PERMISSION_REQUIRED".to_string())
}

#[cfg(target_os = "macos")]
fn request_access_when_missing(
    preflight: impl FnOnce() -> bool,
    request: impl FnOnce() -> bool,
) -> bool {
    preflight() || request()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CaptureRunState {
    Running,
    Paused,
    Stopped,
}

impl CaptureRunState {
    fn begin_stop(&mut self) -> bool {
        let stop_running_devices = *self == Self::Running;
        *self = Self::Stopped;
        stop_running_devices
    }
}

struct PlatformCaptureSession {
    streams: Vec<cpal::Stream>,
    #[cfg(target_os = "macos")]
    screen_stream: Option<screencapturekit::stream::SCStream>,
    state: CaptureRunState,
}

impl CaptureSession for PlatformCaptureSession {
    fn pause(&mut self) -> Result<(), String> {
        if self.state != CaptureRunState::Running {
            return Ok(());
        }
        for stream in &self.streams {
            stream
                .pause()
                .map_err(|error| format!("pause capture stream: {error}"))?;
        }
        #[cfg(target_os = "macos")]
        if let Some(stream) = self.screen_stream.as_ref() {
            stream
                .stop_capture()
                .map_err(|error| format!("pause system audio capture: {error}"))?;
        }
        self.state = CaptureRunState::Paused;
        Ok(())
    }

    fn resume(&mut self) -> Result<(), String> {
        if self.state == CaptureRunState::Stopped {
            return Err("capture session already stopped".to_string());
        }
        if self.state == CaptureRunState::Running {
            return Ok(());
        }
        // If restarting only partially succeeds, settlement must still try to
        // stop every device that may have resumed.
        self.state = CaptureRunState::Running;
        for stream in &self.streams {
            stream
                .play()
                .map_err(|error| format!("resume capture stream: {error}"))?;
        }
        #[cfg(target_os = "macos")]
        if let Some(stream) = self.screen_stream.as_ref() {
            stream
                .start_capture()
                .map_err(|error| format!("resume system audio capture: {error}"))?;
        }
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        if !self.state.begin_stop() {
            return Ok(());
        }
        let mut failures = Vec::new();
        for stream in &self.streams {
            if let Err(error) = stream.pause() {
                failures.push(format!("stop capture stream: {error}"));
            }
        }
        #[cfg(target_os = "macos")]
        if let Some(stream) = self.screen_stream.as_ref() {
            if let Err(error) = stream.stop_capture() {
                failures.push(format!("stop system audio capture: {error}"));
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    }
}

#[cfg(test)]
mod capture_sink_tests {
    use super::{CaptureRunState, CaptureTrackSink};
    use crate::recording::audio::{create_realtime_ring, SourceFormat};

    #[test]
    fn resume_admits_only_samples_captured_in_the_current_epoch() {
        use std::time::{Duration, Instant};
        let format = SourceFormat {
            sample_rate: 16_000,
            channels: 2,
        };
        let mut archive = create_realtime_ring(format, 1).unwrap();
        let mut analysis = create_realtime_ring(format, 1).unwrap();
        let sink = CaptureTrackSink::new(archive.sink.clone(), Some(analysis.sink.clone()));
        let resumed = Instant::now();
        sink.set_media_epoch(None, 2_000);
        sink.push_f32_captured(&[0.9; 8], Some(resumed));
        sink.set_media_epoch(Some(resumed), 2_000);
        // A queued pre-pause buffer cannot become current estimated audio.
        sink.push_f32_captured(&[0.8; 8], Some(resumed - Duration::from_secs(1)));
        // Keep the two stereo frames at/after resume, including the onset.
        sink.push_f32_captured(
            &[0.7, 0.7, 0.6, 0.6, 0.5, 0.4, 0.3, 0.2],
            Some(resumed - Duration::from_micros(125)),
        );
        for consumer in [&mut archive.consumer, &mut analysis.consumer] {
            let mut actual = [0.0; 32];
            let count = consumer.pop_slice(&mut actual);
            assert_eq!(&actual[..count], &[0.5, 0.4, 0.3, 0.2]);
        }
        let timeline = sink.timeline().unwrap().unwrap();
        assert_eq!(timeline.spans[0].record_start, 32_000);
        assert_eq!(timeline.spans[0].source_end, 2);
        assert_eq!(
            timeline.spans[0].quality,
            myagents_media_worker_protocol::record_timeline::CaptureTimeQuality::Clock
        );
    }

    #[test]
    fn disabled_source_writes_silence_without_shortening_its_timeline() {
        let format = SourceFormat {
            sample_rate: 48_000,
            channels: 1,
        };
        let mut archive = create_realtime_ring(format, 1).unwrap();
        let analysis = create_realtime_ring(format, 1).unwrap();
        let sink = CaptureTrackSink::new(archive.sink.clone(), Some(analysis.sink));
        sink.set_media_epoch(Some(std::time::Instant::now()), 0);

        sink.push_f32(&[0.5; 4]);
        sink.set_enabled(false);
        sink.push_f32(&[0.8; 4]);

        let mut samples = [0.0; 8];
        assert_eq!(archive.consumer.pop_slice(&mut samples), samples.len());
        assert_eq!(&samples[..4], &[0.5; 4]);
        assert_eq!(&samples[4..], &[0.0; 4]);
        assert_eq!(sink.activity().level_percent(), 0);
    }

    #[test]
    fn stopping_a_paused_session_does_not_stop_platform_streams_twice() {
        let mut state = CaptureRunState::Paused;
        assert!(!state.begin_stop());
        assert_eq!(state, CaptureRunState::Stopped);
        assert!(!state.begin_stop());
    }
}

fn capture_host() -> Result<cpal::Host, String> {
    #[cfg(target_os = "linux")]
    {
        cpal::host_from_id(cpal::HostId::PipeWire)
            .map_err(|error| format!("RECORDING_PIPEWIRE_UNAVAILABLE: {error}"))
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(cpal::default_host())
    }
}

#[cfg(not(target_os = "macos"))]
fn system_capture_device(host: &cpal::Host) -> Result<Device, String> {
    #[cfg(target_os = "windows")]
    {
        host.default_output_device()
            .ok_or_else(|| "RECORDING_SYSTEM_AUDIO_UNAVAILABLE".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        host.devices()
            .map_err(|error| format!("probe PipeWire nodes: {error}"))?
            .find(|device| {
                device.description().is_ok_and(|description| {
                    description.name() == "default_sink" && description.supports_input()
                })
            })
            .ok_or_else(|| "RECORDING_PIPEWIRE_MONITOR_UNAVAILABLE".to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = host;
        Err("RECORDING_SYSTEM_AUDIO_UNAVAILABLE".to_string())
    }
}

fn cpal_endpoint(
    device: &Device,
    track: AudioTrackKind,
    loopback: bool,
) -> Result<CpalEndpoint, String> {
    let config = if loopback && cfg!(target_os = "windows") {
        device.default_output_config()
    } else {
        device.default_input_config()
    }
    .map_err(|error| format!("probe {track:?} capture format: {error}"))?;
    if !matches!(
        config.sample_format(),
        SampleFormat::I8 | SampleFormat::I16 | SampleFormat::I32 | SampleFormat::F32
    ) {
        return Err(format!(
            "unsupported {track:?} capture sample format: {}",
            config.sample_format()
        ));
    }
    Ok(CpalEndpoint {
        device_id: device
            .id()
            .map_err(|error| format!("read capture device identity: {error}"))?
            .to_string(),
        config,
        track,
    })
}

fn prepared_source(device: &Device, endpoint: &CpalEndpoint) -> Result<PreparedSource, String> {
    Ok(PreparedSource {
        track: endpoint.track,
        label: device
            .description()
            .map_err(|error| format!("read capture device description: {error}"))?
            .name()
            .to_string(),
        format: CaptureFormat {
            sample_rate: endpoint.config.sample_rate(),
            channels: endpoint.config.channels(),
        },
    })
}

fn resolve_device(host: &cpal::Host, id: &str) -> Result<Device, String> {
    let id = id
        .parse()
        .map_err(|error| format!("parse capture device identity: {error}"))?;
    host.device_by_id(&id)
        .ok_or_else(|| "RECORDING_DEVICE_CHANGED".to_string())
}

fn open_cpal_stream(
    host: &cpal::Host,
    endpoint: &CpalEndpoint,
    sink: CaptureTrackSink,
    events: mpsc::UnboundedSender<CaptureEvent>,
) -> Result<cpal::Stream, String> {
    let device = resolve_device(host, &endpoint.device_id)?;
    let config = endpoint.config.into();
    let track = endpoint.track;
    let error_events = events.clone();
    let error_callback = move |error: cpal::Error| {
        let code = format!("CPAL_{:?}", error.kind()).to_ascii_uppercase();
        let event = match error.kind() {
            // CPAL streams recover from bounded XRuns in place; keep the
            // explicit gap in lifecycle without tearing down a healthy stream.
            cpal::ErrorKind::Xrun => CaptureEvent::DeviceGap { track, code },
            // This backend freezes exact device identity at admission and has
            // no truthful way to hot-adopt a replacement device.
            cpal::ErrorKind::DeviceChanged => CaptureEvent::Fatal { track, code },
            _ => CaptureEvent::Fatal { track, code },
        };
        let _ = error_events.send(event);
    };
    let mut capture_clock = CpalCaptureClock::default();
    match endpoint.config.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            config,
            move |data: &[f32], info| {
                sink.push_f32_captured(data, capture_clock.map(info.timestamp(), Instant::now()))
            },
            error_callback,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            config,
            move |data: &[i16], info| {
                sink.push_i16_captured(data, capture_clock.map(info.timestamp(), Instant::now()))
            },
            error_callback,
            None,
        ),
        SampleFormat::I32 => device.build_input_stream(
            config,
            move |data: &[i32], info| {
                sink.push_i32_captured(data, capture_clock.map(info.timestamp(), Instant::now()))
            },
            error_callback,
            None,
        ),
        SampleFormat::I8 => device.build_input_stream(
            config,
            move |data: &[i8], info| {
                sink.push_i8_captured(data, capture_clock.map(info.timestamp(), Instant::now()))
            },
            error_callback,
            None,
        ),
        _ => return Err("unsupported capture sample format".to_string()),
    }
    .map_err(|error| {
        if track == AudioTrackKind::Microphone && error.kind() == cpal::ErrorKind::PermissionDenied
        {
            "RECORDING_MICROPHONE_PERMISSION_REQUIRED".to_string()
        } else {
            format!("open {track:?} capture stream: {error}")
        }
    })
}

#[cfg(target_os = "macos")]
fn open_macos_system_stream(
    display_id: u32,
    sink: CaptureTrackSink,
    events: mpsc::UnboundedSender<CaptureEvent>,
) -> Result<screencapturekit::stream::SCStream, String> {
    use screencapturekit::prelude::*;

    struct Delegate {
        events: mpsc::UnboundedSender<CaptureEvent>,
    }
    impl SCStreamDelegateTrait for Delegate {
        fn did_stop_with_error(&self, error: SCError) {
            let _ = self.events.send(CaptureEvent::Fatal {
                track: AudioTrackKind::System,
                code: format!("SCREEN_CAPTURE_KIT_{error}"),
            });
        }
    }

    let content =
        SCShareableContent::get().map_err(|error| format!("refresh shareable content: {error}"))?;
    let display = content
        .displays()
        .into_iter()
        .find(|display| display.display_id() == display_id)
        .ok_or_else(|| "RECORDING_DISPLAY_CHANGED".to_string())?;
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();
    let frame_interval = CMTime::new(1, 1);
    let config = SCStreamConfiguration::new()
        .with_width(2)
        .with_height(2)
        .with_minimum_frame_interval(&frame_interval)
        .with_captures_audio(true)
        .with_excludes_current_process_audio(true)
        .with_sample_rate(48_000)
        .with_channel_count(2);
    let mut stream = SCStream::new_with_delegate(
        &filter,
        &config,
        Delegate {
            events: events.clone(),
        },
    );
    let malformed_reported = Arc::new(AtomicBool::new(false));
    stream.add_output_handler(
        move |sample: CMSampleBuffer, output_type: SCStreamOutputType| {
            if output_type != SCStreamOutputType::Audio {
                return;
            }
            let captured = macos_capture_time(&sample);
            let valid_format = sample.format_description().is_some_and(|format| {
                format.audio_is_float()
                    && !format.audio_is_big_endian()
                    && format.audio_bits_per_channel() == Some(32)
                    && format.audio_channel_count() == Some(2)
                    && format.audio_sample_rate() == Some(48_000.0)
            });
            let Some(buffers) = sample.audio_buffer_list() else {
                report_malformed_sck(&events, &malformed_reported);
                return;
            };
            if !valid_format {
                report_malformed_sck(&events, &malformed_reported);
                return;
            }
            match buffers.num_buffers() {
                1 => {
                    let Some(buffer) = buffers.get(0) else {
                        return;
                    };
                    let bytes = buffer.data();
                    let (prefix, samples, suffix) = unsafe { bytes.align_to::<f32>() };
                    if prefix.is_empty() && suffix.is_empty() && buffer.number_channels == 2 {
                        sink.push_f32_captured(samples, captured);
                    } else {
                        report_malformed_sck(&events, &malformed_reported);
                    }
                }
                2 => {
                    let (Some(left), Some(right)) = (buffers.get(0), buffers.get(1)) else {
                        return;
                    };
                    let (left_prefix, left_samples, left_suffix) =
                        unsafe { left.data().align_to::<f32>() };
                    let (right_prefix, right_samples, right_suffix) =
                        unsafe { right.data().align_to::<f32>() };
                    if left_prefix.is_empty()
                        && left_suffix.is_empty()
                        && right_prefix.is_empty()
                        && right_suffix.is_empty()
                        && left.number_channels == 1
                        && right.number_channels == 1
                    {
                        sink.push_planar_f32_captured(&[left_samples, right_samples], captured);
                    } else {
                        report_malformed_sck(&events, &malformed_reported);
                    }
                }
                _ => report_malformed_sck(&events, &malformed_reported),
            }
        },
        SCStreamOutputType::Audio,
    );
    Ok(stream)
}

#[cfg(target_os = "macos")]
fn report_malformed_sck(events: &mpsc::UnboundedSender<CaptureEvent>, reported: &AtomicBool) {
    if !reported.swap(true, Ordering::AcqRel) {
        let _ = events.send(CaptureEvent::Fatal {
            track: AudioTrackKind::System,
            code: "SCREEN_CAPTURE_KIT_UNEXPECTED_AUDIO_FORMAT".to_string(),
        });
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{microphone_access_granted, request_access_when_missing};
    use objc2_av_foundation::AVAuthorizationStatus;
    use std::cell::Cell;

    #[test]
    fn screen_capture_access_requests_only_when_preflight_is_missing() {
        let request_called = Cell::new(false);
        assert!(request_access_when_missing(
            || true,
            || {
                request_called.set(true);
                false
            }
        ));
        assert!(!request_called.get());

        assert!(request_access_when_missing(|| false, || true));
        assert!(!request_access_when_missing(|| false, || false));
    }

    #[test]
    fn microphone_access_requests_only_when_not_determined() {
        let request_called = Cell::new(false);
        assert!(microphone_access_granted(
            AVAuthorizationStatus::Authorized,
            || {
                request_called.set(true);
                false
            }
        ));
        assert!(!request_called.get());

        assert!(microphone_access_granted(
            AVAuthorizationStatus::NotDetermined,
            || true
        ));
        assert!(!microphone_access_granted(
            AVAuthorizationStatus::NotDetermined,
            || false
        ));
        assert!(!microphone_access_granted(
            AVAuthorizationStatus::Denied,
            || {
                request_called.set(true);
                true
            }
        ));
        assert!(!request_called.get());
        assert!(!microphone_access_granted(
            AVAuthorizationStatus::Restricted,
            || true
        ));
    }
}

/// One calibration per device stream; timestamps within a stream share a
/// monotonic clock. Callback arrival is only an initial cross-clock anchor.
#[derive(Default)]
struct CpalCaptureClock {
    anchor: Option<(cpal::StreamInstant, Instant)>,
}

impl CpalCaptureClock {
    fn map(&mut self, timestamp: cpal::InputStreamTimestamp, now: Instant) -> Option<Instant> {
        let latency = timestamp
            .callback
            .checked_duration_since(timestamp.capture)?;
        (latency <= Duration::from_secs(10)).then_some(())?;
        let (source, local) = match self.anchor {
            Some(anchor) => anchor,
            None => {
                let anchor = (timestamp.capture, now.checked_sub(latency)?);
                self.anchor = Some(anchor);
                anchor
            }
        };
        if let Some(elapsed) = timestamp.capture.checked_duration_since(source) {
            local.checked_add(elapsed)
        } else {
            local.checked_sub(source.checked_duration_since(timestamp.capture)?)
        }
    }
}

#[cfg(test)]
mod capture_clock_tests {
    use super::*;

    fn timestamp(capture_ms: u64) -> cpal::InputStreamTimestamp {
        cpal::InputStreamTimestamp {
            capture: cpal::StreamInstant::from_millis(capture_ms),
            callback: cpal::StreamInstant::from_millis(capture_ms + 10),
        }
    }

    #[test]
    fn device_clock_ignores_callback_jitter_but_keeps_real_gaps_and_pause_time() {
        let mut clock = CpalCaptureClock::default();
        let now = Instant::now();
        let first = clock.map(timestamp(100), now).unwrap();
        for (source_ms, arrival_ms) in [(110, 25), (120, 26), (150, 80), (60_150, 60_100)] {
            let mapped = clock
                .map(
                    timestamp(source_ms),
                    now + Duration::from_millis(arrival_ms),
                )
                .unwrap();
            assert_eq!(
                mapped.duration_since(first),
                Duration::from_millis(source_ms - 100)
            );
        }
    }

    #[test]
    fn clock_anchors_belong_to_one_stream_and_invalid_readings_do_not_replace_them() {
        let now = Instant::now();
        let mut left = CpalCaptureClock::default();
        let mut right = CpalCaptureClock::default();
        let first = left.map(timestamp(100), now).unwrap();
        assert_eq!(right.map(timestamp(5_000), now), Some(first));
        let invalid = cpal::InputStreamTimestamp {
            callback: cpal::StreamInstant::ZERO,
            capture: cpal::StreamInstant::from_millis(1),
        };
        assert!(left.map(invalid, now + Duration::from_secs(1)).is_none());
        assert_eq!(
            left.map(timestamp(110), now + Duration::from_millis(90)),
            Some(first + Duration::from_millis(10))
        );
    }
}

#[cfg(target_os = "macos")]
fn macos_capture_time(sample: &screencapturekit::cm::CMSampleBuffer) -> Option<Instant> {
    use screencapturekit::cm::{CMClock, CMTime};
    // apple-cf 0.9.3 CMClock::time() is a documented placeholder returning an
    // invalid CMTime. Call the framework primitive, with the same repr(C) type.
    #[link(name = "CoreMedia", kind = "framework")]
    unsafe extern "C" {
        fn CMClockGetTime(clock: *const std::ffi::c_void) -> CMTime;
    }
    let clock = CMClock::host_time_clock();
    let now = Instant::now();
    let host_time = unsafe { CMClockGetTime(clock.as_ptr()) };
    let capture_time = sample.presentation_timestamp();
    if host_time.epoch != capture_time.epoch {
        return None;
    }
    let latency = host_time.as_seconds()? - capture_time.as_seconds()?;
    if !latency.is_finite() || !(0.0..=10.0).contains(&latency) {
        return None;
    }
    now.checked_sub(Duration::from_secs_f64(latency))
}
