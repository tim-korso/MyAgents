//! Temporary, Record-local verification of original human speech anchors.
//! Uses the already loaded diarizer's raw evidence, one bounded original PCM
//! clip at a time. Neither vectors nor a synthesized voice identity leave here.
use crate::diarization::{
    FinalIdentityView, LocalSegment, WindowObservation, WindowSpec, cosine_distance,
    normalized_embedding,
};
use crate::protocol::record_identity::{
    IdentityAnchorDocument, IdentityAnchorInput, MAX_IDENTITY_DOCUMENT_BYTES,
    MAX_IDENTITY_LABELS_PER_PERSON, OriginalSpeechInterval, PersonMatchEvidence,
};
use crate::protocol::record_timeline::CaptureTimeQuality;
use crate::protocol::{RecordArtifactInput, TrackKind};
use crate::record_opus::RecordOpusDecoder;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::Read;
use std::path::Path;
use zeroize::Zeroizing;

const CLIP_SAMPLES: u64 = 4 * 16_000;
const CONTEXT_SAMPLES: u64 = 10 * 16_000;
const MIN_WITNESS_SAMPLES: u64 = 2 * 16_000;
const CROSS_SOURCE_TOLERANCE: u64 = 8_000;
const MAX_VERIFICATION_CLIPS: usize = 32_768;

