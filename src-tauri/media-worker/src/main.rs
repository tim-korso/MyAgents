use myagents_media_worker::attachment_audio::{AttachmentAudioDecoder, AttachmentAudioError};
use myagents_media_worker::diarization::{
    BoundedDiarization, BoundedDiarizationConfig, DiarizationError, LocalSegment,
    SourceWindowBuffer, WindowObservation,
};
use myagents_media_worker::model_pack_source::verify_installed_pack;
use myagents_media_worker::native_adapter::{AsrEngine, VadEngine};
use myagents_media_worker::native_bundle::{LoadedNativeAdapter, verify_native_bundle};
use myagents_media_worker::protocol::record_timeline::CaptureTimeQuality;
use myagents_media_worker::protocol::{
    Checkpoint, ManagerFrame, PROTOCOL_VERSION, PcmFrame, PcmStreamCheckpoint, PcmStreamEnd,
    PcmStreamStart, RecordArtifactInput, TrackKind, WorkerCommand, WorkerMetrics, WorkerResponse,
    WorkerStage, WorkloadIdentity, WorkloadInput, WorkloadKind, read_manager_frame,
    write_control_frame,
};
use myagents_media_worker::record_live::LiveRecordAudio;
use myagents_media_worker::record_preprocessing::RecordAudioReader;
use myagents_media_worker::record_source::SourceAudioChunk;
use std::collections::VecDeque;
use std::io::{self, BufReader, BufWriter, StdinLock, StdoutLock, Write};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};
use zeroize::Zeroize;

