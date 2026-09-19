//! Domain-owned media inference building blocks.
//!
//! The executable protocol and sherpa adapter live in this crate as they are
//! added. Keeping diarization here (instead of in the App manager) ensures the
//! exact worker generation owns all model execution state while the App keeps
//! durable job and publication authority.

pub mod attachment_audio;
mod audio_samples;
pub mod diarization;
pub mod model_pack_source;
pub mod native_adapter;
pub mod native_bundle;
pub mod record_aec;
pub mod record_live;
pub mod record_opus;
pub mod record_preprocessing;
pub mod record_resampler;
pub mod record_source;

pub use myagents_media_worker_protocol as protocol;

pub mod record_echo_evidence;
pub mod record_identity;
