//! Stage artifacts inside the existing Manager-owned private job directory.
//! The durable root job reference, not file existence, authorizes reuse.
use super::*;

const MAX_BASELINE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ASR_BYTES: u64 = 64 * 1024 * 1024;
pub(super) const BASELINE_FILE: &str = "record-baseline.json";
pub(super) const ASR_FILE: &str = "record-asr.json";
const ANCHORS_FILE: &str = "record-anchors.json";

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RecordProcessingInput {
    pub processing_id: String,
    pub baseline: RecordSpeechBaseline,
    pub pipeline: SpeechPipelineSnapshot,
    pub runtime_sha256: String,
    pub model_manifest_sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RecordAsrCandidate {
    pub processing_id: String,
    pub worker_generation: u64,
    pub pipeline: SpeechPipelineSnapshot,
    pub segments: Vec<RecordTranscriptSegment>,
}
impl Drop for RecordAsrCandidate {
    fn drop(&mut self) {
        for segment in &mut self.segments {
            segment.text.zeroize();
            if let Some(language) = &mut segment.language {
                language.zeroize();
            }
        }
    }
}

pub(super) fn small_file_sha256(path: &Path) -> Result<String, &'static str> {
    let bytes = read_plain_bounded(path, MAX_JOB_METADATA_BYTES)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn read_plain_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() == 0
        || metadata.len() > limit
    {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .map_err(|_| "SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?;
    if bytes.len() as u64 > limit {
        bytes.zeroize();
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    Ok(bytes)
}

pub(super) fn write_candidate<T: Serialize>(
    root: &Path,
    processing_id: &str,
    filename: &str,
    value: &T,
) -> Result<SpeechCandidateReference, &'static str> {
    validate_job_id(processing_id)?;
    let limit = if filename == BASELINE_FILE {
        MAX_BASELINE_BYTES
    } else if filename == ASR_FILE {
        MAX_ASR_BYTES
    } else if filename == ANCHORS_FILE {
        myagents_media_worker_protocol::record_identity::MAX_IDENTITY_DOCUMENT_BYTES
    } else {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    };
    let directory = root.join("private").join(processing_id);
    ensure_private_directory(&directory).map_err(|_| "SPEECH_PRIVATE_STORAGE_UNAVAILABLE")?;
    let mut content =
        serde_json::to_string(value).map_err(|_| "SPEECH_RECORD_CANDIDATE_INVALID")?;
    if content.len() as u64 > limit {
        content.zeroize();
        return Err("SPEECH_RESOURCE_LIMIT");
    }
    let reference = SpeechCandidateReference {
        sha256: format!("{:x}", Sha256::digest(content.as_bytes())),
        size_bytes: content.len() as u64,
    };
    let result = crate::task::write_atomic_text(&directory.join(filename), &content);
    content.zeroize();
    result.map_err(|_| "SPEECH_JOB_STORE_WRITE_FAILED")?;
    Ok(reference)
}

pub(super) fn worker_anchors(
    root: &Path,
    job: &SpeechJob,
) -> Result<myagents_media_worker_protocol::record_identity::IdentityAnchorInput, &'static str> {
    use myagents_media_worker_protocol::record_identity::{
        IdentityAnchorDocument, IdentityAnchorInput, OriginalSpeechInterval, PersonAnchor,
    };
    let frozen = read_input(root, job)?;
    let people = frozen
        .baseline
        .person_anchors
        .iter()
        .map(|(person_id, anchor)| {
            let identity_scopes = anchor
                .identity_scopes
                .iter()
                .map(|scope| {
                    scope
                        .iter()
                        .map(|interval| {
                            Ok(OriginalSpeechInterval {
                                source: protocol_track(interval.source)?,
                                start_sample: interval.start_sample,
                                end_sample: interval.end_sample,
                            })
                        })
                        .collect::<Result<Vec<_>, &'static str>>()
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(PersonAnchor {
                person_id: *person_id,
                identity_scopes,
                has_unresolved_activity: anchor.has_unresolved_activity
                    || anchor.audio_identity != frozen.baseline.audio_identity,
            })
        })
        .collect::<Result<Vec<_>, &'static str>>()?;
    let assignment_exclusions = frozen
        .baseline
        .assignment_exclusions
        .iter()
        .map(|interval| {
            Ok(OriginalSpeechInterval {
                source: protocol_track(interval.source)?,
                start_sample: interval.start_sample,
                end_sample: interval.end_sample,
            })
        })
        .collect::<Result<Vec<_>, &'static str>>()?;
    let document = IdentityAnchorDocument {
        schema_version: 1,
        audio_identity: frozen.baseline.audio_identity,
        people,
        assignment_exclusions,
    };
    if !document.has_valid_shape() {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    let reference = write_candidate(root, &job.job_id, ANCHORS_FILE, &document)?;
    Ok(IdentityAnchorInput {
        path: path_for_protocol(&root.join("private").join(&job.job_id).join(ANCHORS_FILE))?,
        sha256: reference.sha256,
    })
}

fn read_candidate<T: serde::de::DeserializeOwned>(
    root: &Path,
    processing_id: &str,
    filename: &str,
    reference: &SpeechCandidateReference,
    limit: u64,
) -> Result<T, &'static str> {
    validate_job_id(processing_id)?;
    let directory = root.join("private").join(processing_id);
    let metadata =
        fs::symlink_metadata(&directory).map_err(|_| "SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    let mut bytes = read_plain_bounded(&directory.join(filename), limit)?;
    let valid = bytes.len() as u64 == reference.size_bytes
        && format!("{:x}", Sha256::digest(&bytes)) == reference.sha256;
    let parsed = if valid {
        serde_json::from_slice(&bytes).map_err(|_| "SPEECH_RECORD_CANDIDATE_INVALID")
    } else {
        Err("SPEECH_RECORD_CANDIDATE_INVALID")
    };
    bytes.zeroize();
    parsed
}

pub(super) fn read_input(
    root: &Path,
    job: &SpeechJob,
) -> Result<RecordProcessingInput, &'static str> {
    let processing_id = job
        .processing_id
        .as_deref()
        .ok_or("SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?;
    let reference = job
        .record_baseline
        .as_ref()
        .ok_or("SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?;
    let input: RecordProcessingInput = read_candidate(
        root,
        processing_id,
        BASELINE_FILE,
        reference,
        MAX_BASELINE_BYTES,
    )?;
    if input.processing_id != processing_id
        || input.pipeline != job.pipeline
        || !matches!(&job.origin, SpeechJobOrigin::Record { record_id } if record_id == &input.baseline.record_id)
    {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    Ok(input)
}

pub(super) fn read_asr(
    root: &Path,
    root_job: &SpeechJob,
) -> Result<RecordAsrCandidate, &'static str> {
    if root_job.kind != SpeechJobKind::RecordBackfillAsr
        || root_job.processing_id.as_deref() != Some(&root_job.job_id)
    {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    let reference = root_job
        .record_asr_candidate
        .as_ref()
        .ok_or("SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?;
    let candidate: RecordAsrCandidate =
        read_candidate(root, &root_job.job_id, ASR_FILE, reference, MAX_ASR_BYTES)?;
    if candidate.processing_id != root_job.job_id
        || candidate.pipeline != root_job.pipeline
        || candidate.worker_generation == 0
    {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    Ok(candidate)
}

impl SpeechRecognitionManager {
    pub(crate) async fn cancel_record_processing(
        self: &Arc<Self>,
        record_id: &str,
    ) -> Result<(), String> {
        validate_job_id(record_id).map_err(str::to_string)?;
        let manager = Arc::clone(self);
        let record_id = record_id.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let (running, processing_ids) = {
                let mut state = manager.state.lock().map_err(|_| "SPEECH_MANAGER_UNAVAILABLE".to_string())?;
                let mut jobs = state.jobs.values().filter(|job| !job.state.is_terminal()
                    && matches!(&job.origin, SpeechJobOrigin::Record { record_id: id } if id == &record_id))
                    .cloned().collect::<Vec<_>>();
                jobs.sort_by_key(|job| if job.kind == SpeechJobKind::RecordBackfillAsr { 0 } else { 1 });
                let mut processing_ids = Vec::new();
                for mut job in jobs {
                    job.state = SpeechJobState::Cancelled;
                    job.error = Some(SpeechJobError { code: "SPEECH_CANCELLED".into(), retryable: false });
                    job.finished_at = Some(Utc::now()); job.updated_at = Utc::now();
                    persist_job_resolving_unknown(&manager.root, &job)?;
                    state.queue.retain(|id| id != &job.job_id);
                    if job.kind == SpeechJobKind::RecordBackfillAsr { processing_ids.push(job.job_id.clone()); }
                    state.jobs.insert(job.job_id.clone(), job);
                }
                if let Some(live) = state.live_sessions.get(&record_id) {
                    let mut control = live.control.state.lock().map_err(|_| "SPEECH_MANAGER_UNAVAILABLE".to_string())?;
                    control.cancelled = true;
                    if let Some(timer) = control.pause_timer.take() { timer.abort(); }
                }
                let running = [state.running.as_ref(), state.live_running.as_ref()].into_iter().flatten()
                    .filter(|worker| worker.job_id == record_id || state.jobs.get(&worker.job_id).is_some_and(|job|
                        matches!(&job.origin, SpeechJobOrigin::Record { record_id: id } if id == &record_id)))
                    .map(|worker| (worker.job_id.clone(), worker.generation, Arc::clone(&worker.stdin), Arc::clone(&worker.child)))
                    .collect::<Vec<_>>();
                (running, processing_ids)
            };
            for (job_id, generation, stdin, child) in running {
                let _ = send_worker_command(&stdin, &WorkerCommand::Cancel { protocol_version: PROTOCOL_VERSION,
                    identity: WorkloadIdentity { workload_id: job_id, worker_generation: generation } });
                let _ = process_cmd::settle_tree(&child, WORKER_CANCEL_GRACE);
            }
            for processing_id in processing_ids { cleanup_record_private(&manager.root, &processing_id); }
            let state = manager.state.lock().map_err(|_| "SPEECH_MANAGER_UNAVAILABLE".to_string())?;
            if !state.jobs.values().any(|job| !job.state.is_terminal()
                && matches!(&job.origin, SpeechJobOrigin::Record { record_id: id } if id == &record_id))
                && tauri::async_runtime::block_on(manager.record_store.get(&record_id)).is_some()
            {
                let has_final = tauri::async_runtime::block_on(manager.record_store.read_recording_final_transcript(&record_id))?.is_some();
                let has_speakers = tauri::async_runtime::block_on(manager.record_store.read_diarization_result(&record_id))?.is_some();
                tauri::async_runtime::block_on(manager.record_store.update_audio_processing_status(&record_id,
                    Some(if has_final { TranscriptionStatus::Ready } else { TranscriptionStatus::NotStarted }),
                    Some(if has_speakers { DiarizationStatus::Ready } else { DiarizationStatus::NotApplicable }),
                ))?;
            }
            drop(state);
            manager.wake.notify_one();
            Ok(())
        }).await.map_err(|_| "SPEECH_MANAGER_UNAVAILABLE".to_string())?
    }

    pub(super) fn recover_record_processing(&self) -> Result<(), &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "SPEECH_MANAGER_UNAVAILABLE")?;
        let roots = state
            .jobs
            .values()
            .filter(|job| {
                job.kind == SpeechJobKind::RecordBackfillAsr
                    && job.processing_id.as_deref() == Some(&job.job_id)
                    && !job.state.is_terminal()
                    && job.record_asr_candidate.is_some()
            })
            .cloned()
            .collect::<Vec<_>>();
        for root_job in roots {
            let SpeechJobOrigin::Record { record_id } = &root_job.origin else {
                continue;
            };
            let child_id = format!("{}_diarization", root_job.job_id);
            let child = state.jobs.get(&child_id).cloned();
            let published = tauri::async_runtime::block_on(
                self.record_store
                    .speech_processing_outcome(record_id, &root_job.job_id),
            );
            match published {
                Ok(Some(complete)) => {
                    let error = if complete {
                        None
                    } else {
                        root_job
                            .error
                            .clone()
                            .or_else(|| child.as_ref().and_then(|child| child.error.clone()))
                            .or_else(|| {
                                Some(SpeechJobError {
                                    code: "SPEECH_DIARIZATION_FAILED".into(),
                                    retryable: true,
                                })
                            })
                    };
                    let terminal = if complete {
                        SpeechJobState::Succeeded
                    } else {
                        SpeechJobState::Failed
                    };
                    if let Some(mut child) = child {
                        child.state = terminal;
                        child.error = error.clone();
                        child.finished_at = Some(Utc::now());
                        child.worker_generation = None;
                        child.output.artifact_available = complete;
                        persist_job_resolving_unknown(&self.root, &child)
                            .map_err(|_| "SPEECH_JOB_STORE_WRITE_FAILED")?;
                        state.jobs.insert(child_id, child);
                    }
                    finish_processing_root_locked(
                        &self.root,
                        &mut state,
                        &root_job.job_id,
                        terminal,
                        error,
                    );
                }
                Ok(None) => {
                    let failed = root_job.error.clone().or_else(|| {
                        child
                            .as_ref()
                            .filter(|child| child.state.is_terminal())
                            .map(|child| {
                                child.error.clone().unwrap_or(SpeechJobError {
                                    code: "SPEECH_RECORD_CANDIDATE_INVALID".into(),
                                    retryable: false,
                                })
                            })
                    });
                    if let Some(error) = failed {
                        self.fail_record_processing_locked(
                            &mut state,
                            &root_job,
                            &error.code,
                            error.retryable,
                        );
                    } else if let Err(code) =
                        enqueue_diarization_locked(&self.root, &mut state, &root_job)
                    {
                        self.fail_record_processing_locked(&mut state, &root_job, code, false);
                    }
                }
                Err(_) => self.fail_record_processing_locked(
                    &mut state,
                    &root_job,
                    "SPEECH_RECORD_RESULT_UNAVAILABLE",
                    false,
                ),
            }
        }
        // No queued child can regain authority after its processing was cancelled
        // or settled, even if the process died between the two job file writes.
        let orphans = state
            .jobs
            .values()
            .filter(|job| job.kind == SpeechJobKind::RecordDiarization && !job.state.is_terminal())
            .filter(|job| {
                job.processing_id.as_ref().map_or(true, |id| {
                    state
                        .jobs
                        .get(id)
                        .map_or(true, |root| root.state.is_terminal())
                })
            })
            .cloned()
            .collect::<Vec<_>>();
        for mut job in orphans {
            let parent = job.processing_id.as_ref().and_then(|id| state.jobs.get(id));
            job.state = parent.map_or(SpeechJobState::Failed, |root| root.state);
            job.error = parent.map_or_else(
                || {
                    Some(SpeechJobError {
                        code: "SPEECH_PIPELINE_REVISION_UNAVAILABLE".into(),
                        retryable: false,
                    })
                },
                |root| root.error.clone(),
            );
            job.finished_at = Some(Utc::now());
            job.worker_generation = None;
            persist_job_resolving_unknown(&self.root, &job)
                .map_err(|_| "SPEECH_JOB_STORE_WRITE_FAILED")?;
            state.jobs.insert(job.job_id.clone(), job);
        }
        let mut queue = recovered_record_queue(&state.jobs);
        // Recovery is before worker admission. Preserve already-admitted Agent
        // jobs if the UI submitted one during this short startup boundary.
        queue.extend(
            state
                .queue
                .iter()
                .filter(|id| {
                    state.jobs.get(*id).is_some_and(|job| {
                        job.kind.is_agent() && job.state == SpeechJobState::Queued
                    })
                })
                .cloned(),
        );
        state.queue = queue;
        Ok(())
    }

    pub(super) fn bind_legacy_record_processing(
        &self,
        job: &SpeechJob,
        generation: u64,
        resources: &SpeechExecutionResources,
    ) -> Result<SpeechJob, &'static str> {
        if job.processing_id.is_some() {
            return Ok(job.clone());
        }
        // A historical diarization job has no durable association to an ASR
        // generation. Do not guess from the latest job/Record number.
        if job.kind != SpeechJobKind::RecordBackfillAsr {
            return Err("SPEECH_PIPELINE_REVISION_UNAVAILABLE");
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "SPEECH_MANAGER_UNAVAILABLE")?;
        if !exact_running_generation(&state, &job.job_id, generation) {
            return Err("SPEECH_INTERRUPTED");
        }
        let SpeechJobOrigin::Record { record_id } = &job.origin else {
            return Err("SPEECH_WORKLOAD_NOT_READY");
        };
        let baseline =
            tauri::async_runtime::block_on(self.record_store.prepare_speech_processing(record_id))
                .map_err(|_| "SPEECH_SOURCE_UNSAFE")?;
        let runtime = self
            .runtime_registry
            .identity(InferenceRuntimeKind::OnnxCpu)
            .map_err(|_| "SPEECH_NATIVE_RUNTIME_UNAVAILABLE")?;
        let mut adopted = job.clone();
        adopted.processing_id = Some(job.job_id.clone());
        adopted.pipeline = pipeline_from_provenance(&resources.provenance);
        adopted.source.sha256 = Some(baseline.audio_identity.clone());
        let input = RecordProcessingInput {
            processing_id: job.job_id.clone(),
            baseline,
            pipeline: adopted.pipeline.clone(),
            runtime_sha256: runtime.sha256().into(),
            model_manifest_sha256: small_file_sha256(&resources.model_pack_manifest_path)?,
        };
        adopted.record_baseline = Some(write_candidate(
            &self.root,
            &job.job_id,
            BASELINE_FILE,
            &input,
        )?);
        persist_job_resolving_unknown(&self.root, &adopted)
            .map_err(|_| "SPEECH_JOB_STORE_WRITE_FAILED")?;
        state.jobs.insert(adopted.job_id.clone(), adopted.clone());
        Ok(adopted)
    }
}

pub(super) fn cleanup_record_private(root: &Path, processing_id: &str) {
    if validate_job_id(processing_id).is_err() {
        return;
    }
    for id in [
        processing_id.to_owned(),
        format!("{processing_id}_diarization"),
    ] {
        let path = root.join("private").join(id);
        if fs::symlink_metadata(&path)
            .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        {
            let _ = fs::remove_dir_all(path);
        }
    }
}