fn main() {
    if let Err(code) = run() {
        eprintln!("myagents-media-worker terminated: {code}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), &'static str> {
    let stdout = io::stdout();
    let mut writer = BufWriter::new(stdout.lock());
    let first = {
        let stdin = io::stdin();
        let mut reader = BufReader::new(stdin.lock());
        read_manager_frame(&mut reader).map_err(|_| "SPEECH_WORKER_PROTOCOL_ERROR")?
    };
    let Some(ManagerFrame::Control(WorkerCommand::Start(start))) = first else {
        return Err("SPEECH_WORKER_PROTOCOL_ERROR");
    };
    if !start.has_valid_shape() {
        return Err("SPEECH_WORKER_PROTOCOL_ERROR");
    }
    let identity = start.identity.clone();
    if let Err(code) = run_started(start, &mut writer) {
        write_response(
            &mut writer,
            WorkerResponse::Failed {
                protocol_version: PROTOCOL_VERSION,
                identity,
                code: code.into(),
            },
        )?;
    }
    Ok(())
}

fn run_started(
    start: myagents_media_worker::protocol::StartRequest,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<(), &'static str> {
    if let (WorkloadKind::AttachmentProbe, WorkloadInput::Attachment { input_path }) =
        (&start.workload_kind, &start.input)
    {
        return run_attachment_probe(&start.identity, input_path, writer);
    }
    let current_worker =
        std::env::current_exe().map_err(|_| "SPEECH_NATIVE_RUNTIME_UNAVAILABLE")?;
    let native = verify_native_bundle(
        Path::new(&start.native_manifest_path),
        Path::new(&start.onnx_runtime_path),
        &current_worker,
    )
    .map_err(|_| "SPEECH_NATIVE_RUNTIME_UNAVAILABLE")?;
    let models = verify_installed_pack(Path::new(&start.model_pack_manifest_path))
        .map_err(|_| "SPEECH_MODEL_PACK_UNAVAILABLE")?;
    let adapter =
        LoadedNativeAdapter::load(&native).map_err(|_| "SPEECH_NATIVE_RUNTIME_UNAVAILABLE")?;
    match (&start.workload_kind, &start.input) {
        (WorkloadKind::ModelPackProbe, WorkloadInput::ModelPackProbe) => {
            run_model_pack_probe(&start.identity, &adapter, &models, writer)
        }
        (WorkloadKind::RecordLiveAsr, WorkloadInput::LivePcm { streams }) => {
            let stdin = io::stdin();
            let mut reader = BufReader::new(stdin.lock());
            run_live(
                &start.identity,
                streams,
                &adapter,
                &models,
                &mut reader,
                writer,
            )
        }
        (
            WorkloadKind::RecordBackfillAsr,
            WorkloadInput::RecordArtifacts {
                inputs,
                identity_anchors: None,
            },
        ) => run_record_backfill(&start.identity, inputs, &adapter, &models, writer),
        (
            WorkloadKind::RecordDiarization,
            WorkloadInput::RecordArtifacts {
                inputs,
                identity_anchors,
            },
        ) => run_record_diarization(
            &start.identity,
            inputs,
            identity_anchors.as_ref(),
            &adapter,
            &models,
            writer,
        ),
        (WorkloadKind::AttachmentAsr, WorkloadInput::Attachment { input_path }) => {
            run_attachment_asr(&start.identity, input_path, &adapter, &models, writer)
        }
        _ => Err("SPEECH_WORKLOAD_NOT_READY"),
    }
}

fn run_attachment_probe(
    identity: &WorkloadIdentity,
    input_path: &str,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<(), &'static str> {
    let decoder =
        AttachmentAudioDecoder::open(Path::new(input_path)).map_err(map_attachment_decode_error)?;
    let info = decoder.info();
    write_response(
        writer,
        WorkerResponse::Ready {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
        },
    )?;
    write_response(
        writer,
        WorkerResponse::MediaProbed {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            media_kind: info.media_kind.into(),
            codec: info.codec.into(),
            duration_ms: info.duration_ms,
            used_default_track: info.used_default_track,
        },
    )
}

fn run_model_pack_probe(
    identity: &WorkloadIdentity,
    adapter: &LoadedNativeAdapter,
    models: &myagents_media_worker::model_pack_source::VerifiedModelPack,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<(), &'static str> {
    {
        let _asr = adapter
            .create_asr(models)
            .map_err(|_| "SPEECH_ASR_MODEL_LOAD_FAILED")?;
    }
    {
        let _vad = adapter
            .create_vad(models)
            .map_err(|_| "SPEECH_VAD_MODEL_LOAD_FAILED")?;
    }
    {
        let _diarizer = adapter
            .create_diarizer(models)
            .map_err(|_| "SPEECH_DIARIZATION_MODEL_LOAD_FAILED")?;
    }
    write_response(
        writer,
        WorkerResponse::Ready {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
        },
    )
}

fn run_record_diarization(
    identity: &WorkloadIdentity,
    inputs: &[RecordArtifactInput],
    identity_anchors: Option<
        &myagents_media_worker::protocol::record_identity::IdentityAnchorInput,
    >,
    adapter: &LoadedNativeAdapter,
    models: &myagents_media_worker::model_pack_source::VerifiedModelPack,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<(), &'static str> {
    let started_at = Instant::now();
    let controls = start_batch_control_reader()?;
    let mut diarizer = adapter
        .create_diarizer(models)
        .map_err(|_| "SPEECH_MODEL_LOAD_FAILED")?;
    let mut checkpoints = inputs
        .iter()
        .map(|input| PcmStreamCheckpoint {
            replay_record_sample: None,
            track: input.track,
            last_ack_sequence: None,
            analysis_sample: 0,
        })
        .collect::<Vec<_>>();
    write_response(
        writer,
        WorkerResponse::Ready {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
        },
    )?;
    write_response(
        writer,
        WorkerResponse::Heartbeat {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            stage: WorkerStage::Decoding,
            checkpoint: batch_checkpoint(&checkpoints),
        },
    )?;

    let config = BoundedDiarizationConfig::default();
    let mut decoder = RecordAudioReader::open(inputs)?;
    let mut buffers = inputs
        .iter()
        .map(|input| SourceWindowBuffer::new(input.track, config))
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_diarization_error)?;
    let mut pending: Vec<Option<(WindowObservation, u64)>> = inputs.iter().map(|_| None).collect();
    let mut fusion = BoundedDiarization::new(config).map_err(map_diarization_error)?;
    let mut total_samples = 0_u64;
    let mut last_heartbeat = Instant::now();
    loop {
        let next = decoder.read_chunk()?;
        if poll_batch_control(identity, &controls, &checkpoints, writer)? {
            return Ok(());
        }
        let mut ready = Vec::new();
        if let Some(chunk) = &next {
            total_samples = total_samples.max(chunk.end_sample());
            let index = inputs
                .iter()
                .position(|input| input.track == chunk.track)
                .ok_or("SPEECH_WORKER_PROTOCOL_ERROR")?;
            ready.extend(
                buffers[index]
                    .accept(chunk)
                    .map_err(map_diarization_error)?
                    .into_iter()
                    .map(|window| (index, window)),
            );
        } else {
            for (index, buffer) in buffers.iter_mut().enumerate() {
                if let Some(window) = buffer.finish().map_err(map_diarization_error)? {
                    ready.push((index, window));
                }
            }
        }
        for (checkpoint, position) in checkpoints.iter_mut().zip(decoder.stream_positions()) {
            checkpoint.analysis_sample = position;
        }
        for (index, window) in ready {
            write_response(
                writer,
                WorkerResponse::Heartbeat {
                    protocol_version: PROTOCOL_VERSION,
                    identity: identity.clone(),
                    stage: WorkerStage::SegmentingSpeakers,
                    checkpoint: batch_checkpoint(&checkpoints),
                },
            )?;
            let mut heartbeat_error = None;
            let observation = diarizer
                .diarize_window(window.spec, &window.pcm, &window.excluded_echo, || {
                    heartbeat_error = write_response(
                        writer,
                        WorkerResponse::Heartbeat {
                            protocol_version: PROTOCOL_VERSION,
                            identity: identity.clone(),
                            stage: WorkerStage::EmbeddingSpeakers,
                            checkpoint: batch_checkpoint(&checkpoints),
                        },
                    )
                    .err();
                })
                .map_err(|_| "SPEECH_INFERENCE_FAILED")?;
            if let Some(error) = heartbeat_error {
                return Err(error);
            }
            let mut owned_start = observation.window.start_sample;
            if let Some((previous, previous_start)) = pending[index].take() {
                let end = previous.window.end_sample;
                let owned_end = if owned_start < end {
                    owned_start + (end - owned_start) / 2
                } else {
                    end
                };
                owned_start = owned_start.max(owned_end);
                fusion
                    .push(
                        previous,
                        LocalSegment {
                            start_sample: previous_start,
                            end_sample: owned_end,
                        },
                        |distances, count, threshold| {
                            adapter
                                .cluster_distances(distances, count, threshold)
                                .map_err(|_| DiarizationError::InvalidClusterLabels)
                        },
                    )
                    .map_err(map_diarization_error)?;
            }
            pending[index] = Some((observation, owned_start));
            if poll_batch_control(identity, &controls, &checkpoints, writer)? {
                return Ok(());
            }
        }
        if next.is_none() {
            break;
        }
        if last_heartbeat.elapsed() >= Duration::from_secs(2) {
            last_heartbeat = Instant::now();
            write_response(
                writer,
                WorkerResponse::Heartbeat {
                    protocol_version: PROTOCOL_VERSION,
                    identity: identity.clone(),
                    stage: WorkerStage::Decoding,
                    checkpoint: batch_checkpoint(&checkpoints),
                },
            )?;
        }
    }
    if total_samples == 0 {
        return Err("SPEECH_NO_AUDIO_TRACK");
    }
    for (observation, owned_start) in pending.into_iter().flatten() {
        let owned = LocalSegment {
            start_sample: owned_start,
            end_sample: observation.window.end_sample,
        };
        fusion
            .push(observation, owned, |distances, count, threshold| {
                adapter
                    .cluster_distances(distances, count, threshold)
                    .map_err(|_| DiarizationError::InvalidClusterLabels)
            })
            .map_err(map_diarization_error)?;
    }
    write_response(
        writer,
        WorkerResponse::Heartbeat {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            stage: WorkerStage::ClusteringSpeakers,
            checkpoint: batch_checkpoint(&checkpoints),
        },
    )?;
    let anchors = identity_anchors
        .map(myagents_media_worker::record_identity::read_anchors)
        .transpose()?;
    let mut identity_error = None;
    let projection = fusion.finish_with_identity(
        |distances, count, threshold| {
            adapter
                .cluster_distances(distances, count, threshold)
                .map_err(|_| DiarizationError::InvalidClusterLabels)
        },
        |view| {
            let Some(anchors) = &anchors else {
                return Ok(Vec::new());
            };
            let result = myagents_media_worker::record_identity::reconcile(
                anchors,
                inputs,
                view,
                |window, pcm, excluded| {
                    if poll_batch_control(identity, &controls, &checkpoints, writer)? {
                        return Err("SPEECH_INTERRUPTED");
                    }
                    write_response(
                        writer,
                        WorkerResponse::Heartbeat {
                            protocol_version: PROTOCOL_VERSION,
                            identity: identity.clone(),
                            stage: WorkerStage::ReconcilingSpeakers,
                            checkpoint: batch_checkpoint(&checkpoints),
                        },
                    )?;
                    let mut heartbeat_error = None;
                    let observation = diarizer
                        .diarize_window(window, pcm, excluded, || {
                            heartbeat_error = write_response(
                                writer,
                                WorkerResponse::Heartbeat {
                                    protocol_version: PROTOCOL_VERSION,
                                    identity: identity.clone(),
                                    stage: WorkerStage::ReconcilingSpeakers,
                                    checkpoint: batch_checkpoint(&checkpoints),
                                },
                            )
                            .err();
                        })
                        .map_err(|_| "SPEECH_INFERENCE_FAILED")?;
                    if let Some(error) = heartbeat_error {
                        return Err(error);
                    }
                    Ok(observation)
                },
            );
            result.map_err(|error| {
                identity_error = Some(error);
                DiarizationError::InvalidEmbedding
            })
        },
    );
    if let Some(error) = identity_error {
        // poll_batch_control already sent the one terminal Yielded/Failed.
        if error == "SPEECH_INTERRUPTED" {
            return Ok(());
        }
        return Err(error);
    }
    let projection = projection.map_err(map_diarization_error)?;
    let turns = projection
        .segments
        .iter()
        .map(|segment| myagents_media_worker::protocol::SpeakerTurn {
            source: segment.source,
            start_sample: segment.start_sample,
            end_sample: segment.end_sample,
            global_speaker: segment.global_speaker,
        })
        .collect::<Vec<_>>();
    let batch_count = turns.len().max(1).div_ceil(1_000);
    for batch_index in 0..batch_count {
        if poll_batch_control(identity, &controls, &checkpoints, writer)? {
            return Ok(());
        }
        let start = (batch_index * 1_000).min(turns.len());
        let end = (start + 1_000).min(turns.len());
        write_response(
            writer,
            WorkerResponse::SpeakerTurnBatch {
                protocol_version: PROTOCOL_VERSION,
                identity: identity.clone(),
                revision: 1,
                batch_index: batch_index as u32,
                is_last: batch_index + 1 == batch_count,
                turns: turns[start..end].to_vec(),
            },
        )?;
    }
    let evidence = &projection.identity_evidence;
    let batch_size = myagents_media_worker::protocol::record_identity::MAX_IDENTITY_BATCH;
    let batches = evidence.len().max(1).div_ceil(batch_size);
    for index in 0..batches {
        if poll_batch_control(identity, &controls, &checkpoints, writer)? {
            return Ok(());
        }
        let start = (index * batch_size).min(evidence.len());
        let end = (start + batch_size).min(evidence.len());
        write_response(
            writer,
            WorkerResponse::IdentityEvidenceBatch {
                protocol_version: PROTOCOL_VERSION,
                identity: identity.clone(),
                revision: 1,
                batch_index: index as u32,
                is_last: index + 1 == batches,
                evidence: evidence[start..end].to_vec(),
            },
        )?;
    }
    write_response(
        writer,
        WorkerResponse::Completed {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            metrics: WorkerMetrics {
                source_samples: total_samples,
                segments: projection.segments.len() as u32,
                speakers: projection.speaker_count,
                elapsed_ms: started_at.elapsed().as_millis() as u64,
                peak_working_bytes: None,
            },
        },
    )
}

fn run_record_backfill(
    identity: &WorkloadIdentity,
    inputs: &[RecordArtifactInput],
    adapter: &LoadedNativeAdapter,
    models: &myagents_media_worker::model_pack_source::VerifiedModelPack,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<(), &'static str> {
    let started_at = Instant::now();
    let controls = start_batch_control_reader()?;
    let mut asr = adapter
        .create_asr(models)
        .map_err(|_| "SPEECH_MODEL_LOAD_FAILED")?;
    let mut checkpoints = inputs
        .iter()
        .map(|input| PcmStreamCheckpoint {
            replay_record_sample: None,
            track: input.track,
            last_ack_sequence: None,
            analysis_sample: 0,
        })
        .collect::<Vec<_>>();
    write_response(
        writer,
        WorkerResponse::Ready {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
        },
    )?;
    write_response(
        writer,
        WorkerResponse::Heartbeat {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            stage: WorkerStage::Decoding,
            checkpoint: batch_checkpoint(&checkpoints),
        },
    )?;

    let mut revision = 0_u64;
    let mut emitted_segments = 0_u32;
    let mut source_samples = 0_u64;
    let mut decoder = RecordAudioReader::open(inputs)?;
    let mut tracks = inputs
        .iter()
        .map(|input| SourceVad::new(input.track, adapter, models))
        .collect::<Result<Vec<_>, _>>()?;
    let mut last_heartbeat_at = Instant::now();
    while let Some(chunk) = decoder.read_chunk()? {
        if poll_batch_control(identity, &controls, &checkpoints, writer)? {
            return Ok(());
        }
        source_samples = source_samples.max(chunk.end_sample());
        emitted_segments = emitted_segments.saturating_add(accept_source_chunk(
            &chunk,
            &mut tracks,
            &mut asr,
            identity,
            &mut revision,
            writer,
        )?);
        for (checkpoint, stream_position) in checkpoints.iter_mut().zip(decoder.stream_positions())
        {
            checkpoint.analysis_sample = stream_position;
        }
        if last_heartbeat_at.elapsed() >= Duration::from_secs(2) {
            last_heartbeat_at = Instant::now();
            write_response(
                writer,
                WorkerResponse::Heartbeat {
                    protocol_version: PROTOCOL_VERSION,
                    identity: identity.clone(),
                    stage: WorkerStage::Transcribing,
                    checkpoint: batch_checkpoint(&checkpoints),
                },
            )?;
        }
    }
    for (checkpoint, stream_samples) in checkpoints.iter_mut().zip(decoder.stream_positions()) {
        checkpoint.analysis_sample = stream_samples;
    }
    for track in &mut tracks {
        track.vad.flush().map_err(|_| "SPEECH_INFERENCE_FAILED")?;
        emitted_segments = emitted_segments.saturating_add(drain_source_vad(
            track,
            &mut asr,
            identity,
            &mut revision,
            writer,
        )?);
    }
    write_response(
        writer,
        WorkerResponse::Heartbeat {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            stage: WorkerStage::Finalizing,
            checkpoint: batch_checkpoint(&checkpoints),
        },
    )?;
    if poll_batch_control(identity, &controls, &checkpoints, writer)? {
        return Ok(());
    }
    write_response(
        writer,
        WorkerResponse::Completed {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            metrics: WorkerMetrics {
                source_samples,
                segments: emitted_segments,
                speakers: 0,
                elapsed_ms: started_at.elapsed().as_millis() as u64,
                peak_working_bytes: None,
            },
        },
    )
}

struct SourceVad<'adapter> {
    track: TrackKind,
    vad: VadEngine<'adapter>,
    base_sample: u64,
    end_sample: u64,
    has_input: bool,
    publish_from: u64,
}