pub fn read_anchors(input: &IdentityAnchorInput) -> Result<IdentityAnchorDocument, &'static str> {
    let path = Path::new(&input.path);
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| "SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() == 0
        || metadata.len() > MAX_IDENTITY_DOCUMENT_BYTES
    {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(metadata.len() as usize));
    std::fs::File::open(path)
        .map_err(|_| "SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?
        .take(MAX_IDENTITY_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "SPEECH_RECORD_CANDIDATE_UNAVAILABLE")?;
    if bytes.len() as u64 > MAX_IDENTITY_DOCUMENT_BYTES
        || format!("{:x}", Sha256::digest(&bytes)) != input.sha256
    {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    let document: IdentityAnchorDocument =
        serde_json::from_slice(&bytes).map_err(|_| "SPEECH_RECORD_CANDIDATE_INVALID")?;
    if !document.has_valid_shape() {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    Ok(document)
}

struct Verification {
    evidence: PersonMatchEvidence,
    // Union in Record coordinates prevents two observations of the same PCM
    // or source echo from counting as two independent clean speech spans.
    scopes: Vec<ScopeVerification>,
}
struct ScopeVerification {
    labels: Vec<u32>,
    witnessed_activity: Vec<LocalSegment>,
    clean_spans: u32,
}

#[derive(Clone, Copy)]
struct VerificationClip {
    index: u32,
    person: usize,
    scope: usize,
    target: LocalSegment,
    context: LocalSegment,
}

/// The callback invokes the same DiarizerEngine used for the new transcript.
/// Its exclusion mask constrains voice extraction, while surrounding original
/// audio remains available to the segmentation model. No cross-person splice
/// or second embedding extractor is involved.
pub fn reconcile<F>(
    document: &IdentityAnchorDocument,
    inputs: &[RecordArtifactInput],
    view: FinalIdentityView<'_>,
    mut observe: F,
) -> Result<Vec<PersonMatchEvidence>, &'static str>
where
    F: FnMut(WindowSpec, &[f32], &[LocalSegment]) -> Result<WindowObservation, &'static str>,
{
    if !document.has_valid_shape() {
        return Err("SPEECH_RECORD_CANDIDATE_INVALID");
    }
    let segments = exclude_assigned_activity(document, inputs, view.segments);
    let view = FinalIdentityView {
        segments: &segments,
        ..view
    };
    let mut verifications = document
        .people
        .iter()
        .map(|person| {
            let intervals = union(person.identity_scopes.iter().flatten().cloned().collect());
            let mut evidence = PersonMatchEvidence {
                person_id: person.person_id,
                model_labels: vec![],
                reference_samples: duration(&intervals),
                reference_covered_samples: 0,
                candidate_samples: 0,
                candidate_covered_samples: 0,
                independent_clean_spans: 0,
                maximum_voice_distance: 0,
                nearest_alternative_distance: 3_000_000,
                activity_conflict: false,
                has_unresolved_activity: person.has_unresolved_activity,
            };
            for label in view.labels.iter().copied().collect::<BTreeSet<_>>() {
                let mut total = 0_u64;
                let mut covered = 0_u64;
                for turn in view
                    .segments
                    .iter()
                    .filter(|s| s.global_speaker == Some(label))
                {
                    total += turn.end_sample - turn.start_sample;
                    covered += covered_record(
                        turn.source,
                        LocalSegment {
                            start_sample: turn.start_sample,
                            end_sample: turn.end_sample,
                        },
                        &intervals,
                        inputs,
                    );
                }
                if total > 0 && covered as u128 * 100 >= total as u128 * 95 {
                    evidence.model_labels.push(label);
                    evidence.candidate_samples += total;
                    evidence.candidate_covered_samples += covered;
                }
            }
            if evidence.model_labels.len() > MAX_IDENTITY_LABELS_PER_PERSON {
                evidence.model_labels.clear();
                evidence.has_unresolved_activity = true;
            }
            // Coverage answers whether the old utterances are represented in the
            // new identity. Clean embedding eligibility is a separate fact: short
            // or overlapping speech is not silently removed from this denominator.
            for interval in &intervals {
                let matching = view
                    .segments
                    .iter()
                    .filter(|s| {
                        s.global_speaker
                            .is_some_and(|label| evidence.model_labels.contains(&label))
                    })
                    .filter_map(|turn| {
                        candidate_in_source(
                            turn.source,
                            LocalSegment {
                                start_sample: turn.start_sample,
                                end_sample: turn.end_sample,
                            },
                            interval.source,
                            inputs,
                        )
                    })
                    .filter_map(|candidate| intersection(candidate, as_local(interval)))
                    .collect::<Vec<_>>();
                evidence.reference_covered_samples += local_duration(&matching);
            }
            let scopes = person
                .identity_scopes
                .iter()
                .map(|scope| {
                    let direct_labels = evidence
                        .model_labels
                        .iter()
                        .copied()
                        .filter(|label| covered_scope(&[*label], scope, &view, inputs, true) > 0)
                        .collect::<Vec<_>>();
                    // Physical correspondence outranks clock-coincident speech from
                    // another source. Cross-source echo removal may remove that direct
                    // correspondence; only then consider the reliable mapped source.
                    let labels =
                        if covered_scope(&direct_labels, scope, &view, inputs, true) as u128 * 100
                            >= duration(scope) as u128 * 95
                        {
                            direct_labels
                        } else {
                            evidence
                                .model_labels
                                .iter()
                                .copied()
                                .filter(|label| {
                                    covered_scope(&[*label], scope, &view, inputs, false) > 0
                                })
                                .collect::<Vec<_>>()
                        };
                    let covered = covered_scope(&labels, scope, &view, inputs, false);
                    if covered as u128 * 100 < duration(scope) as u128 * 95 {
                        evidence.has_unresolved_activity = true;
                    }
                    // An automatically split original identity needs complete-link
                    // evidence to reunite. Different original identities related by a
                    // human merge are verified separately; their voices may differ.
                    for (a, left) in view.prototypes.iter().zip(view.labels) {
                        if !labels.contains(left) {
                            continue;
                        }
                        for (b, right) in view.prototypes.iter().zip(view.labels) {
                            if left >= right || !labels.contains(right) {
                                continue;
                            }
                            for x in &a.witnesses {
                                for y in &b.witnesses {
                                    evidence.maximum_voice_distance = evidence
                                        .maximum_voice_distance
                                        .max(millionths_up(cosine_distance(x, y)));
                                }
                            }
                        }
                    }
                    evidence.activity_conflict |= view
                        .conflicts
                        .iter()
                        .any(|(a, b)| labels.contains(a) && labels.contains(b));
                    ScopeVerification {
                        labels,
                        witnessed_activity: Vec::new(),
                        clean_spans: 0,
                    }
                })
                .collect();
            if intervals
                .iter()
                .any(|i| !inputs.iter().any(|input| input.track == i.source))
            {
                evidence.has_unresolved_activity = true;
            }
            Verification { evidence, scopes }
        })
        .collect::<Vec<_>>();

    let mut clip_budget = MAX_VERIFICATION_CLIPS;
    for input in inputs {
        let clips = plan_clips(document, &verifications, input, &mut clip_budget)?;
        if clips.is_empty() {
            continue;
        }
        let mut decoder = RecordOpusDecoder::open(Path::new(&input.input_path))
            .map_err(|_| "SPEECH_SOURCE_CHANGED")?;
        let mut clip_index = 0;
        let mut buffer_start = clips[0].context.start_sample;
        let mut decoded_end = 0;
        let mut pcm = Zeroizing::new(Vec::<f32>::with_capacity(CONTEXT_SAMPLES as usize + 320));
        while let Some(chunk) = decoder.read_chunk().map_err(|_| "SPEECH_SOURCE_CHANGED")? {
            decoded_end = chunk.start_sample() + chunk.frames() as u64;
            for (offset, sample) in chunk.mono_samples().enumerate() {
                if chunk.start_sample() + offset as u64 >= buffer_start {
                    pcm.push(sample);
                }
            }
            if pcm.len() as u64 > CONTEXT_SAMPLES + 320 {
                return Err("SPEECH_RESOURCE_LIMIT");
            }
            while clip_index < clips.len() && clips[clip_index].context.end_sample <= decoded_end {
                verify_clip(
                    clips[clip_index],
                    input,
                    buffer_start,
                    &pcm,
                    &view,
                    &mut verifications,
                    &mut observe,
                )?;
                clip_index += 1;
                if clip_index < clips.len() {
                    trim_context(
                        &mut pcm,
                        &mut buffer_start,
                        clips[clip_index].context.start_sample,
                    );
                }
            }
            if clip_index == clips.len() {
                break;
            }
        }
        // A legacy source has no declared sample count. Only context may be
        // shortened at its actual EOF; missing requested speech is an error.
        while clip_index < clips.len() {
            let mut clip = clips[clip_index];
            if clip.target.end_sample > decoded_end {
                return Err("SPEECH_SOURCE_CHANGED");
            }
            clip.context.end_sample = clip.context.end_sample.min(decoded_end);
            verify_clip(
                clip,
                input,
                buffer_start,
                &pcm,
                &view,
                &mut verifications,
                &mut observe,
            )?;
            clip_index += 1;
            if clip_index < clips.len() {
                trim_context(
                    &mut pcm,
                    &mut buffer_start,
                    clips[clip_index].context.start_sample,
                );
            }
        }
    }
    for verification in &mut verifications {
        verification.evidence.independent_clean_spans = verification
            .scopes
            .iter()
            .map(|scope| scope.clean_spans)
            .min()
            .unwrap_or(0);
    }
    if verifications.iter().any(|v| !v.evidence.has_valid_shape()) {
        return Err("SPEECH_WORKER_PROTOCOL_ERROR");
    }
    Ok(verifications.into_iter().map(|v| v.evidence).collect())
}

fn trim_context(pcm: &mut Vec<f32>, start: &mut u64, next: u64) {
    let removed = next.saturating_sub(*start).min(pcm.len() as u64) as usize;
    pcm[..removed].fill(0.0);
    pcm.drain(..removed);
    *start = next;
}

fn verify_clip<F>(
    clip: VerificationClip,
    input: &RecordArtifactInput,
    buffer_start: u64,
    pcm: &[f32],
    view: &FinalIdentityView<'_>,
    verifications: &mut [Verification],
    observe: &mut F,
) -> Result<(), &'static str>
where
    F: FnMut(WindowSpec, &[f32], &[LocalSegment]) -> Result<WindowObservation, &'static str>,
{
    let start = clip
        .context
        .start_sample
        .checked_sub(buffer_start)
        .ok_or("SPEECH_SOURCE_CHANGED")? as usize;
    let end = clip
        .context
        .end_sample
        .checked_sub(buffer_start)
        .ok_or("SPEECH_SOURCE_CHANGED")? as usize;
    let samples = pcm
        .get(start..end)
        .filter(|s| !s.is_empty())
        .ok_or("SPEECH_SOURCE_CHANGED")?;
    let excluded = [
        LocalSegment {
            start_sample: 0,
            end_sample: clip.target.start_sample - clip.context.start_sample,
        },
        LocalSegment {
            start_sample: clip.target.end_sample - clip.context.start_sample,
            end_sample: samples.len() as u64,
        },
    ]
    .into_iter()
    .filter(|s| s.start_sample < s.end_sample)
    .collect::<Vec<_>>();
    let observation = observe(
        WindowSpec {
            index: clip.index,
            source: input.track,
            start_sample: clip.context.start_sample,
            end_sample: clip.context.end_sample,
            time_reliable: false,
        },
        samples,
        &excluded,
    )?;
    let verification = &mut verifications[clip.person];
    let scope = &mut verification.scopes[clip.scope];
    for raw in &observation.speakers {
        let clean = raw
            .clean_segments
            .iter()
            .map(|s| LocalSegment {
                start_sample: s.start_sample + observation.window.start_sample,
                end_sample: s.end_sample + observation.window.start_sample,
            })
            .collect::<Vec<_>>();
        if clean.iter().any(|s| {
            s.start_sample < clip.target.start_sample || s.end_sample > clip.target.end_sample
        }) {
            return Err("SPEECH_INFERENCE_FAILED");
        }
        if raw.embedding_status != 0 || local_duration(&clean) < MIN_WITNESS_SAMPLES {
            continue;
        }
        let vector = Zeroizing::new(
            normalized_embedding(&raw.embedding).map_err(|_| "SPEECH_INFERENCE_FAILED")?,
        );
        let mut matched = 3.0_f64;
        let mut alternative = 3.0_f64;
        for (prototype, label) in view.prototypes.iter().zip(view.labels) {
            for witness in &prototype.witnesses {
                let distance = cosine_distance(&vector, witness);
                if scope.labels.contains(label) {
                    matched = matched.min(distance);
                } else if !verification.evidence.model_labels.contains(label) {
                    alternative = alternative.min(distance);
                }
            }
        }
        verification.evidence.maximum_voice_distance = verification
            .evidence
            .maximum_voice_distance
            .max(millionths_up(matched));
        verification.evidence.nearest_alternative_distance = verification
            .evidence
            .nearest_alternative_distance
            .min(millionths_down(alternative));
        let clean = clean
            .into_iter()
            .filter_map(|s| {
                if let Some(timeline) = &input.timeline {
                    timeline
                        .map_interval(s.start_sample, s.end_sample)
                        .map(|s| LocalSegment {
                            start_sample: s.start_sample,
                            end_sample: s.end_sample,
                        })
                } else {
                    Some(s)
                }
            })
            .collect::<Vec<_>>();
        let previous = local_duration(&scope.witnessed_activity);
        let mut union = scope.witnessed_activity.clone();
        union.extend(clean);
        if local_duration(&union).saturating_sub(previous) >= MIN_WITNESS_SAMPLES {
            scope.clean_spans += 1;
        }
        // Compact the one-person temporal support after every clip. It cannot
        // grow with repeated model windows or duplicate source observations.
        scope.witnessed_activity = union_local(union);
    }
    Ok(())
}

fn plan_clips(
    document: &IdentityAnchorDocument,
    verifications: &[Verification],
    input: &RecordArtifactInput,
    budget: &mut usize,
) -> Result<Vec<VerificationClip>, &'static str> {
    let mut clips = Vec::new();
    for (person, (anchor, verification)) in document.people.iter().zip(verifications).enumerate() {
        if verification.evidence.has_unresolved_activity
            || verification.evidence.model_labels.is_empty()
            || verification.evidence.activity_conflict
        {
            continue;
        }
        for (scope, intervals) in anchor.identity_scopes.iter().enumerate() {
            for interval in intervals.iter().filter(|i| i.source == input.track) {
                let extents = if let Some(timeline) = &input.timeline {
                    timeline
                        .spans
                        .iter()
                        .filter(|span| span.quality != CaptureTimeQuality::Gap)
                        .filter_map(|span| {
                            let context = LocalSegment {
                                start_sample: span.source_start,
                                end_sample: span.source_end,
                            };
                            intersection(as_local(interval), context)
                                .map(|target| (target, context))
                        })
                        .collect::<Vec<_>>()
                } else {
                    vec![(
                        as_local(interval),
                        LocalSegment {
                            start_sample: 0,
                            end_sample: crate::protocol::MAX_MEDIA_SAMPLES_PER_TRACK,
                        },
                    )]
                };
                for (extent, boundary) in extents {
                    let length = extent.end_sample - extent.start_sample;
                    let count = length.div_ceil(CLIP_SAMPLES);
                    for part in 0..count {
                        let target = LocalSegment {
                            start_sample: extent.start_sample + length * part / count,
                            end_sample: extent.start_sample + length * (part + 1) / count,
                        };
                        if target.end_sample - target.start_sample < MIN_WITNESS_SAMPLES {
                            continue;
                        }
                        if *budget == 0 {
                            return Err("SPEECH_RESOURCE_LIMIT");
                        }
                        *budget -= 1;
                        let context_start = ((target.start_sample + target.end_sample) / 2)
                            .saturating_sub(CONTEXT_SAMPLES / 2)
                            .min(boundary.end_sample.saturating_sub(CONTEXT_SAMPLES))
                            .max(boundary.start_sample);
                        let context = LocalSegment {
                            start_sample: context_start,
                            end_sample: (context_start + CONTEXT_SAMPLES).min(boundary.end_sample),
                        };
                        clips.push(VerificationClip {
                            index: 0,
                            person,
                            scope,
                            target,
                            context,
                        });
                    }
                }
            }
        }
    }
    clips.sort_by_key(|clip| {
        (
            clip.context.start_sample,
            clip.context.end_sample,
            clip.person,
            clip.scope,
            clip.target.start_sample,
        )
    });
    for (index, clip) in clips.iter_mut().enumerate() {
        clip.index = index as u32;
    }
    Ok(clips)
}

fn exclude_assigned_activity(
    document: &IdentityAnchorDocument,
    inputs: &[RecordArtifactInput],
    turns: &[crate::diarization::GlobalSpeakerSegment],
) -> Vec<crate::diarization::GlobalSpeakerSegment> {
    turns
        .iter()
        .flat_map(|turn| {
            let mut intervals = vec![LocalSegment {
                start_sample: turn.start_sample,
                end_sample: turn.end_sample,
            }];
            for excluded in document
                .assignment_exclusions
                .iter()
                .filter(|s| s.source == turn.source)
            {
                let Some(input) = inputs.iter().find(|input| input.track == turn.source) else {
                    continue;
                };
                let excluded = if let Some(timeline) = &input.timeline {
                    let Some(mapped) =
                        timeline.map_interval(excluded.start_sample, excluded.end_sample)
                    else {
                        continue;
                    };
                    LocalSegment {
                        start_sample: mapped.start_sample,
                        end_sample: mapped.end_sample,
                    }
                } else {
                    as_local(excluded)
                };
                intervals = intervals
                    .into_iter()
                    .flat_map(|interval| {
                        let Some(overlap) = intersection(interval, excluded) else {
                            return vec![interval];
                        };
                        [
                            LocalSegment {
                                start_sample: interval.start_sample,
                                end_sample: overlap.start_sample,
                            },
                            LocalSegment {
                                start_sample: overlap.end_sample,
                                end_sample: interval.end_sample,
                            },
                        ]
                        .into_iter()
                        .filter(|s| s.start_sample < s.end_sample)
                        .collect()
                    })
                    .collect();
            }
            intervals
                .into_iter()
                .map(|interval| crate::diarization::GlobalSpeakerSegment {
                    start_sample: interval.start_sample,
                    end_sample: interval.end_sample,
                    ..*turn
                })
        })
        .collect()
}

fn union_local(intervals: Vec<LocalSegment>) -> Vec<LocalSegment> {
    union(
        intervals
            .into_iter()
            .map(|s| OriginalSpeechInterval {
                source: TrackKind::Mixed,
                start_sample: s.start_sample,
                end_sample: s.end_sample,
            })
            .collect(),
    )
    .into_iter()
    .map(|s| as_local(&s))
    .collect()
}

fn covered_scope(
    labels: &[u32],
    scope: &[OriginalSpeechInterval],
    view: &FinalIdentityView<'_>,
    inputs: &[RecordArtifactInput],
    same_source: bool,
) -> u64 {
    scope
        .iter()
        .map(|interval| {
            let matching = view
                .segments
                .iter()
                .filter(|s| {
                    (!same_source || s.source == interval.source)
                        && s.global_speaker
                            .is_some_and(|label| labels.contains(&label))
                })
                .filter_map(|turn| {
                    candidate_in_source(
                        turn.source,
                        LocalSegment {
                            start_sample: turn.start_sample,
                            end_sample: turn.end_sample,
                        },
                        interval.source,
                        inputs,
                    )
                })
                .filter_map(|candidate| intersection(candidate, as_local(interval)))
                .collect::<Vec<_>>();
            local_duration(&matching)
        })
        .sum()
}

fn covered_record(
    source: TrackKind,
    turn: LocalSegment,
    anchors: &[OriginalSpeechInterval],
    inputs: &[RecordArtifactInput],
) -> u64 {
    let intersections = anchors
        .iter()
        .filter_map(|anchor| {
            let input = inputs.iter().find(|input| input.track == anchor.source)?;
            let mapped = if let Some(timeline) = &input.timeline {
                let mapped = timeline.map_interval(anchor.start_sample, anchor.end_sample)?;
                if source != anchor.source && !mapped.reliable {
                    return None;
                }
                LocalSegment {
                    start_sample: mapped.start_sample,
                    end_sample: mapped.end_sample,
                }
            } else if source == anchor.source {
                as_local(anchor)
            } else {
                return None;
            };
            if source != anchor.source {
                let target = inputs
                    .iter()
                    .find(|input| input.track == source)?
                    .timeline
                    .as_ref()?
                    .unmap_interval(turn.start_sample, turn.end_sample)?;
                if !target.reliable {
                    return None;
                }
            }
            let mapped = if source == anchor.source {
                mapped
            } else {
                expand(mapped, CROSS_SOURCE_TOLERANCE)
            };
            intersection(turn, mapped)
        })
        .collect::<Vec<_>>();
    local_duration(&intersections)
}

fn candidate_in_source(
    source: TrackKind,
    turn: LocalSegment,
    target: TrackKind,
    inputs: &[RecordArtifactInput],
) -> Option<LocalSegment> {
    let target_input = inputs.iter().find(|input| input.track == target)?;
    if source == target {
        return if let Some(timeline) = &target_input.timeline {
            let mapped = timeline.unmap_interval(turn.start_sample, turn.end_sample)?;
            Some(LocalSegment {
                start_sample: mapped.start_sample,
                end_sample: mapped.end_sample,
            })
        } else {
            Some(turn)
        };
    }
    let source_map = inputs
        .iter()
        .find(|input| input.track == source)?
        .timeline
        .as_ref()?;
    if !source_map
        .unmap_interval(turn.start_sample, turn.end_sample)?
        .reliable
    {
        return None;
    }
    let target_map = target_input.timeline.as_ref()?;
    let mapped = target_map.unmap_interval(turn.start_sample, turn.end_sample)?;
    if !mapped.reliable {
        return None;
    }
    Some(expand(
        LocalSegment {
            start_sample: mapped.start_sample,
            end_sample: mapped.end_sample,
        },
        CROSS_SOURCE_TOLERANCE,
    ))
}
fn expand(s: LocalSegment, amount: u64) -> LocalSegment {
    LocalSegment {
        start_sample: s.start_sample.saturating_sub(amount),
        end_sample: s.end_sample.saturating_add(amount),
    }
}
fn intersection(a: LocalSegment, b: LocalSegment) -> Option<LocalSegment> {
    let start_sample = a.start_sample.max(b.start_sample);
    let end_sample = a.end_sample.min(b.end_sample);
    (start_sample < end_sample).then_some(LocalSegment {
        start_sample,
        end_sample,
    })
}
fn as_local(i: &OriginalSpeechInterval) -> LocalSegment {
    LocalSegment {
        start_sample: i.start_sample,
        end_sample: i.end_sample,
    }
}
fn union(mut intervals: Vec<OriginalSpeechInterval>) -> Vec<OriginalSpeechInterval> {
    intervals.sort_by_key(|i| (i.source, i.start_sample, i.end_sample));
    let mut result: Vec<OriginalSpeechInterval> = Vec::new();
    for interval in intervals {
        if let Some(last) = result.last_mut()
            && last.source == interval.source
            && interval.start_sample <= last.end_sample
        {
            last.end_sample = last.end_sample.max(interval.end_sample);
        } else {
            result.push(interval);
        }
    }
    result
}
fn duration(intervals: &[OriginalSpeechInterval]) -> u64 {
    intervals
        .iter()
        .map(|i| i.end_sample - i.start_sample)
        .sum()
}
fn local_duration(intervals: &[LocalSegment]) -> u64 {
    duration(&union(
        intervals
            .iter()
            .map(|s| OriginalSpeechInterval {
                source: TrackKind::Mixed,
                start_sample: s.start_sample,
                end_sample: s.end_sample,
            })
            .collect(),
    ))
}
fn millionths_up(value: f64) -> u32 {
    (value * 1_000_000.0).ceil() as u32
}
fn millionths_down(value: f64) -> u32 {
    (value * 1_000_000.0).floor() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diarization::{GlobalSpeakerSegment, LocalSpeakerObservation, Prototype};
    use crate::protocol::record_identity::PersonAnchor;
    use crate::protocol::record_timeline::{RecordTrackTimeline, TrackTimeSpan};

    fn voice(axis: usize) -> Vec<f32> {
        let mut vector = vec![0.0; 512];
        vector[axis] = 1.0;
        vector
    }
    fn interval(source: TrackKind, start_sample: u64, end_sample: u64) -> OriginalSpeechInterval {
        OriginalSpeechInterval {
            source,
            start_sample,
            end_sample,
        }
    }
    fn document(source: TrackKind) -> IdentityAnchorDocument {
        IdentityAnchorDocument {
            schema_version: 1,
            audio_identity: "a".repeat(64),
            people: vec![PersonAnchor {
                person_id: 71,
                identity_scopes: vec![vec![
                    interval(source, 0, 32_000),
                    interval(source, 48_000, 80_000),
                ]],
                has_unresolved_activity: false,
            }],
            assignment_exclusions: vec![],
        }
    }
    fn prototype(source: TrackKind, axis: usize) -> Prototype {
        Prototype {
            embedding: Zeroizing::new(voice(axis)),
            witnesses: vec![Zeroizing::new(voice(axis))],
            source,
            time_reliable: true,
            clean_activity: vec![],
        }
    }
    fn inputs(root: &Path, sources: &[TrackKind], reliable: bool) -> Vec<RecordArtifactInput> {
        sources
            .iter()
            .enumerate()
            .map(|(index, source)| {
                let path = root.join(format!("{index}.opus"));
                crate::record_opus::tests::write_signal_fixture(&path, 1, 300, 0.2, 0.017);
                RecordArtifactInput {
                    input_path: path.to_str().unwrap().into(),
                    track: *source,
                    timeline: reliable.then_some(RecordTrackTimeline {
                        spans: vec![TrackTimeSpan {
                            source_start: 0,
                            source_end: 96_000,
                            record_start: 0,
                            record_end: 96_000,
                            quality: CaptureTimeQuality::Clock,
                            discontinuity: false,
                        }],
                    }),
                }
            })
            .collect()
    }
    fn turns(source: TrackKind, split: bool) -> Vec<GlobalSpeakerSegment> {
        [(0, 32_000), (48_000, 80_000)]
            .into_iter()
            .enumerate()
            .map(|(index, (start_sample, end_sample))| GlobalSpeakerSegment {
                source,
                start_sample,
                end_sample,
                global_speaker: Some(if split { index as u32 } else { 0 }),
            })
            .collect()
    }
    fn observation(
        window: WindowSpec,
        pcm: &[f32],
        excluded: &[LocalSegment],
        axis: usize,
    ) -> WindowObservation {
        assert_eq!(pcm.len() as u64, window.end_sample - window.start_sample);
        assert!(
            pcm.iter().any(|s| s.abs() > 0.01),
            "original PCM was not provided"
        );
        let segment = LocalSegment {
            start_sample: excluded
                .first()
                .filter(|s| s.start_sample == 0)
                .map_or(0, |s| s.end_sample),
            end_sample: excluded
                .last()
                .filter(|s| s.end_sample == pcm.len() as u64)
                .map_or(pcm.len() as u64, |s| s.start_sample),
        };
        WindowObservation {
            window,
            speakers: vec![LocalSpeakerObservation {
                local_speaker: 0,
                chunk_index: 0,
                slot: 0,
                chunk_start: 0,
                chunk_end: pcm.len() as u64,
                embedding_status: 0,
                embedding: voice(axis),
                segments: vec![segment],
                clean_segments: vec![segment],
            }],
        }
    }

    #[test]
    fn original_opus_witnesses_follow_removed_mic_echo_to_system_only_with_reliable_time() {
        let root = tempfile::tempdir().unwrap();
        for reliable in [true, false] {
            let inputs = inputs(
                root.path(),
                &[TrackKind::Microphone, TrackKind::System],
                reliable,
            );
            let prototypes = vec![prototype(TrackKind::System, 0)];
            let turns = turns(TrackKind::System, false);
            let mut calls = 0;
            let result = reconcile(
                &document(TrackKind::Microphone),
                &inputs,
                FinalIdentityView {
                    prototypes: &prototypes,
                    labels: &[0],
                    segments: &turns,
                    conflicts: &BTreeSet::new(),
                },
                |window, pcm, excluded| {
                    calls += 1;
                    assert_eq!(window.source, TrackKind::Microphone);
                    Ok(observation(window, pcm, excluded, 0))
                },
            )
            .unwrap();
            assert_eq!(result[0].is_accepted(), reliable);
            assert_eq!(calls, if reliable { 2 } else { 0 });
            if reliable {
                assert_eq!(result[0].reference_covered_samples, 64_000);
            }
        }
    }

    #[test]
    fn split_voices_require_purity_margin_and_no_activity_conflict() {
        let root = tempfile::tempdir().unwrap();
        let inputs = inputs(root.path(), &[TrackKind::Microphone], false);
        let turns = turns(TrackKind::Microphone, true);
        for (second_axis, conflict, accepted) in
            [(0, false, true), (1, false, false), (0, true, false)]
        {
            let prototypes = vec![
                prototype(TrackKind::Microphone, 0),
                prototype(TrackKind::Microphone, second_axis),
            ];
            let conflicts = if conflict {
                BTreeSet::from([(0, 1)])
            } else {
                BTreeSet::new()
            };
            let result = reconcile(
                &document(TrackKind::Microphone),
                &inputs,
                FinalIdentityView {
                    prototypes: &prototypes,
                    labels: &[0, 1],
                    segments: &turns,
                    conflicts: &conflicts,
                },
                |window, pcm, excluded| Ok(observation(window, pcm, excluded, 0)),
            )
            .unwrap();
            assert_eq!(result[0].is_accepted(), accepted);
        }
        let mut prototypes = vec![
            prototype(TrackKind::Microphone, 0),
            prototype(TrackKind::Microphone, 0),
            prototype(TrackKind::Microphone, 0),
        ];
        prototypes[2].witnesses[0] = Zeroizing::new(vec![0.0; 512]);
        prototypes[2].witnesses[0][0] = 0.95;
        prototypes[2].witnesses[0][1] = (1.0_f32 - 0.95_f32.powi(2)).sqrt();
        let result = reconcile(
            &document(TrackKind::Microphone),
            &inputs,
            FinalIdentityView {
                prototypes: &prototypes,
                labels: &[0, 1, 2],
                segments: &turns,
                conflicts: &BTreeSet::new(),
            },
            |window, pcm, excluded| Ok(observation(window, pcm, excluded, 0)),
        )
        .unwrap();
        assert!(
            !result[0].is_accepted(),
            "close alternative must veto inheritance"
        );
    }

    #[test]
    fn anchor_time_overlap_cannot_override_wrong_voice_missing_voice_or_extra_content() {
        let root = tempfile::tempdir().unwrap();
        let inputs = inputs(root.path(), &[TrackKind::Microphone], false);
        let prototypes = vec![prototype(TrackKind::Microphone, 0)];
        let mut turns = turns(TrackKind::Microphone, false);
        for case in 0..3 {
            if case == 2 {
                turns.push(GlobalSpeakerSegment {
                    source: TrackKind::Microphone,
                    start_sample: 80_000,
                    end_sample: 96_000,
                    global_speaker: Some(0),
                });
            }
            let result = reconcile(
                &document(TrackKind::Microphone),
                &inputs,
                FinalIdentityView {
                    prototypes: &prototypes,
                    labels: &[0],
                    segments: &turns,
                    conflicts: &BTreeSet::new(),
                },
                |window, pcm, excluded| {
                    let mut result =
                        observation(window, pcm, excluded, if case == 0 { 1 } else { 0 });
                    if case == 1 {
                        result.speakers[0].embedding.clear();
                        result.speakers[0].embedding_status = 1;
                    }
                    Ok(result)
                },
            )
            .unwrap();
            assert!(!result[0].is_accepted());
        }
    }

    #[test]
    fn human_merge_verifies_its_original_identities_without_rejudging_their_voices_or_overlap() {
        let root = tempfile::tempdir().unwrap();
        let inputs = inputs(
            root.path(),
            &[TrackKind::Microphone, TrackKind::System],
            true,
        );
        let mut doc = document(TrackKind::Microphone);
        doc.people[0]
            .identity_scopes
            .extend(document(TrackKind::System).people.remove(0).identity_scopes);
        let prototypes = vec![
            prototype(TrackKind::Microphone, 0),
            prototype(TrackKind::System, 1),
        ];
        let mut activity = turns(TrackKind::Microphone, false);
        activity.extend(turns(TrackKind::System, false).into_iter().map(|s| {
            GlobalSpeakerSegment {
                global_speaker: Some(1),
                ..s
            }
        }));
        let conflict = BTreeSet::from([(0, 1)]);
        let result = reconcile(
            &doc,
            &inputs,
            FinalIdentityView {
                prototypes: &prototypes,
                labels: &[0, 1],
                segments: &activity,
                conflicts: &conflict,
            },
            |window, pcm, excluded| {
                Ok(observation(
                    window,
                    pcm,
                    excluded,
                    if window.source == TrackKind::Microphone {
                        0
                    } else {
                        1
                    },
                ))
            },
        )
        .unwrap();
        assert!(result[0].is_accepted());
        assert_eq!(result[0].model_labels, vec![0, 1]);
        assert_eq!(result[0].independent_clean_spans, 2);
        // The same two identities in one automatically named old cluster have
        // no human merge authority and must not inherit a blanket name.
        doc.people[0].identity_scopes = vec![union(
            doc.people[0]
                .identity_scopes
                .iter()
                .flatten()
                .cloned()
                .collect(),
        )];
        let result = reconcile(
            &doc,
            &inputs,
            FinalIdentityView {
                prototypes: &prototypes,
                labels: &[0, 1],
                segments: &activity,
                conflicts: &conflict,
            },
            |window, pcm, excluded| {
                Ok(observation(
                    window,
                    pcm,
                    excluded,
                    if window.source == TrackKind::Microphone {
                        0
                    } else {
                        1
                    },
                ))
            },
        )
        .unwrap();
        assert!(!result[0].is_accepted());
    }

    #[test]
    fn short_speech_counts_for_temporal_coverage_but_not_as_clean_voice_support() {
        let root = tempfile::tempdir().unwrap();
        let inputs = inputs(root.path(), &[TrackKind::Microphone], false);
        let mut doc = document(TrackKind::Microphone);
        doc.people[0].identity_scopes[0].push(interval(TrackKind::Microphone, 88_000, 94_000));
        let prototypes = vec![prototype(TrackKind::Microphone, 0)];
        let mut activity = turns(TrackKind::Microphone, false);
        activity.push(GlobalSpeakerSegment {
            source: TrackKind::Microphone,
            start_sample: 88_000,
            end_sample: 94_000,
            global_speaker: Some(0),
        });
        let mut calls = 0;
        let result = reconcile(
            &doc,
            &inputs,
            FinalIdentityView {
                prototypes: &prototypes,
                labels: &[0],
                segments: &activity,
                conflicts: &BTreeSet::new(),
            },
            |window, pcm, excluded| {
                calls += 1;
                Ok(observation(window, pcm, excluded, 0))
            },
        )
        .unwrap();
        assert!(result[0].is_accepted());
        assert_eq!(result[0].reference_samples, 70_000);
        assert_eq!(result[0].reference_covered_samples, 70_000);
        assert_eq!(result[0].independent_clean_spans, 2);
        assert_eq!(calls, 2);
    }

    #[test]
    fn assignment_exclusions_do_not_expand_or_pollute_the_target_voice_identity() {
        let root = tempfile::tempdir().unwrap();
        let inputs = inputs(root.path(), &[TrackKind::Microphone], false);
        let mut doc = document(TrackKind::Microphone);
        doc.assignment_exclusions = vec![interval(TrackKind::Microphone, 32_000, 48_000)];
        let prototypes = vec![prototype(TrackKind::Microphone, 0)];
        let activity = vec![GlobalSpeakerSegment {
            source: TrackKind::Microphone,
            start_sample: 0,
            end_sample: 80_000,
            global_speaker: Some(0),
        }];
        let result = reconcile(
            &doc,
            &inputs,
            FinalIdentityView {
                prototypes: &prototypes,
                labels: &[0],
                segments: &activity,
                conflicts: &BTreeSet::new(),
            },
            |window, pcm, excluded| Ok(observation(window, pcm, excluded, 0)),
        )
        .unwrap();
        assert!(result[0].is_accepted());
        assert_eq!(result[0].candidate_samples, 64_000);
    }

    #[test]
    fn independent_support_requires_disjoint_original_pcm_and_compute_error_is_not_abstention() {
        let root = tempfile::tempdir().unwrap();
        let inputs = inputs(root.path(), &[TrackKind::Microphone], false);
        let prototypes = vec![prototype(TrackKind::Microphone, 0)];
        let mut document = document(TrackKind::Microphone);
        document.people[0].identity_scopes = vec![vec![interval(TrackKind::Microphone, 0, 80_000)]];
        let turns = vec![GlobalSpeakerSegment {
            source: TrackKind::Microphone,
            start_sample: 0,
            end_sample: 80_000,
            global_speaker: Some(0),
        }];
        let view = || FinalIdentityView {
            prototypes: &prototypes,
            labels: &[0],
            segments: &turns,
            conflicts: &EMPTY_CONFLICTS,
        };
        static EMPTY_CONFLICTS: BTreeSet<(u32, u32)> = BTreeSet::new();
        let result = reconcile(&document, &inputs, view(), |window, pcm, excluded| {
            Ok(observation(window, pcm, excluded, 0))
        })
        .unwrap();
        assert_eq!(result[0].independent_clean_spans, 2);
        assert!(result[0].is_accepted());
        assert_eq!(
            reconcile(&document, &inputs, view(), |_, _, _| Err(
                "SPEECH_INFERENCE_FAILED"
            )),
            Err("SPEECH_INFERENCE_FAILED")
        );
    }
}
