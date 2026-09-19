//! Record-local human facts and their original-audio anchors. No voice vectors
//! or inferred names are persisted here. Automatic bindings live in the result.
use super::*;
use myagents_media_worker_protocol::record_identity::PersonMatchEvidence;

const MAX_PERSON_ANCHOR_INTERVALS: usize = 32_768;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordSpeechSourceSnapshot {
    pub audio_identity: String,
    pub artifacts: Vec<RecordArtifact>,
}
impl RecordSpeechSourceSnapshot {
    pub(super) fn is_valid(&self) -> bool {
        !self.artifacts.is_empty()
            && self.artifacts.len() <= 3
            && self
                .artifacts
                .windows(2)
                .all(|pair| pair[0].path < pair[1].path)
            && self.artifacts.iter().all(|artifact| {
                artifact.kind == "audio/ogg-opus"
                    && [
                        AudioTrackKind::Microphone,
                        AudioTrackKind::System,
                        AudioTrackKind::Mixed,
                    ]
                    .into_iter()
                    .any(|source| audio_track_relative_path(source) == artifact.path)
                    && artifact.size_bytes > 0
                    && artifact.sha256.len() == 64
                    && artifact.sha256.bytes().all(|b| b.is_ascii_hexdigit())
                    && artifact
                        .capture_timeline
                        .as_ref()
                        .map_or(true, RecordTrackTimeline::is_valid)
            })
            && audio_identity(&self.artifacts).as_ref() == Ok(&self.audio_identity)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OriginalSpeechInterval {
    pub source: AudioTrackKind,
    pub start_sample: u64,
    pub end_sample: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecordPersonAnchor {
    pub audio_identity: String,
    pub identity_scopes: Vec<Vec<OriginalSpeechInterval>>,
    /// Unresolvable parts of an old cluster cannot quietly disappear and make
    /// the remaining portion look like a pure, fully identified person.
    pub has_unresolved_activity: bool,
}

impl RecordPersonAnchor {
    pub(super) fn intervals(&self) -> Vec<OriginalSpeechInterval> {
        merge_original_intervals(self.identity_scopes.iter().flatten().cloned().collect())
    }
    fn interval_count(&self) -> usize {
        self.identity_scopes.iter().map(Vec::len).sum()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecordAssignmentAnchor {
    pub operation_revision: u64,
    pub transcript_revision: u64,
    pub processing_id: Option<String>,
    pub audio_identity: String,
    pub interval: Option<OriginalSpeechInterval>,
    /// Later explicit assignments replace only their original speech scope.
    /// Keep the unaffected remainder without reviving the superseded portion.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded_intervals: Vec<OriginalSpeechInterval>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordInheritedAssignment {
    pub original_segment_id: String,
    pub operation_revision: u64,
    pub speaker_id: u32,
}

/// Frozen by Store while the old artifacts still exist. Manager persists this
/// in its existing private job directory and carries it across both stages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecordSpeechBaseline {
    pub record_id: String,
    pub audio_identity: String,
    pub audio_artifacts: Vec<RecordArtifact>,
    pub transcript_artifact: Option<RecordArtifact>,
    pub diarization_artifact: Option<RecordArtifact>,
    pub override_revision: u64,
    pub person_anchors: BTreeMap<u32, RecordPersonAnchor>,
    pub assignment_exclusions: Vec<OriginalSpeechInterval>,
    pub next_person_id: u32,
}

/// Validate persisted human evidence before it can participate in a derived
/// baseline or publication. Old schema-1 operations need no invented anchors.
pub(super) fn validate_anchor_shapes(overrides: &RecordSpeakerOverrides) -> Result<(), String> {
    let valid_hash =
        |value: &str| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit());
    let valid_interval = |interval: &OriginalSpeechInterval| {
        interval.start_sample < interval.end_sample
            && interval.end_sample <= myagents_media_worker_protocol::MAX_MEDIA_SAMPLES_PER_TRACK
    };
    let ordered = |intervals: &[OriginalSpeechInterval]| {
        intervals.iter().all(&valid_interval)
            && intervals.windows(2).all(|pair| {
                pair[0].source < pair[1].source
                    || (pair[0].source == pair[1].source
                        && pair[0].end_sample < pair[1].start_sample)
            })
    };
    if (overrides.schema_version == 1
        && (!overrides.person_anchors.is_empty() || !overrides.assignment_anchors.is_empty()))
        || overrides.person_anchors.len()
            > myagents_media_worker_protocol::record_identity::MAX_IDENTITY_PEOPLE
        || overrides
            .person_anchors
            .values()
            .map(RecordPersonAnchor::interval_count)
            .sum::<usize>()
            + overrides
                .assignment_anchors
                .values()
                .map(|anchor| {
                    usize::from(anchor.interval.is_some()) + anchor.excluded_intervals.len()
                })
                .sum::<usize>()
            > MAX_PERSON_ANCHOR_INTERVALS
        || overrides.person_anchors.values().any(|anchor| {
            !valid_hash(&anchor.audio_identity)
                || anchor.identity_scopes.len()
                    > myagents_media_worker_protocol::record_identity::MAX_IDENTITY_PEOPLE
                || anchor
                    .identity_scopes
                    .iter()
                    .any(|scope| scope.is_empty() || !ordered(scope))
        })
        || overrides
            .assignment_anchors
            .iter()
            .any(|(segment, anchor)| {
                !overrides.reassignments.contains_key(segment)
                    || !valid_hash(&anchor.audio_identity)
                    || anchor.operation_revision > overrides.revision
                    || anchor
                        .processing_id
                        .as_ref()
                        .is_some_and(|id| !is_safe_id(id))
                    || !ordered(&anchor.excluded_intervals)
                    || match &anchor.interval {
                        Some(original) => {
                            !valid_interval(original)
                                || anchor.excluded_intervals.iter().any(|excluded| {
                                    excluded.source != original.source
                                        || excluded.start_sample < original.start_sample
                                        || excluded.end_sample > original.end_sample
                                })
                        }
                        None => !anchor.excluded_intervals.is_empty(),
                    }
            })
    {
        return Err("Record human speech anchors are invalid".into());
    }
    Ok(())
}

pub(super) fn person_for_label(model: &RecordDiarizationResult, label: u32) -> u32 {
    // Only real pre-v3 artifacts use model numbers as their historical IDs.
    // New result validation requires a total mapping, including anonymous IDs.
    model.person_bindings.get(&label).copied().unwrap_or(label)
}

fn audio_artifacts(stored: &StoredRecord) -> Vec<RecordArtifact> {
    let mut artifacts = stored
        .record
        .artifacts
        .iter()
        .filter(|artifact| artifact.kind == "audio/ogg-opus")
        .cloned()
        .collect::<Vec<_>>();
    artifacts.sort_by(|a, b| a.path.cmp(&b.path));
    artifacts
}

fn audio_identity(artifacts: &[RecordArtifact]) -> Result<String, String> {
    // Original bytes/source identify an utterance. Correcting the media-time
    // map does not change those bytes; the full map is frozen separately.
    let inventory = artifacts
        .iter()
        .map(|artifact| (&artifact.path, artifact.size_bytes, &artifact.sha256))
        .collect::<Vec<_>>();
    let bytes = serde_json::to_vec(&inventory)
        .map_err(|error| format!("serialize Record audio identity: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn source_artifact(
    artifacts: &[RecordArtifact],
    source: AudioTrackKind,
) -> Option<&RecordArtifact> {
    let path = audio_track_relative_path(source);
    artifacts
        .iter()
        .find(|artifact| artifact.kind == "audio/ogg-opus" && artifact.path == path)
}

pub(super) fn original_interval(
    stored: &StoredRecord,
    source: Option<AudioTrackKind>,
    start: u64,
    end: u64,
) -> Option<OriginalSpeechInterval> {
    let audio = stored.record.audio.as_ref()?;
    let source = source
        .or_else(|| (audio.tracks == [AudioTrackKind::Mixed]).then_some(AudioTrackKind::Mixed))?;
    original_interval_for_inventory(&stored.record.artifacts, source, start, end, false)
}

pub(super) fn original_interval_for_inventory(
    artifacts: &[RecordArtifact],
    source: AudioTrackKind,
    start: u64,
    end: u64,
    source_aware_result: bool,
) -> Option<OriginalSpeechInterval> {
    let artifact = source_artifact(artifacts, source)?;
    if artifact.capture_time_error.is_some() || start >= end {
        return None;
    }
    let (start_sample, end_sample) = match &artifact.capture_timeline {
        Some(timeline) => {
            let mapped = timeline.unmap_interval(start, end)?;
            // A source-aware result used this exact immutable map. Inverting
            // it identifies the original PCM even if the device clock was
            // estimated. It does not make that clock reliable for cross-track
            // simultaneity or AEC; those checks stay in capture/Worker policy.
            if !source_aware_result && !mapped.reliable {
                return None;
            }
            (mapped.start_sample, mapped.end_sample)
        }
        None if source_aware_result || source == AudioTrackKind::Mixed => (start, end),
        // A historical mixed inference over two physical files has no source
        // authority. Missing capture metadata is not a microphone timestamp.
        None => return None,
    };
    (start_sample < end_sample).then_some(OriginalSpeechInterval {
        source,
        start_sample,
        end_sample,
    })
}

fn anchor_for_person(
    stored: &StoredRecord,
    model: &RecordDiarizationResult,
    person: u32,
) -> Result<RecordPersonAnchor, String> {
    let mut anchor = RecordPersonAnchor {
        audio_identity: model
            .source_snapshot
            .as_ref()
            .map(|source| source.audio_identity.clone())
            .unwrap_or(audio_identity(&audio_artifacts(stored))?),
        identity_scopes: vec![Vec::new()],
        has_unresolved_activity: false,
    };
    for turn in &model.turns {
        if turn
            .global_speaker
            .map(|label| person_for_label(model, label))
            != Some(person)
        {
            continue;
        }
        let interval = match (model.source_snapshot.as_ref(), turn.source) {
            (Some(snapshot), Some(source)) => original_interval_for_inventory(
                &snapshot.artifacts,
                source,
                turn.start_sample,
                turn.end_sample,
                true,
            ),
            _ => original_interval(stored, turn.source, turn.start_sample, turn.end_sample),
        };
        match interval {
            Some(interval) => anchor.identity_scopes[0].push(interval),
            None => anchor.has_unresolved_activity = true,
        }
    }
    anchor.identity_scopes[0] =
        merge_original_intervals(std::mem::take(&mut anchor.identity_scopes[0]));
    anchor.identity_scopes.retain(|scope| !scope.is_empty());
    if anchor.interval_count() > MAX_PERSON_ANCHOR_INTERVALS {
        return Err("Record person anchors exceed the fixed limit".into());
    }
    Ok(anchor)
}

fn merge_original_intervals(
    mut intervals: Vec<OriginalSpeechInterval>,
) -> Vec<OriginalSpeechInterval> {
    intervals.sort_by_key(|s| (s.source, s.start_sample, s.end_sample));
    let mut merged: Vec<OriginalSpeechInterval> = Vec::new();
    for interval in intervals {
        if let Some(last) = merged.last_mut() {
            if last.source == interval.source && interval.start_sample <= last.end_sample {
                last.end_sample = last.end_sample.max(interval.end_sample);
                continue;
            }
        }
        merged.push(interval);
    }
    merged
}

/// Called only for an explicit human operation, or once to bind a real legacy
/// operation before its original artifact is reclaimed. Reruns never refresh
/// these anchors from an automatically inherited identity.
pub(super) fn capture_person_anchor(
    stored: &StoredRecord,
    model: &RecordDiarizationResult,
    overrides: &mut RecordSpeakerOverrides,
    person: u32,
) -> Result<(), String> {
    // A name edit or a later merge does not turn an automatically inherited
    // model cluster into new human voice evidence. Preserve original parts.
    if let std::collections::btree_map::Entry::Vacant(entry) =
        overrides.person_anchors.entry(person)
    {
        entry.insert(anchor_for_person(stored, model, person)?);
    }
    Ok(())
}

fn subtract_interval(
    intervals: Vec<OriginalSpeechInterval>,
    removed: &OriginalSpeechInterval,
) -> Vec<OriginalSpeechInterval> {
    let mut result = Vec::new();
    for interval in intervals {
        if interval.source != removed.source
            || interval.end_sample <= removed.start_sample
            || interval.start_sample >= removed.end_sample
        {
            result.push(interval);
            continue;
        }
        if interval.start_sample < removed.start_sample {
            result.push(OriginalSpeechInterval {
                source: interval.source,
                start_sample: interval.start_sample,
                end_sample: removed.start_sample,
            });
        }
        if removed.end_sample < interval.end_sample {
            result.push(OriginalSpeechInterval {
                source: interval.source,
                start_sample: removed.end_sample,
                end_sample: interval.end_sample,
            });
        }
    }
    result
}

/// Paragraph reassignment is a scoped human override, not an assertion that
/// the new target's acoustic identity now includes the donor's entire voice.
/// Mask that exact speech from identity comparisons on both sides; projection
/// reapplies the operation after the target identity has been established.
fn assignment_exclusions(
    overrides: &RecordSpeakerOverrides,
    identity: &str,
) -> Vec<OriginalSpeechInterval> {
    let mut scopes = Vec::new();
    for segment_id in overrides.reassignments.keys() {
        let Some(anchor) = overrides.assignment_anchors.get(segment_id) else {
            continue;
        };
        let Some(interval) = &anchor.interval else {
            continue;
        };
        if anchor.audio_identity != identity {
            continue;
        }
        let mut remaining = vec![interval.clone()];
        for excluded in &anchor.excluded_intervals {
            remaining = subtract_interval(remaining, excluded);
        }
        scopes.extend(remaining);
    }
    merge_original_intervals(scopes)
}

fn effective_anchor_scopes(
    anchors: BTreeMap<u32, RecordPersonAnchor>,
    overrides: &RecordSpeakerOverrides,
    identity: &str,
) -> Result<BTreeMap<u32, RecordPersonAnchor>, String> {
    let exclusions = assignment_exclusions(overrides, identity);
    let mut grouped = BTreeMap::<u32, RecordPersonAnchor>::new();
    for (person, anchor) in anchors {
        let canonical = resolve_merged_speaker(person, &overrides.merges)?;
        let target = grouped
            .entry(canonical)
            .or_insert_with(|| RecordPersonAnchor {
                audio_identity: identity.into(),
                identity_scopes: Vec::new(),
                has_unresolved_activity: false,
            });
        target.has_unresolved_activity |=
            anchor.has_unresolved_activity || anchor.audio_identity != identity;
        for mut scope in anchor.identity_scopes {
            for exclusion in &exclusions {
                scope = subtract_interval(scope, exclusion);
            }
            scope = merge_original_intervals(scope);
            if !scope.is_empty() && !target.identity_scopes.contains(&scope) {
                target.identity_scopes.push(scope);
            }
        }
    }
    if grouped
        .values()
        .map(RecordPersonAnchor::interval_count)
        .sum::<usize>()
        + exclusions.len()
        > MAX_PERSON_ANCHOR_INTERVALS
    {
        return Err("Record person anchors exceed the fixed limit".into());
    }
    Ok(grouped)
}

pub(super) fn capture_assignment_anchor(
    stored: &StoredRecord,
    segment_id: &str,
    revision: u64,
) -> Result<RecordAssignmentAnchor, String> {
    let transcript = read_current_transcript(stored)?.ok_or("Record transcript is unavailable")?;
    let segment = transcript
        .segments
        .iter()
        .find(|segment| segment.segment_id == segment_id)
        .ok_or("Transcript segment not found")?;
    Ok(RecordAssignmentAnchor {
        operation_revision: revision,
        transcript_revision: transcript.projection_revision,
        processing_id: transcript.processing_id.clone(),
        audio_identity: transcript
            .source_snapshot
            .as_ref()
            .map(|source| source.audio_identity.clone())
            .unwrap_or(audio_identity(&audio_artifacts(stored))?),
        interval: match &transcript.source_snapshot {
            Some(snapshot) => original_interval_for_inventory(
                &snapshot.artifacts,
                segment.track,
                segment.start_sample,
                segment.end_sample,
                true,
            ),
            None => original_interval(
                stored,
                Some(segment.track),
                segment.start_sample,
                segment.end_sample,
            ),
        },
        excluded_intervals: Vec::new(),
    })
}

pub(super) fn supersede_assignments(
    overrides: &mut RecordSpeakerOverrides,
    replacement: &RecordAssignmentAnchor,
) -> Result<(), String> {
    let Some(current) = &replacement.interval else {
        return Ok(());
    };
    let mut removed = Vec::new();
    for (id, anchor) in &mut overrides.assignment_anchors {
        let Some(original) = &anchor.interval else {
            continue;
        };
        if anchor.audio_identity != replacement.audio_identity || original.source != current.source
        {
            continue;
        }
        let start_sample = original.start_sample.max(current.start_sample);
        let end_sample = original.end_sample.min(current.end_sample);
        if start_sample >= end_sample {
            continue;
        }
        anchor.excluded_intervals.push(OriginalSpeechInterval {
            source: original.source,
            start_sample,
            end_sample,
        });
        anchor.excluded_intervals =
            merge_original_intervals(std::mem::take(&mut anchor.excluded_intervals));
        if anchor.excluded_intervals.len() == 1 && anchor.excluded_intervals[0] == *original {
            removed.push(id.clone());
        }
    }
    for id in removed {
        overrides.assignment_anchors.remove(&id);
        overrides.reassignments.remove(&id);
    }
    if overrides
        .assignment_anchors
        .values()
        .map(|anchor| anchor.excluded_intervals.len())
        .sum::<usize>()
        > MAX_PERSON_ANCHOR_INTERVALS
    {
        return Err("Record assignment anchors exceed the fixed limit".into());
    }
    Ok(())
}

pub(super) fn assignment_covers(
    anchor: &RecordAssignmentAnchor,
    audio_id: &str,
    current: &OriginalSpeechInterval,
) -> bool {
    let Some(original) = &anchor.interval else {
        return false;
    };
    if anchor.audio_identity != audio_id
        || original.source != current.source
        || anchor.excluded_intervals.iter().any(|excluded| {
            excluded.source == current.source
                && excluded.start_sample < current.end_sample
                && current.start_sample < excluded.end_sample
        })
    {
        return false;
    }
    let overlap = original
        .end_sample
        .min(current.end_sample)
        .saturating_sub(original.start_sample.max(current.start_sample));
    overlap as u128 * 100 >= (current.end_sample - current.start_sample) as u128 * 98
}

fn latest_anchor_is_supported(anchor: &RecordPersonAnchor, verified: &RecordPersonAnchor) -> bool {
    !anchor.has_unresolved_activity
        && anchor.audio_identity == verified.audio_identity
        && anchor.identity_scopes.iter().all(|scope| {
            verified.identity_scopes.iter().any(|old_scope| {
                scope.iter().all(|current| {
                    old_scope.iter().any(|old| {
                        old.source == current.source
                            && old.start_sample <= current.start_sample
                            && old.end_sample >= current.end_sample
                    })
                })
            })
        })
}

pub(super) fn bind_legacy_overrides(
    stored: &StoredRecord,
    model: Option<&RecordDiarizationResult>,
    overrides: &mut RecordSpeakerOverrides,
) -> Result<(), String> {
    if overrides.schema_version == 1 {
        if let Some(model) = model {
            let referenced = overrides
                .renames
                .keys()
                .chain(overrides.merges.keys())
                .chain(overrides.merges.values())
                .chain(overrides.reassignments.values())
                .copied()
                .collect::<BTreeSet<_>>();
            for person in referenced {
                capture_person_anchor(stored, model, overrides, person)?;
            }
            for segment_id in overrides.reassignments.keys().cloned().collect::<Vec<_>>() {
                if let Ok(anchor) =
                    capture_assignment_anchor(stored, &segment_id, overrides.revision)
                {
                    overrides.assignment_anchors.insert(segment_id, anchor);
                }
            }
        }
        // This binds existing facts; it does not create a new human edit.
        overrides.schema_version = 2;
    }
    Ok(())
}

impl RecordStore {
    pub(crate) async fn speech_processing_outcome(
        &self,
        record_id: &str,
        processing_id: &str,
    ) -> Result<Option<bool>, String> {
        let inner = self.inner.read().await;
        let stored = inner.get(record_id).ok_or("Record not found")?;
        let Some(transcript) = read_current_transcript(stored)? else {
            return Ok(None);
        };
        if transcript.state != "recording_final"
            || transcript.processing_id.as_deref() != Some(processing_id)
        {
            return Ok(None);
        }
        let speakers = read_diarization_projection_for_stored(stored)?;
        Ok(Some(speakers.as_ref().is_some_and(|projection| {
            projection.processing_id.as_deref() == Some(processing_id)
                && projection.provenance == transcript.provenance
        })))
    }

    pub(crate) async fn validate_speech_processing_input(
        &self,
        baseline: &RecordSpeechBaseline,
    ) -> Result<(), String> {
        let inner = self.inner.read().await;
        let stored = inner.get(&baseline.record_id).ok_or("Record not found")?;
        validate_baseline(stored, baseline)
    }

    pub(crate) async fn prepare_speech_processing(
        &self,
        id: &str,
    ) -> Result<RecordSpeechBaseline, String> {
        let inner = self.inner.write().await;
        let stored = inner.get(id).ok_or("Record not found")?;
        let audio = stored.record.audio.as_ref().ok_or("Record is not audio")?;
        let transcript_artifact = stored
            .record
            .artifacts
            .iter()
            .find(|a| a.kind == "transcript/recording-final+json")
            .cloned();
        let diarization_artifact = stored
            .record
            .artifacts
            .iter()
            .find(|a| a.kind == "diarization/model-projection+json")
            .cloned();
        let model = diarization_artifact
            .as_ref()
            .map(|artifact| read_owned_diarization_result(id, &stored.path, audio, artifact))
            .transpose()?;
        let mut overrides = read_speaker_overrides(stored)?;
        if overrides.schema_version == 1 {
            bind_legacy_overrides(stored, model.as_ref(), &mut overrides)?;
            write_speaker_overrides(stored, &overrides)?;
        }
        let mut person_anchors = overrides.person_anchors.clone();
        let mut next_person_id = model.as_ref().map_or(0, |model| model.next_person_id);
        if let Some(model) = &model {
            for person in model_speaker_ids(model) {
                next_person_id =
                    next_person_id.max(person.checked_add(1).ok_or("Record person ID exhausted")?);
                if let std::collections::btree_map::Entry::Vacant(entry) =
                    person_anchors.entry(person)
                {
                    entry.insert(anchor_for_person(stored, model, person)?);
                }
            }
        }
        for person in person_anchors.keys() {
            next_person_id =
                next_person_id.max(person.checked_add(1).ok_or("Record person ID exhausted")?);
        }
        if person_anchors
            .values()
            .map(RecordPersonAnchor::interval_count)
            .sum::<usize>()
            > MAX_PERSON_ANCHOR_INTERVALS
        {
            return Err("Record person anchors exceed the fixed limit".into());
        }
        let audio_artifacts = audio_artifacts(stored);
        if audio_artifacts.is_empty() {
            return Err("Record audio is unavailable".into());
        }
        let identity = audio_identity(&audio_artifacts)?;
        let canonical_anchors = effective_anchor_scopes(person_anchors, &overrides, &identity)?;
        Ok(RecordSpeechBaseline {
            record_id: id.into(),
            audio_identity: identity.clone(),
            audio_artifacts,
            transcript_artifact,
            diarization_artifact,
            override_revision: overrides.revision,
            person_anchors: canonical_anchors,
            assignment_exclusions: assignment_exclusions(&overrides, &identity),
            next_person_id,
        })
    }

    /// Manager holds its publication authorization lock for this call. Store
    /// re-reads current human facts under its own lock and changes all computed
    /// artifact references in one existing Record manifest write.
    pub(crate) async fn commit_speech_processing(
        &self,
        baseline: &RecordSpeechBaseline,
        processing_id: &str,
        segments: Vec<RecordTranscriptSegment>,
        turns: Option<Vec<RecordSpeakerTurn>>,
        evidence: Vec<PersonMatchEvidence>,
        provenance: RecordSpeechProvenance,
    ) -> Result<(), String> {
        let mut segments = SensitiveTranscriptInput(segments);
        if !is_safe_id(processing_id) {
            return Err("Invalid speech processing identity".into());
        }
        let mut inner = self.inner.write().await;
        let stored = inner
            .get(&baseline.record_id)
            .cloned()
            .ok_or("Record not found")?;
        validate_baseline(&stored, baseline)?;
        let audio = stored.record.audio.as_ref().ok_or("Record is not audio")?;
        validate_transcript_segments(audio, &segments.0)?;
        validate_speech_provenance(&provenance)?;
        if turns.is_none() && baseline.transcript_artifact.is_some() {
            return Err("Incomplete processing cannot replace an existing final transcript".into());
        }
        let overrides = read_speaker_overrides(&stored)?;
        let revision = stored
            .record
            .revision
            .checked_add(1)
            .ok_or("Record revision exhausted")?;
        let snapshot = RecordTranscriptSnapshot {
            schema_version: 2,
            record_id: baseline.record_id.clone(),
            projection_revision: revision,
            processing_id: Some(processing_id.into()),
            state: "recording_final".into(),
            source_snapshot: Some(RecordSpeechSourceSnapshot {
                audio_identity: baseline.audio_identity.clone(),
                artifacts: baseline.audio_artifacts.clone(),
            }),
            sample_rate: SPEECH_SAMPLE_RATE as u32,
            provenance: provenance.clone(),
            segments: std::mem::take(&mut segments.0),
        };
        let result = if let Some(turns) = turns {
            validate_speaker_turns(audio, &turns)?;
            if turns.iter().any(|turn| turn.source.is_none()) {
                return Err("New speaker observations require their source".into());
            }
            let (person_bindings, next_person_id) =
                bind_people(baseline, &overrides, &turns, &evidence)?;
            let inherited_assignments =
                inherit_assignments(&snapshot, &turns, &person_bindings, &overrides)?;
            Some(RecordDiarizationResult {
                schema_version: 3,
                record_id: baseline.record_id.clone(),
                projection_revision: revision,
                processing_id: Some(processing_id.into()),
                sample_rate: SPEECH_SAMPLE_RATE as u32,
                source_snapshot: snapshot.source_snapshot.clone(),
                provenance,
                turns,
                person_bindings,
                next_person_id,
                inherited_assignments,
            })
        } else {
            if !evidence.is_empty() {
                return Err("Identity evidence without speaker results".into());
            }
            None
        };
        let mut artifacts = Vec::new();
        let mut bytes =
            serde_json::to_vec(&snapshot).map_err(|_| "Serialize transcript candidate")?;
        let written =
            write_speech_projection(&stored.path, SpeechProjectionKind::Transcript, &bytes);
        bytes.zeroize();
        artifacts.push(written?);
        if let Some(result) = result {
            let written = serde_json::to_vec(&result)
                .map_err(|_| "Serialize speaker candidate".to_string())
                .and_then(|bytes| {
                    write_speech_projection(&stored.path, SpeechProjectionKind::Diarization, &bytes)
                });
            match written {
                Ok(artifact) => artifacts.push(artifact),
                Err(error) => {
                    for artifact in &artifacts {
                        remove_owned_speech_projection(&stored.path, artifact);
                    }
                    return Err(error);
                }
            }
        }
        let mut updated = stored.record.clone();
        for artifact in &artifacts {
            replace_record_artifact(&mut updated.artifacts, artifact.clone(), &artifact.kind);
        }
        if artifacts.len() == 1 {
            updated
                .artifacts
                .retain(|artifact| artifact.kind != "diarization/model-projection+json");
        }
        let audio = updated.audio.as_mut().ok_or("Record is not audio")?;
        audio.transcription_status = TranscriptionStatus::Ready;
        audio.diarization_status = if artifacts.len() == 2 {
            DiarizationStatus::Ready
        } else {
            DiarizationStatus::Failed
        };
        updated.updated_at = now_ms();
        updated.revision = revision;
        publish_speech_projections(&stored, &updated, &artifacts)?;
        updated = refresh_audio_discussion_document_best_effort(&stored, updated);
        inner.insert(
            baseline.record_id.clone(),
            StoredRecord {
                record: updated,
                ..stored
            },
        );
        self.emit_change(&baseline.record_id, RecordChangeKind::Upsert);
        Ok(())
    }
}

pub(super) fn validate_baseline(
    stored: &StoredRecord,
    baseline: &RecordSpeechBaseline,
) -> Result<(), String> {
    if stored.record.id != baseline.record_id
        || audio_artifacts(stored) != baseline.audio_artifacts
        || stored
            .record
            .artifacts
            .iter()
            .find(|a| a.kind == "transcript/recording-final+json")
            != baseline.transcript_artifact.as_ref()
        || stored
            .record
            .artifacts
            .iter()
            .find(|a| a.kind == "diarization/model-projection+json")
            != baseline.diarization_artifact.as_ref()
    {
        return Err("Record speech baseline changed".into());
    }
    // The inventory alone is insufficient if bytes changed behind the Store.
    for artifact in &baseline.audio_artifacts {
        let relative = validate_record_relative_path(&artifact.path)?;
        let path = resolve_plain_record_artifact(&stored.path, &relative)?;
        let actual = record_artifact_from_file(&path, &relative, &artifact.kind)?;
        if actual.sha256 != artifact.sha256 || actual.size_bytes != artifact.size_bytes {
            return Err("Record source audio changed".into());
        }
    }
    Ok(())
}

fn bind_people(
    baseline: &RecordSpeechBaseline,
    overrides: &RecordSpeakerOverrides,
    turns: &[RecordSpeakerTurn],
    evidence: &[PersonMatchEvidence],
) -> Result<(BTreeMap<u32, u32>, u32), String> {
    let labels = turns
        .iter()
        .filter_map(|turn| turn.global_speaker)
        .collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    let mut proposed: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    let mut accepted_anchors = BTreeMap::new();
    let mut accepted_labels = BTreeMap::<u32, BTreeSet<u32>>::new();
    let latest_scopes = effective_anchor_scopes(
        overrides.person_anchors.clone(),
        overrides,
        &baseline.audio_identity,
    )?;
    if evidence.len() > myagents_media_worker_protocol::record_identity::MAX_IDENTITY_PEOPLE {
        return Err("Record identity evidence exceeds the fixed limit".into());
    }
    for proof in evidence {
        if !proof.has_valid_shape()
            || !seen.insert(proof.person_id)
            || !baseline.person_anchors.contains_key(&proof.person_id)
            || proof
                .model_labels
                .iter()
                .any(|label| !labels.contains(label))
        {
            return Err("Record identity evidence is invalid".into());
        }
        let anchor = &baseline.person_anchors[&proof.person_id];
        if proof.reference_samples
            != anchor
                .intervals()
                .iter()
                .map(|interval| interval.end_sample - interval.start_sample)
                .sum::<u64>()
        {
            return Err("Record identity reference inventory mismatch".into());
        }
        if proof.is_accepted()
            && !anchor.has_unresolved_activity
            && anchor.audio_identity == baseline.audio_identity
        {
            accepted_anchors.insert(proof.person_id, anchor.clone());
            let canonical = resolve_merged_speaker(proof.person_id, &overrides.merges)?;
            accepted_labels
                .entry(canonical)
                .or_default()
                .extend(proof.model_labels.iter().copied());
        }
    }
    // A merge made during processing can reuse the independent proofs for
    // its original identities. It does not need a new acoustic same-voice
    // verdict. Every current human identity scope must still have support.
    let verified_scopes =
        effective_anchor_scopes(accepted_anchors, overrides, &baseline.audio_identity)?;
    for (person, labels) in accepted_labels {
        let Some(verified) = verified_scopes.get(&person) else {
            continue;
        };
        if latest_scopes
            .get(&person)
            .is_some_and(|latest| !latest_anchor_is_supported(latest, verified))
        {
            continue;
        }
        for label in labels {
            proposed.entry(label).or_default().push(person);
        }
    }
    // An accepted proposal is still not authority to choose between two old
    // identities. Reject every competing relationship, including split siblings.
    let conflicted = proposed
        .values()
        .filter(|people| people.len() > 1)
        .flatten()
        .copied()
        .collect::<BTreeSet<_>>();
    let mut next = baseline.next_person_id;
    for person in overrides.person_anchors.keys() {
        next = next.max(person.checked_add(1).ok_or("Record person ID exhausted")?);
    }
    let mut bindings = BTreeMap::new();
    for turn in turns {
        let Some(label) = turn.global_speaker else {
            continue;
        };
        if bindings.contains_key(&label) {
            continue;
        }
        let proposed = proposed
            .get(&label)
            .filter(|people| people.len() == 1)
            .and_then(|people| (!conflicted.contains(&people[0])).then_some(people[0]));
        let person = match proposed {
            Some(person) => person,
            None => {
                let allocated = next;
                next = next.checked_add(1).ok_or("Record person ID exhausted")?;
                allocated
            }
        };
        bindings.insert(label, person);
    }
    Ok((bindings, next))
}

fn inherit_assignments(
    transcript: &RecordTranscriptSnapshot,
    turns: &[RecordSpeakerTurn],
    bindings: &BTreeMap<u32, u32>,
    overrides: &RecordSpeakerOverrides,
) -> Result<BTreeMap<String, RecordInheritedAssignment>, String> {
    let source = transcript
        .source_snapshot
        .as_ref()
        .ok_or("Record speech source snapshot is missing")?;
    let audio_id = &source.audio_identity;
    let active = bindings.values().copied().collect::<BTreeSet<_>>();
    let mut inherited = BTreeMap::new();
    for segment in &transcript.segments {
        let Some(current) = original_interval_for_inventory(
            &source.artifacts,
            segment.track,
            segment.start_sample,
            segment.end_sample,
            true,
        ) else {
            continue;
        };
        let mut candidate = None;
        let mut ambiguous = false;
        for (original_segment_id, target) in &overrides.reassignments {
            let Some(anchor) = overrides.assignment_anchors.get(original_segment_id) else {
                continue;
            };
            let Some(original) = &anchor.interval else {
                continue;
            };
            // A split may inherit when essentially all of its new utterance is
            // inside the original operation. A merged paragraph with added
            // material cannot acquire a blanket assignment.
            if !assignment_covers(anchor, audio_id, &current) {
                continue;
            }
            let target = resolve_merged_speaker(*target, &overrides.merges)?;
            if !active.contains(&target) {
                continue;
            }
            // The target's identity must be established, but the model's label
            // on this exact paragraph may be wrong: correcting it is the point
            // of the user's explicit reassignment.
            let known_other_content = turns.iter().any(|turn| {
                turn.source == Some(segment.track)
                    && turn.start_sample < segment.end_sample
                    && turn.end_sample > segment.start_sample
                    && original_interval_for_inventory(
                        &source.artifacts,
                        segment.track,
                        turn.start_sample.max(segment.start_sample),
                        turn.end_sample.min(segment.end_sample),
                        true,
                    )
                    .is_some_and(|interval| {
                        interval.start_sample < original.start_sample
                            || interval.end_sample > original.end_sample
                    })
            });
            if known_other_content {
                continue;
            }
            if candidate
                .as_ref()
                .is_some_and(|value: &RecordInheritedAssignment| value.speaker_id != target)
            {
                ambiguous = true;
                break;
            }
            candidate = Some(RecordInheritedAssignment {
                original_segment_id: original_segment_id.clone(),
                operation_revision: anchor.operation_revision,
                speaker_id: target,
            });
        }
        if !ambiguous {
            if let Some(candidate) = candidate {
                inherited.insert(segment.segment_id.clone(), candidate);
            }
        }
    }
    Ok(inherited)
}