impl<'adapter> SourceVad<'adapter> {
    fn new(
        track: TrackKind,
        adapter: &'adapter LoadedNativeAdapter,
        models: &myagents_media_worker::model_pack_source::VerifiedModelPack,
    ) -> Result<Self, &'static str> {
        Ok(Self {
            track,
            vad: adapter
                .create_vad(models)
                .map_err(|_| "SPEECH_MODEL_LOAD_FAILED")?,
            base_sample: 0,
            end_sample: 0,
            has_input: false,
            publish_from: 0,
        })
    }
}

fn run_attachment_asr(
    identity: &WorkloadIdentity,
    input_path: &str,
    adapter: &LoadedNativeAdapter,
    models: &myagents_media_worker::model_pack_source::VerifiedModelPack,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<(), &'static str> {
    let started_at = Instant::now();
    let controls = start_batch_control_reader()?;
    let mut decoder =
        AttachmentAudioDecoder::open(Path::new(input_path)).map_err(map_attachment_decode_error)?;
    let info = decoder.info();
    let mut asr = adapter
        .create_asr(models)
        .map_err(|_| "SPEECH_MODEL_LOAD_FAILED")?;
    let mut track = SourceVad::new(TrackKind::Attachment, adapter, models)?;
    let mut checkpoints = vec![PcmStreamCheckpoint {
        replay_record_sample: None,
        track: TrackKind::Attachment,
        last_ack_sequence: None,
        analysis_sample: 0,
    }];
    write_response(
        writer,
        WorkerResponse::Ready {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
        },
    )?;
    write_response(
        writer,
        WorkerResponse::MediaProbed {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            media_kind: info.media_kind.into(),
            codec: info.codec.into(),
            duration_ms: info.duration_ms,
            used_default_track: info.used_default_track,
        },
    )?;

    let mut revision = 0_u64;
    let mut emitted_segments = 0_u32;
    let mut last_heartbeat_at = Instant::now();
    while let Some(chunk) = decoder.read_chunk().map_err(map_attachment_decode_error)? {
        if poll_batch_control(identity, &controls, &checkpoints, writer)? {
            return Ok(());
        }
        if chunk.start_sample() != checkpoints[0].analysis_sample {
            return Err("SPEECH_CORRUPT_MEDIA");
        }
        track
            .vad
            .accept(chunk.samples())
            .map_err(|_| "SPEECH_INFERENCE_FAILED")?;
        checkpoints[0].analysis_sample = checkpoints[0]
            .analysis_sample
            .checked_add(chunk.samples().len() as u64)
            .ok_or("SPEECH_RESOURCE_LIMIT")?;
        track.end_sample = checkpoints[0].analysis_sample;
        emitted_segments = emitted_segments.saturating_add(drain_source_vad(
            &mut track,
            &mut asr,
            identity,
            &mut revision,
            writer,
        )?);
        if last_heartbeat_at.elapsed() >= Duration::from_secs(2) {
            last_heartbeat_at = Instant::now();
            write_response(
                writer,
                WorkerResponse::Heartbeat {
                    protocol_version: PROTOCOL_VERSION,
                    identity: identity.clone(),
                    stage: WorkerStage::Transcribing,
                    checkpoint: batch_checkpoint(&checkpoints),
                },
            )?;
        }
    }
    if decoder.output_samples() != checkpoints[0].analysis_sample {
        return Err("SPEECH_CORRUPT_MEDIA");
    }
    track.vad.flush().map_err(|_| "SPEECH_INFERENCE_FAILED")?;
    emitted_segments = emitted_segments.saturating_add(drain_source_vad(
        &mut track,
        &mut asr,
        identity,
        &mut revision,
        writer,
    )?);
    if poll_batch_control(identity, &controls, &checkpoints, writer)? {
        return Ok(());
    }
    write_response(
        writer,
        WorkerResponse::Heartbeat {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            stage: WorkerStage::Finalizing,
            checkpoint: batch_checkpoint(&checkpoints),
        },
    )?;
    write_response(
        writer,
        WorkerResponse::Completed {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
            metrics: WorkerMetrics {
                source_samples: checkpoints[0].analysis_sample,
                segments: emitted_segments,
                speakers: 0,
                elapsed_ms: started_at.elapsed().as_millis() as u64,
                peak_working_bytes: None,
            },
        },
    )
}

enum BatchControl {
    Command(WorkerCommand),
    ProtocolError,
    Disconnected,
}

fn start_batch_control_reader() -> Result<Receiver<BatchControl>, &'static str> {
    let (sender, receiver) = mpsc::sync_channel(16);
    thread::Builder::new()
        .name("media-worker-control".into())
        .spawn(move || {
            let stdin = io::stdin();
            let mut reader = BufReader::new(stdin.lock());
            loop {
                let control = match read_manager_frame(&mut reader) {
                    Ok(Some(ManagerFrame::Control(command))) => BatchControl::Command(command),
                    Ok(Some(ManagerFrame::Pcm(mut pcm))) => {
                        pcm.samples.zeroize();
                        BatchControl::ProtocolError
                    }
                    Ok(None) => BatchControl::Disconnected,
                    Err(_) => BatchControl::ProtocolError,
                };
                let terminal = matches!(
                    control,
                    BatchControl::ProtocolError | BatchControl::Disconnected
                );
                if sender.send(control).is_err() || terminal {
                    break;
                }
            }
        })
        .map_err(|_| "SPEECH_WORKER_IO_ERROR")?;
    Ok(receiver)
}

fn poll_batch_control(
    identity: &WorkloadIdentity,
    controls: &Receiver<BatchControl>,
    checkpoints: &[PcmStreamCheckpoint],
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<bool, &'static str> {
    loop {
        let control = match controls.try_recv() {
            Ok(control) => control,
            Err(TryRecvError::Empty) => return Ok(false),
            Err(TryRecvError::Disconnected) => return Err("SPEECH_WORKER_DISCONNECTED"),
        };
        let BatchControl::Command(command) = control else {
            return Err(match control {
                BatchControl::ProtocolError => "SPEECH_WORKER_PROTOCOL_ERROR",
                BatchControl::Disconnected => "SPEECH_WORKER_DISCONNECTED",
                BatchControl::Command(_) => unreachable!(),
            });
        };
        if !command.has_valid_shape() || command.identity() != identity {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        match command {
            WorkerCommand::Yield { .. } => {
                write_response(
                    writer,
                    WorkerResponse::Yielded {
                        protocol_version: PROTOCOL_VERSION,
                        identity: identity.clone(),
                        checkpoint: batch_checkpoint(checkpoints),
                    },
                )?;
                return Ok(true);
            }
            WorkerCommand::Cancel { .. } => return Err("SPEECH_CANCELLED"),
            WorkerCommand::Ping { nonce, .. } => write_response(
                writer,
                WorkerResponse::Pong {
                    protocol_version: PROTOCOL_VERSION,
                    identity: identity.clone(),
                    nonce,
                },
            )?,
            WorkerCommand::Start(_)
            | WorkerCommand::Finalize { .. }
            | WorkerCommand::Flush { .. } => {
                return Err("SPEECH_WORKER_PROTOCOL_ERROR");
            }
        }
    }
}

fn batch_checkpoint(checkpoints: &[PcmStreamCheckpoint]) -> Checkpoint {
    Checkpoint {
        streams: checkpoints.to_vec(),
        analysis_sample: checkpoints
            .iter()
            .map(|checkpoint| checkpoint.analysis_sample)
            .max()
            .unwrap_or(0),
    }
}

fn accept_source_chunk(
    chunk: &SourceAudioChunk,
    tracks: &mut [SourceVad<'_>],
    asr: &mut AsrEngine<'_>,
    identity: &WorkloadIdentity,
    revision: &mut u64,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<u32, &'static str> {
    let track = tracks
        .iter_mut()
        .find(|track| track.track == chunk.track)
        .ok_or("SPEECH_WORKER_PROTOCOL_ERROR")?;
    if chunk.end_sample() <= track.publish_from {
        return Ok(0);
    }
    let first_sample = chunk.start_sample.max(track.publish_from);
    let mut emitted = 0_u32;
    if track.has_input
        && (chunk.discontinuity
            || first_sample != track.end_sample
            || chunk.quality == CaptureTimeQuality::Gap
            || chunk.echo_reference.is_some())
    {
        if first_sample < track.end_sample {
            return Err("SPEECH_CAPTURE_TIME_INVALID");
        }
        track.vad.flush().map_err(|_| "SPEECH_INFERENCE_FAILED")?;
        emitted = drain_source_vad(track, asr, identity, revision, writer)?;
        track.vad.reset().map_err(|_| "SPEECH_INFERENCE_FAILED")?;
        track.has_input = false;
    }
    if chunk.quality == CaptureTimeQuality::Gap || chunk.echo_reference.is_some() {
        track.end_sample = chunk.end_sample();
        return Ok(emitted);
    }
    if !track.has_input {
        track.base_sample = first_sample;
    }
    let mono = chunk.mono_samples();
    track
        .vad
        .accept(&mono[(first_sample - chunk.start_sample) as usize..])
        .map_err(|_| "SPEECH_INFERENCE_FAILED")?;
    track.end_sample = chunk.end_sample();
    track.has_input = true;
    Ok(emitted.saturating_add(drain_source_vad(track, asr, identity, revision, writer)?))
}

fn drain_source_chunks(
    chunks: &mut VecDeque<SourceAudioChunk>,
    tracks: &mut [SourceVad<'_>],
    asr: &mut AsrEngine<'_>,
    identity: &WorkloadIdentity,
    revision: &mut u64,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<u32, &'static str> {
    let mut emitted = 0_u32;
    while let Some(chunk) = chunks.pop_front() {
        emitted = emitted.saturating_add(accept_source_chunk(
            &chunk, tracks, asr, identity, revision, writer,
        )?);
    }
    Ok(emitted)
}

fn drain_source_vad(
    track: &mut SourceVad<'_>,
    asr: &mut AsrEngine<'_>,
    identity: &WorkloadIdentity,
    revision: &mut u64,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<u32, &'static str> {
    let mut emitted = 0_u32;
    loop {
        let Some(mut segment) = track.vad.pop().map_err(|_| "SPEECH_INFERENCE_FAILED")? else {
            break;
        };
        let start_sample = track
            .base_sample
            .checked_add(segment.start_sample)
            .ok_or("SPEECH_RESOURCE_LIMIT")?;
        let end_sample = start_sample
            .checked_add(segment.samples.len() as u64)
            .ok_or("SPEECH_RESOURCE_LIMIT")?;
        if end_sample > track.end_sample {
            segment.samples.zeroize();
            return Err("SPEECH_INFERENCE_FAILED");
        }
        let transcript = asr.transcribe(&segment.samples);
        segment.samples.zeroize();
        let mut transcript = transcript.map_err(|_| "SPEECH_INFERENCE_FAILED")?;
        if transcript.text.trim().is_empty() {
            transcript.zeroize_sensitive();
            continue;
        }
        let Some(next_revision) = revision.checked_add(1) else {
            transcript.zeroize_sensitive();
            return Err("SPEECH_RESOURCE_LIMIT");
        };
        *revision = next_revision;
        let (text, language) = transcript.into_publication();
        write_response(
            writer,
            WorkerResponse::TranscriptSegment {
                protocol_version: PROTOCOL_VERSION,
                identity: identity.clone(),
                // Source/time identity keeps equal-time ordering independent
                // of ASR completion order; revision remains transport order.
                segment_id: format!("segment-{:?}-{start_sample}-{end_sample}", track.track),
                track: track.track,
                start_sample,
                end_sample,
                text,
                language,
                revision: *revision,
            },
        )?;
        emitted = emitted.saturating_add(1);
    }
    Ok(emitted)
}

fn map_attachment_decode_error(error: AttachmentAudioError) -> &'static str {
    match error {
        AttachmentAudioError::SourceUnavailable => "SPEECH_SOURCE_UNAVAILABLE",
        AttachmentAudioError::UnsafeSource => "SPEECH_SOURCE_UNSAFE",
        AttachmentAudioError::SourceTooLarge
        | AttachmentAudioError::DurationExceeded
        | AttachmentAudioError::ResourceLimit => "SPEECH_MEDIA_LIMIT_EXCEEDED",
        AttachmentAudioError::UnsupportedContainer | AttachmentAudioError::UnsupportedCodec => {
            "SPEECH_UNSUPPORTED_CODEC"
        }
        AttachmentAudioError::EncryptedMedia => "SPEECH_ENCRYPTED_MEDIA",
        AttachmentAudioError::NoAudioTrack => "SPEECH_NO_AUDIO_TRACK",
        AttachmentAudioError::CorruptMedia => "SPEECH_CORRUPT_MEDIA",
    }
}

fn map_diarization_error(error: DiarizationError) -> &'static str {
    match error {
        DiarizationError::InvalidDuration => "SPEECH_NO_AUDIO_TRACK",
        DiarizationError::ResourceLimit => "SPEECH_MEDIA_LIMIT_EXCEEDED",
        DiarizationError::InvalidConfiguration
        | DiarizationError::WindowPlanMismatch
        | DiarizationError::DuplicateLocalSpeaker
        | DiarizationError::InvalidEmbedding
        | DiarizationError::InvalidSegment
        | DiarizationError::InvalidClusterLabels => "SPEECH_INFERENCE_FAILED",
    }
}

fn run_live(
    identity: &WorkloadIdentity,
    stream_starts: &[PcmStreamStart],
    adapter: &LoadedNativeAdapter,
    models: &myagents_media_worker::model_pack_source::VerifiedModelPack,
    reader: &mut BufReader<StdinLock<'_>>,
    writer: &mut BufWriter<StdoutLock<'_>>,
) -> Result<(), &'static str> {
    let started_at = Instant::now();
    let mut asr = adapter
        .create_asr(models)
        .map_err(|_| "SPEECH_MODEL_LOAD_FAILED")?;
    let mut tracks = stream_starts.iter().map(LiveTrack::new).collect::<Vec<_>>();
    let mut transcription = stream_starts
        .iter()
        .map(|stream| {
            let mut track = SourceVad::new(stream.track, adapter, models)?;
            track.publish_from = stream.publish_from_record_sample;
            Ok::<_, &'static str>(track)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut preprocessing = LiveRecordAudio::new(stream_starts)?;
    let mut audio = VecDeque::new();
    write_response(
        writer,
        WorkerResponse::Ready {
            protocol_version: PROTOCOL_VERSION,
            identity: identity.clone(),
        },
    )?;

    let mut revision = 0_u64;
    let mut emitted_segments = 0_u32;
    let mut source_samples = 0_u64;
    loop {
        let frame = read_manager_frame(reader).map_err(|_| "SPEECH_WORKER_PROTOCOL_ERROR")?;
        match frame {
            Some(ManagerFrame::Pcm(mut pcm)) => {
                if pcm.protocol_version != PROTOCOL_VERSION
                    || pcm.worker_generation != identity.worker_generation
                {
                    pcm.samples.zeroize();
                    return Err("SPEECH_WORKER_PROTOCOL_ERROR");
                }
                let processed = (|| {
                    let track_index = tracks
                        .iter()
                        .position(|track| track.track == pcm.track)
                        .ok_or("SPEECH_WORKER_PROTOCOL_ERROR")?;
                    tracks[track_index].validate_frame(&pcm)?;
                    let end_sample = pcm
                        .start_sample
                        .checked_add(pcm.frames() as u64)
                        .ok_or("SPEECH_WORKER_PROTOCOL_ERROR")?;
                    source_samples = source_samples
                        .checked_add(pcm.frames() as u64)
                        .ok_or("SPEECH_RESOURCE_LIMIT")?;
                    tracks[track_index].accept_frame(&pcm, end_sample)?;
                    write_response(
                        writer,
                        WorkerResponse::InputAck {
                            protocol_version: PROTOCOL_VERSION,
                            identity: identity.clone(),
                            track: pcm.track,
                            sequence: pcm.sequence,
                            end_sample,
                        },
                    )?;
                    preprocessing.accept(&pcm, &mut audio)?;
                    let newly_emitted = drain_source_chunks(
                        &mut audio,
                        &mut transcription,
                        &mut asr,
                        identity,
                        &mut revision,
                        writer,
                    )?;
                    write_response(
                        writer,
                        WorkerResponse::Heartbeat {
                            protocol_version: PROTOCOL_VERSION,
                            identity: identity.clone(),
                            stage: WorkerStage::Vad,
                            checkpoint: checkpoint(&tracks, &transcription),
                        },
                    )?;
                    Ok::<u32, &'static str>(newly_emitted)
                })();
                pcm.samples.zeroize();
                emitted_segments = emitted_segments.saturating_add(processed?);
            }
            Some(ManagerFrame::Control(command)) => {
                if !command.has_valid_shape() || command.identity() != identity {
                    return Err("SPEECH_WORKER_PROTOCOL_ERROR");
                }
                match command {
                    WorkerCommand::Flush { .. } => {
                        preprocessing.flush(&mut audio)?;
                        emitted_segments = emitted_segments.saturating_add(drain_source_chunks(
                            &mut audio,
                            &mut transcription,
                            &mut asr,
                            identity,
                            &mut revision,
                            writer,
                        )?);
                        for track in &mut transcription {
                            track.vad.flush().map_err(|_| "SPEECH_INFERENCE_FAILED")?;
                            emitted_segments = emitted_segments.saturating_add(drain_source_vad(
                                track,
                                &mut asr,
                                identity,
                                &mut revision,
                                writer,
                            )?);
                            track.vad.reset().map_err(|_| "SPEECH_INFERENCE_FAILED")?;
                            track.has_input = false;
                        }
                        write_response(
                            writer,
                            WorkerResponse::Heartbeat {
                                protocol_version: PROTOCOL_VERSION,
                                identity: identity.clone(),
                                stage: WorkerStage::Vad,
                                checkpoint: checkpoint(&tracks, &transcription),
                            },
                        )?;
                    }
                    WorkerCommand::Finalize { streams, .. } => {
                        validate_final_streams(&tracks, &streams)?;
                        preprocessing.flush(&mut audio)?;
                        emitted_segments = emitted_segments.saturating_add(drain_source_chunks(
                            &mut audio,
                            &mut transcription,
                            &mut asr,
                            identity,
                            &mut revision,
                            writer,
                        )?);
                        for track in &mut transcription {
                            track.vad.flush().map_err(|_| "SPEECH_INFERENCE_FAILED")?;
                            emitted_segments = emitted_segments.saturating_add(drain_source_vad(
                                track,
                                &mut asr,
                                identity,
                                &mut revision,
                                writer,
                            )?);
                        }
                        write_response(
                            writer,
                            WorkerResponse::Completed {
                                protocol_version: PROTOCOL_VERSION,
                                identity: identity.clone(),
                                metrics: WorkerMetrics {
                                    source_samples,
                                    segments: emitted_segments,
                                    speakers: 0,
                                    elapsed_ms: started_at.elapsed().as_millis() as u64,
                                    peak_working_bytes: None,
                                },
                            },
                        )?;
                        return Ok(());
                    }
                    WorkerCommand::Cancel { .. } => return Err("SPEECH_CANCELLED"),
                    WorkerCommand::Ping { nonce, .. } => write_response(
                        writer,
                        WorkerResponse::Pong {
                            protocol_version: PROTOCOL_VERSION,
                            identity: identity.clone(),
                            nonce,
                        },
                    )?,
                    WorkerCommand::Yield { .. } => {
                        write_response(
                            writer,
                            WorkerResponse::Yielded {
                                protocol_version: PROTOCOL_VERSION,
                                identity: identity.clone(),
                                checkpoint: checkpoint(&tracks, &transcription),
                            },
                        )?;
                        return Ok(());
                    }
                    WorkerCommand::Start(_) => {
                        return Err("SPEECH_WORKER_PROTOCOL_ERROR");
                    }
                }
            }
            None => return Err("SPEECH_WORKER_DISCONNECTED"),
        }
    }
}

struct LiveTrack {
    channels: u8,
    track: TrackKind,
    next_sequence: u64,
    received_frames: u64,
    first_sample: u64,
    last_end_sample: u64,
}

impl LiveTrack {
    fn new(stream: &PcmStreamStart) -> Self {
        Self {
            track: stream.track,
            channels: stream.channels,
            next_sequence: stream.first_sequence,
            received_frames: 0,
            first_sample: stream.first_sample,
            last_end_sample: stream.first_sample,
        }
    }

    fn validate_frame(&self, frame: &PcmFrame) -> Result<(), &'static str> {
        if frame.channels != self.channels
            || frame.sequence != self.next_sequence
            || (self.received_frames == 0 && frame.start_sample != self.first_sample)
            || frame.start_sample < self.last_end_sample
        {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        Ok(())
    }

    fn accept_frame(&mut self, frame: &PcmFrame, end_sample: u64) -> Result<(), &'static str> {
        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or("SPEECH_RESOURCE_LIMIT")?;
        self.received_frames = self
            .received_frames
            .checked_add(1)
            .ok_or("SPEECH_RESOURCE_LIMIT")?;
        self.last_end_sample = end_sample;
        if frame.track != self.track {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
        Ok(())
    }

    fn last_sequence(&self) -> Option<u64> {
        (self.received_frames > 0).then(|| self.next_sequence - 1)
    }
}

fn validate_final_streams(tracks: &[LiveTrack], ends: &[PcmStreamEnd]) -> Result<(), &'static str> {
    if tracks.len() != ends.len() {
        return Err("SPEECH_WORKER_PROTOCOL_ERROR");
    }
    for track in tracks {
        let end = ends
            .iter()
            .find(|end| end.track == track.track)
            .ok_or("SPEECH_WORKER_PROTOCOL_ERROR")?;
        if end.last_sequence != track.last_sequence() || end.final_sample < track.last_end_sample {
            return Err("SPEECH_WORKER_PROTOCOL_ERROR");
        }
    }
    Ok(())
}

fn checkpoint(tracks: &[LiveTrack], transcription: &[SourceVad<'_>]) -> Checkpoint {
    Checkpoint {
        streams: tracks
            .iter()
            .map(|track| PcmStreamCheckpoint {
                // Native VAD forcibly endpoints within 30 seconds. Retain
                // the larger shared ASR limit as a conservative unfinished
                // speech bound, independently of input ACK and transport lag.
                replay_record_sample: transcription
                    .iter()
                    .find(|source| source.track == track.track)
                    .map(|source| {
                        let floor = if source.has_input {
                            source.end_sample.saturating_sub(
                                myagents_media_worker::native_adapter::MAX_ASR_SAMPLES as u64,
                            )
                        } else {
                            source.end_sample
                        };
                        floor.max(source.publish_from)
                    }),
                track: track.track,
                last_ack_sequence: track.last_sequence(),
                analysis_sample: track.last_end_sample,
            })
            .collect(),
        analysis_sample: tracks
            .iter()
            .map(|track| track.last_end_sample)
            .max()
            .unwrap_or(0),
    }
}

fn write_response(
    writer: &mut BufWriter<StdoutLock<'_>>,
    mut response: WorkerResponse,
) -> Result<(), &'static str> {
    let result = write_control_frame(writer, &response)
        .and_then(|()| writer.flush())
        .map_err(|_| "SPEECH_WORKER_IO_ERROR");
    response.zeroize_sensitive();
    result
}
