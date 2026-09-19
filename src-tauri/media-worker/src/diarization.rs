//! Bounded source-aware speaker evidence. Native inference reports activity and
//! exclusive-speech vectors; this module owns only Record-local fusion policy.
use crate::protocol::TrackKind;
use std::collections::{BTreeMap, BTreeSet};
use zeroize::{Zeroize, Zeroizing};

pub const SPEAKER_EMBEDDING_DIMENSION: usize = 512;
pub const DEFAULT_SAMPLE_RATE: u32 = 16_000;
// Five-minute fusion windows contain at most 90 raw slots with the locked
// 10-second model hop (192-slot ABI ceiling). Eight hours yields 100 windows
// per source: repeated voices consume the shared 2,048-candidate budget at
// meeting scale rather than exhausting it after 6.5 hours with five people.
// PCM stays window-bounded; model inference still uses 10-second chunks.
pub const DEFAULT_WINDOW_SAMPLES: u64 = 300 * DEFAULT_SAMPLE_RATE as u64;
pub const DEFAULT_OVERLAP_SAMPLES: u64 = 11 * DEFAULT_SAMPLE_RATE as u64;
pub const MAX_GLOBAL_PROTOTYPES: usize = 2_048;
const MAX_WINDOWS: usize = 2_048;
const MAX_RAW_OBSERVATIONS: usize = 192;
const MAX_LOCAL_PROTOTYPES: usize = 32;
const MAX_SEGMENTS_PER_WINDOW: usize = 16_384;
const MAX_TOTAL_SEGMENTS: usize = 1_000_000;
pub const CANNOT_LINK_DISTANCE: f64 = 3.0;
// Voice extraction readiness is not enough evidence to build a person. Short
// observations may be assigned below, but never train an identity centre.
const MIN_CLEAN_SAMPLES: u64 = 2 * DEFAULT_SAMPLE_RATE as u64;
const MIN_ASSIGNMENT_MARGIN: f64 = 0.10;
const MIN_CONFLICT_SAMPLES: u64 = DEFAULT_SAMPLE_RATE as u64 * 80 / 1_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoundedDiarizationConfig {
    pub window_samples: u64,
    pub overlap_samples: u64,
    pub window_merge_distance: f64,
    pub global_same_speaker_distance: f64,
}
impl Default for BoundedDiarizationConfig {
    fn default() -> Self {
        Self {
            window_samples: DEFAULT_WINDOW_SAMPLES,
            overlap_samples: DEFAULT_OVERLAP_SAMPLES,
            window_merge_distance: 0.50,
            global_same_speaker_distance: 0.50,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowSpec {
    pub index: u32,
    pub source: TrackKind,
    pub start_sample: u64,
    pub end_sample: u64,
    pub time_reliable: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalSegment {
    pub start_sample: u64,
    pub end_sample: u64,
}
impl LocalSegment {
    fn intersect(self, other: Self) -> Option<Self> {
        let start_sample = self.start_sample.max(other.start_sample);
        let end_sample = self.end_sample.min(other.end_sample);
        (start_sample < end_sample).then_some(Self {
            start_sample,
            end_sample,
        })
    }
    fn duration(self) -> u64 {
        self.end_sample - self.start_sample
    }
}

// Voice vectors are transient, never diagnostic fields or persisted identities.
#[derive(Clone, PartialEq)]
pub struct LocalSpeakerObservation {
    pub local_speaker: u32,
    pub chunk_index: u32,
    pub slot: u32,
    pub chunk_start: u64,
    pub chunk_end: u64,
    pub embedding_status: u32,
    pub embedding: Vec<f32>,
    pub segments: Vec<LocalSegment>,
    pub clean_segments: Vec<LocalSegment>,
}
impl Drop for LocalSpeakerObservation {
    fn drop(&mut self) {
        self.embedding.zeroize();
    }
}
impl std::fmt::Debug for LocalSpeakerObservation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalSpeakerObservation")
            .field("activity_count", &self.segments.len())
            .field("embedding_status", &self.embedding_status)
            .finish_non_exhaustive()
    }
}
#[derive(Debug, Clone, PartialEq)]
pub struct WindowObservation {
    pub window: WindowSpec,
    pub speakers: Vec<LocalSpeakerObservation>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GlobalSpeakerSegment {
    pub source: TrackKind,
    pub start_sample: u64,
    pub end_sample: u64,
    pub global_speaker: Option<u32>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiarizationProjection {
    pub speaker_count: u32,
    pub segments: Vec<GlobalSpeakerSegment>,
    pub identity_evidence: Vec<crate::protocol::record_identity::PersonMatchEvidence>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiarizationError {
    InvalidConfiguration,
    InvalidDuration,
    WindowPlanMismatch,
    ResourceLimit,
    DuplicateLocalSpeaker,
    InvalidEmbedding,
    InvalidSegment,
    InvalidClusterLabels,
}

pub(crate) struct Prototype {
    pub(crate) embedding: Zeroizing<Vec<f32>>,
    /// Actual clean observations for subsequent identity verification. Keep
    /// the four longest observations per prototype (at most 16 MiB across both
    /// sources), rather than treating a centroid ball as observed voices.
    pub(crate) witnesses: Vec<Zeroizing<Vec<f32>>>,
    pub(crate) source: TrackKind,
    pub(crate) time_reliable: bool,
    pub(crate) clean_activity: Vec<LocalSegment>,
}

pub struct FinalIdentityView<'a> {
    pub(crate) prototypes: &'a [Prototype],
    pub(crate) labels: &'a [u32],
    pub(crate) segments: &'a [GlobalSpeakerSegment],
    pub(crate) conflicts: &'a BTreeSet<(u32, u32)>,
}
struct PendingActivity {
    source: TrackKind,
    interval: LocalSegment,
    prototype: Option<usize>,
}
struct ContextActivity {
    source: TrackKind,
    chunk: u64,
    interval: LocalSegment,
}

/// Raw windows are consolidated and released immediately. Both physical
/// sources share the same 2,048-prototype ceiling and one native model lease.
pub struct BoundedDiarization {
    config: BoundedDiarizationConfig,
    prototypes: Vec<Prototype>,
    cannot_link: BTreeSet<(usize, usize)>,
    activity: Vec<PendingActivity>,
    context_activity: Vec<ContextActivity>,
    windows: usize,
    source_ends: Vec<(TrackKind, u64)>,
}
impl BoundedDiarization {
    pub fn new(config: BoundedDiarizationConfig) -> Result<Self, DiarizationError> {
        validate_config(config)?;
        Ok(Self {
            config,
            prototypes: Vec::new(),
            cannot_link: BTreeSet::new(),
            activity: Vec::new(),
            context_activity: Vec::new(),
            windows: 0,
            source_ends: Vec::new(),
        })
    }

    pub fn push<F>(
        &mut self,
        observation: WindowObservation,
        owned: LocalSegment,
        mut cluster: F,
    ) -> Result<(), DiarizationError>
    where
        F: FnMut(&[f64], usize, f64) -> Result<Vec<u32>, DiarizationError>,
    {
        let window = observation.window;
        if window.start_sample >= window.end_sample
            || owned.start_sample < window.start_sample
            || owned.end_sample > window.end_sample
            || owned.start_sample >= owned.end_sample
            || window.end_sample - window.start_sample > self.config.window_samples
            || !matches!(
                window.source,
                TrackKind::Microphone | TrackKind::System | TrackKind::Mixed
            )
        {
            return Err(DiarizationError::WindowPlanMismatch);
        }
        if self.windows >= MAX_WINDOWS || observation.speakers.len() > MAX_RAW_OBSERVATIONS {
            return Err(DiarizationError::ResourceLimit);
        }
        if let Some((_, end)) = self
            .source_ends
            .iter_mut()
            .find(|(source, _)| *source == window.source)
        {
            if owned.start_sample < *end {
                return Err(DiarizationError::WindowPlanMismatch);
            }
            *end = owned.end_sample;
        } else {
            self.source_ends.push((window.source, owned.end_sample));
        }
        self.windows += 1;
        let length = window.end_sample - window.start_sample;
        let mut ids = BTreeSet::new();
        let mut chunks = BTreeMap::new();
        let mut segment_count = 0;
        for speaker in &observation.speakers {
            if !ids.insert(speaker.local_speaker) {
                return Err(DiarizationError::DuplicateLocalSpeaker);
            }
            if speaker.slot >= 3
                || speaker.chunk_start >= speaker.chunk_end
                || speaker.chunk_end > length
                || speaker.embedding_status > 3
                || (speaker.embedding_status == 0) == speaker.embedding.is_empty()
            {
                return Err(DiarizationError::InvalidSegment);
            }
            if let Some(extent) = chunks.insert(
                speaker.chunk_index,
                (speaker.chunk_start, speaker.chunk_end),
            ) && extent != (speaker.chunk_start, speaker.chunk_end)
            {
                return Err(DiarizationError::InvalidSegment);
            }
            segment_count += speaker.segments.len() + speaker.clean_segments.len();
            if segment_count > 2 * MAX_SEGMENTS_PER_WINDOW {
                return Err(DiarizationError::ResourceLimit);
            }
            for intervals in [&speaker.segments, &speaker.clean_segments] {
                if intervals.iter().any(|s| {
                    s.start_sample < speaker.chunk_start
                        || s.start_sample >= s.end_sample
                        || s.end_sample > speaker.chunk_end
                }) || intervals
                    .windows(2)
                    .any(|pair| pair[0].end_sample > pair[1].start_sample)
                {
                    return Err(DiarizationError::InvalidSegment);
                }
            }
            if speaker.clean_segments.iter().any(|c| {
                !speaker
                    .segments
                    .iter()
                    .any(|a| a.start_sample <= c.start_sample && a.end_sample >= c.end_sample)
            }) {
                return Err(DiarizationError::InvalidSegment);
            }
        }
        let chunks = chunks.into_iter().collect::<Vec<_>>();
        if chunks
            .windows(2)
            .any(|pair| pair[0].1.0 >= pair[1].1.0 || pair[0].1.1 >= pair[1].1.1)
        {
            return Err(DiarizationError::InvalidSegment);
        }
        let relative_owned = LocalSegment {
            start_sample: owned.start_sample - window.start_sample,
            end_sample: owned.end_sample - window.start_sample,
        };
        let mut raw_activity = Vec::new();
        let mut raw_clean = Vec::new();
        let mut vectors = Zeroizing::new(Vec::<Vec<f32>>::new());
        let mut vector_raw = Vec::new();
        let mut weights = Vec::new();
        for (raw, speaker) in observation.speakers.iter().enumerate() {
            let position = chunks
                .iter()
                .position(|(index, _)| *index == speaker.chunk_index)
                .ok_or(DiarizationError::InvalidSegment)?;
            let mut ownership = LocalSegment {
                start_sample: speaker.chunk_start,
                end_sample: speaker.chunk_end,
            };
            if position > 0 && chunks[position - 1].1.1 > ownership.start_sample {
                ownership.start_sample = midpoint(ownership.start_sample, chunks[position - 1].1.1);
            }
            if position + 1 < chunks.len() && chunks[position + 1].1.0 < ownership.end_sample {
                ownership.end_sample = midpoint(chunks[position + 1].1.0, ownership.end_sample);
            }
            let clip = |intervals: &[LocalSegment]| {
                intervals
                    .iter()
                    .filter_map(|s| s.intersect(ownership)?.intersect(relative_owned))
                    .collect::<Vec<_>>()
            };
            // Ownership removes duplicate weight, not the fact that speech
            // was detected. Another window may miss this short/overlap activity.
            let selected = ownership.intersect(relative_owned);
            for activity in &speaker.segments {
                let retained = selected.and_then(|selected| activity.intersect(selected));
                let context = match retained {
                    Some(retained) => [
                        LocalSegment {
                            start_sample: activity.start_sample,
                            end_sample: retained.start_sample,
                        },
                        LocalSegment {
                            start_sample: retained.end_sample,
                            end_sample: activity.end_sample,
                        },
                    ],
                    None => [
                        *activity,
                        LocalSegment {
                            start_sample: 0,
                            end_sample: 0,
                        },
                    ],
                };
                for interval in context
                    .into_iter()
                    .filter(|s| s.start_sample < s.end_sample)
                {
                    if self.context_activity.len() + self.activity.len() >= MAX_TOTAL_SEGMENTS {
                        return Err(DiarizationError::ResourceLimit);
                    }
                    self.context_activity.push(ContextActivity {
                        source: window.source,
                        chunk: ((self.windows as u64) << 32) | u64::from(speaker.chunk_index),
                        interval: LocalSegment {
                            start_sample: interval.start_sample + window.start_sample,
                            end_sample: interval.end_sample + window.start_sample,
                        },
                    });
                }
            }
            raw_activity.push(clip(&speaker.segments));
            raw_clean.push(clip(&speaker.clean_segments));
            let full_clean = speaker
                .clean_segments
                .iter()
                .map(|s| s.duration())
                .sum::<u64>();
            let weight = raw_clean[raw].iter().map(|s| s.duration()).sum::<u64>();
            // Only modelling evidence can move a centre. Assignment of weaker
            // observations happens after these groups have been fixed.
            if speaker.embedding_status == 0 && full_clean >= MIN_CLEAN_SAMPLES && weight > 0 {
                vectors.push(normalized_embedding(&speaker.embedding)?);
                vector_raw.push(raw);
                weights.push(weight as f64);
            }
        }
        let distances = condensed_distances(vectors.len(), |left, right| {
            let a = &observation.speakers[vector_raw[left]];
            let b = &observation.speakers[vector_raw[right]];
            if local_activity_conflict(a, b) {
                CANNOT_LINK_DISTANCE
            } else {
                cosine_distance(&vectors[left], &vectors[right])
            }
        });
        let labels = cluster(&distances, vectors.len(), self.config.window_merge_distance)?;
        validate_cluster_labels(vectors.len(), &labels)?;
        let mut members = BTreeMap::<u32, Vec<usize>>::new();
        for (index, label) in labels.iter().enumerate() {
            members.entry(*label).or_default().push(index);
        }
        if members.len() > MAX_LOCAL_PROTOTYPES
            || self.prototypes.len() + members.len() > MAX_GLOBAL_PROTOTYPES
        {
            return Err(DiarizationError::ResourceLimit);
        }
        let base = self.prototypes.len();
        let mut raw_to_prototype = vec![None; observation.speakers.len()];
        for (member, &raw) in vector_raw.iter().enumerate() {
            raw_to_prototype[raw] = Some(base + labels[member] as usize);
        }
        assign_weak_observations(
            &observation.speakers,
            &vector_raw,
            &vectors,
            &members,
            &raw_activity,
            &mut raw_to_prototype,
            self.config.window_merge_distance,
        )?;
        for (label, group) in members {
            let mut centre = Zeroizing::new(vec![0.0_f64; SPEAKER_EMBEDDING_DIMENSION]);
            let mut clean_activity = Vec::new();
            for &member in &group {
                let raw = vector_raw[member];
                raw_to_prototype[raw] = Some(base + label as usize);
                for (target, value) in centre.iter_mut().zip(&vectors[member]) {
                    *target += f64::from(*value) * weights[member];
                }
                clean_activity.extend(raw_clean[raw].iter().map(|s| LocalSegment {
                    start_sample: s.start_sample + window.start_sample,
                    end_sample: s.end_sample + window.start_sample,
                }));
            }
            let centre_f32 = Zeroizing::new(centre.iter().map(|v| *v as f32).collect::<Vec<_>>());
            let embedding = Zeroizing::new(normalized_embedding(&centre_f32)?);
            let mut witness_members = group.clone();
            witness_members.sort_by(|a, b| weights[*b].total_cmp(&weights[*a]).then(a.cmp(b)));
            let witnesses = witness_members
                .into_iter()
                .take(4)
                .map(|member| Zeroizing::new(vectors[member].clone()))
                .collect();
            self.prototypes.push(Prototype {
                embedding,
                witnesses,
                source: window.source,
                time_reliable: window.time_reliable,
                clean_activity: union_intervals(clean_activity),
            });
        }
        for (raw, assigned) in raw_to_prototype.iter().enumerate() {
            let Some(prototype) = *assigned else { continue };
            if !vector_raw.contains(&raw) {
                // Assigned exclusive activity still constrains cross-source
                // simultaneity. It does not enter the centre or its witnesses.
                self.prototypes[prototype]
                    .clean_activity
                    .extend(raw_clean[raw].iter().map(|s| LocalSegment {
                        start_sample: s.start_sample + window.start_sample,
                        end_sample: s.end_sample + window.start_sample,
                    }));
            }
            for (right, assigned_right) in raw_to_prototype.iter().enumerate().skip(raw + 1) {
                let Some(other) = *assigned_right else {
                    continue;
                };
                if local_activity_conflict(&observation.speakers[raw], &observation.speakers[right])
                {
                    if prototype == other {
                        return Err(DiarizationError::InvalidClusterLabels);
                    }
                    self.cannot_link.insert(ordered_pair(prototype, other));
                }
            }
        }
        for prototype in &mut self.prototypes[base..] {
            prototype.clean_activity =
                union_intervals(std::mem::take(&mut prototype.clean_activity));
        }
        for (raw, intervals) in raw_activity.into_iter().enumerate() {
            for interval in intervals {
                if self.activity.len() + self.context_activity.len() >= MAX_TOTAL_SEGMENTS {
                    return Err(DiarizationError::ResourceLimit);
                }
                self.activity.push(PendingActivity {
                    source: window.source,
                    prototype: raw_to_prototype[raw],
                    interval: LocalSegment {
                        start_sample: interval.start_sample + window.start_sample,
                        end_sample: interval.end_sample + window.start_sample,
                    },
                });
            }
        }
        Ok(())
    }

    pub fn finish<F>(self, cluster: F) -> Result<DiarizationProjection, DiarizationError>
    where
        F: FnMut(&[f64], usize, f64) -> Result<Vec<u32>, DiarizationError>,
    {
        self.finish_with_identity(cluster, |_| Ok(Vec::new()))
    }

    pub fn finish_with_identity<F, I>(
        self,
        mut cluster: F,
        identity: I,
    ) -> Result<DiarizationProjection, DiarizationError>
    where
        F: FnMut(&[f64], usize, f64) -> Result<Vec<u32>, DiarizationError>,
        I: FnOnce(
            FinalIdentityView<'_>,
        ) -> Result<
            Vec<crate::protocol::record_identity::PersonMatchEvidence>,
            DiarizationError,
        >,
    {
        let mut conflicts = self.cannot_link.clone();
        let distances = condensed_distances(self.prototypes.len(), |left, right| {
            let a = &self.prototypes[left];
            let b = &self.prototypes[right];
            // Cross-source echo-only evidence is removed by shared waveform
            // preprocessing before this stage; estimated clocks cannot assert
            // simultaneity. Same-source repeated windows never imply conflict.
            let cross_source_conflict = a.source != b.source
                && a.source != TrackKind::Mixed
                && b.source != TrackKind::Mixed
                && a.time_reliable
                && b.time_reliable
                && overlap_duration(&a.clean_activity, &b.clean_activity) >= MIN_CONFLICT_SAMPLES;
            if cross_source_conflict || self.cannot_link.contains(&(left, right)) {
                conflicts.insert((left, right));
                CANNOT_LINK_DISTANCE
            } else {
                cosine_distance(&a.embedding, &b.embedding)
            }
        });
        let labels = cluster(
            &distances,
            self.prototypes.len(),
            self.config.global_same_speaker_distance,
        )?;
        validate_cluster_labels(self.prototypes.len(), &labels)?;
        for (left, right) in &conflicts {
            if labels[*left] == labels[*right] {
                return Err(DiarizationError::InvalidClusterLabels);
            }
        }
        let mut grouped = BTreeMap::<(TrackKind, u32), Vec<LocalSegment>>::new();
        let mut segments = Vec::new();
        for activity in self.activity {
            if let Some(prototype) = activity.prototype {
                grouped
                    .entry((activity.source, labels[prototype]))
                    .or_default()
                    .push(activity.interval);
            } else {
                // Unknown is not one shared identity. Preserve concurrent
                // raw slots even when neither has a usable voice vector.
                segments.push(GlobalSpeakerSegment {
                    source: activity.source,
                    start_sample: activity.interval.start_sample,
                    end_sample: activity.interval.end_sample,
                    global_speaker: None,
                });
            }
        }
        for ((source, label), intervals) in grouped {
            segments.extend(
                union_intervals(intervals)
                    .into_iter()
                    .map(|s| GlobalSpeakerSegment {
                        source,
                        start_sample: s.start_sample,
                        end_sample: s.end_sample,
                        global_speaker: Some(label),
                    }),
            );
        }
        preserve_context_activity(&mut segments, self.context_activity)?;
        segments.sort_by_key(|s| (s.start_sample, s.end_sample, s.source, s.global_speaker));
        let mut compact = BTreeMap::new();
        for segment in &mut segments {
            if let Some(label) = segment.global_speaker {
                let next = compact.len() as u32;
                segment.global_speaker = Some(*compact.entry(label).or_insert(next));
            }
        }
        if segments.len() > 200_000 {
            return Err(DiarizationError::ResourceLimit);
        }
        // Compact labels follow first occurrence; re-sort later equal-time
        // turns because remapping may reverse their previous numeric order.
        segments.sort_by_key(|s| (s.start_sample, s.end_sample, s.source, s.global_speaker));
        let labels = labels
            .iter()
            .map(|label| {
                compact
                    .get(label)
                    .copied()
                    .ok_or(DiarizationError::InvalidClusterLabels)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let conflicts = conflicts
            .into_iter()
            .map(|(a, b)| ordered_pair(labels[a] as usize, labels[b] as usize))
            .map(|(a, b)| (a as u32, b as u32))
            .collect();
        let identity_evidence = identity(FinalIdentityView {
            prototypes: &self.prototypes,
            labels: &labels,
            segments: &segments,
            conflicts: &conflicts,
        })?;
        Ok(DiarizationProjection {
            speaker_count: compact.len() as u32,
            segments,
            identity_evidence,
        })
    }
}

fn local_activity_conflict(a: &LocalSpeakerObservation, b: &LocalSpeakerObservation) -> bool {
    a.chunk_index == b.chunk_index
        && a.slot != b.slot
        && overlap_duration(&a.segments, &b.segments) >= MIN_CONFLICT_SAMPLES
}

/// Match against immutable modelling evidence. All members must support the
/// match, and even the nearest competing member must be sufficiently farther
/// away. No nearest-centre absorption or weak-to-weak identity chain is used.
fn assign_weak_observations(
    speakers: &[LocalSpeakerObservation],
    strong_raw: &[usize],
    vectors: &[Vec<f32>],
    groups: &BTreeMap<u32, Vec<usize>>,
    activity: &[Vec<LocalSegment>],
    assigned: &mut [Option<usize>],
    threshold: f64,
) -> Result<(), DiarizationError> {
    if groups.is_empty() {
        return Ok(());
    }
    let mut proposals = vec![None; speakers.len()];
    for (raw, speaker) in speakers.iter().enumerate() {
        if assigned[raw].is_some()
            || speaker.embedding_status != 0
            || speaker.clean_segments.is_empty()
            || activity[raw].is_empty()
        {
            continue;
        }
        let vector = Zeroizing::new(normalized_embedding(&speaker.embedding)?);
        let distances = vectors
            .iter()
            .map(|v| cosine_distance(&vector, v))
            .collect::<Vec<_>>();
        let mut candidate = None;
        for (label, members) in groups {
            if members
                .iter()
                .any(|&i| local_activity_conflict(speaker, &speakers[strong_raw[i]]))
            {
                continue;
            }
            let distance = members
                .iter()
                .map(|&i| distances[i])
                .fold(0.0_f64, f64::max);
            let alternative = groups
                .iter()
                .filter(|(other, _)| *other != label)
                .flat_map(|(_, others)| others.iter().map(|&i| distances[i]))
                .fold(CANNOT_LINK_DISTANCE, f64::min);
            if distance < threshold && alternative - distance >= MIN_ASSIGNMENT_MARGIN {
                if candidate.is_some() {
                    candidate = None;
                    break;
                }
                candidate = assigned[strong_raw[members[0]]];
            }
        }
        proposals[raw] = candidate;
    }
    // Decide together: input order cannot let one of two simultaneous weak
    // slots win an otherwise identical claim. Both retain unknown activity.
    let mut rejected = vec![false; speakers.len()];
    for left in 0..speakers.len() {
        if proposals[left].is_none() {
            continue;
        }
        for right in left + 1..speakers.len() {
            if proposals[left] == proposals[right]
                && local_activity_conflict(&speakers[left], &speakers[right])
            {
                rejected[left] = true;
                rejected[right] = true;
            }
        }
    }
    for (raw, proposal) in proposals.into_iter().enumerate() {
        if !rejected[raw] && proposal.is_some() {
            assigned[raw] = proposal;
        }
    }
    Ok(())
}

/// The maximum activity count observed by any one native chunk is a lower
/// bound on what must survive ownership clipping. Repeated context windows
/// observe the same PCM, so their counts must never be added together.
fn preserve_context_activity(
    segments: &mut Vec<GlobalSpeakerSegment>,
    context: Vec<ContextActivity>,
) -> Result<(), DiarizationError> {
    if context.is_empty() {
        return Ok(());
    }
    let mut events = Vec::with_capacity(2 * (segments.len() + context.len()));
    for segment in segments.iter() {
        events.push((segment.source, segment.start_sample, None, true));
        events.push((segment.source, segment.end_sample, None, false));
    }
    for activity in context {
        events.push((
            activity.source,
            activity.interval.start_sample,
            Some(activity.chunk),
            true,
        ));
        events.push((
            activity.source,
            activity.interval.end_sample,
            Some(activity.chunk),
            false,
        ));
    }
    events.sort_unstable();
    let mut chunks = BTreeMap::<u64, usize>::new();
    let mut output_count = 0_usize;
    let mut previous = None;
    let mut index = 0;
    let mut added = 0;
    let mut layers = Vec::<Vec<GlobalSpeakerSegment>>::new();
    while index < events.len() {
        let (source, at, _, _) = events[index];
        if let Some((previous_source, start)) = previous {
            if source == previous_source && start < at {
                let missing = chunks
                    .values()
                    .copied()
                    .max()
                    .unwrap_or(0)
                    .saturating_sub(output_count);
                layers.resize_with(layers.len().max(missing), Vec::new);
                for layer in layers.iter_mut().take(missing) {
                    if let Some(last) = layer.last_mut()
                        && last.source == source
                        && last.end_sample == start
                    {
                        last.end_sample = at;
                    } else {
                        if segments.len() + added >= 200_000 {
                            return Err(DiarizationError::ResourceLimit);
                        }
                        layer.push(GlobalSpeakerSegment {
                            source,
                            start_sample: start,
                            end_sample: at,
                            global_speaker: None,
                        });
                        added += 1;
                    }
                }
            } else if source != previous_source {
                chunks.clear();
                output_count = 0;
            }
        }
        while index < events.len() && (events[index].0, events[index].1) == (source, at) {
            let (_, _, chunk, starts) = events[index];
            if let Some(chunk) = chunk {
                let count = chunks.entry(chunk).or_default();
                if starts {
                    *count += 1;
                } else {
                    *count -= 1;
                }
                if *count == 0 {
                    chunks.remove(&chunk);
                }
            } else if starts {
                output_count += 1;
            } else {
                output_count -= 1;
            }
            index += 1;
        }
        previous = Some((source, at));
    }
    segments.extend(layers.into_iter().flatten());
    Ok(())
}

fn validate_config(config: BoundedDiarizationConfig) -> Result<(), DiarizationError> {
    if config.window_samples == 0
        || config.window_samples > DEFAULT_WINDOW_SAMPLES
        || config.overlap_samples >= config.window_samples
        || config.overlap_samples > DEFAULT_OVERLAP_SAMPLES
        || [
            config.window_merge_distance,
            config.global_same_speaker_distance,
        ]
        .iter()
        .any(|d| !d.is_finite() || *d <= 0.0 || *d >= 2.0)
    {
        return Err(DiarizationError::InvalidConfiguration);
    }
    Ok(())
}
pub(crate) fn normalized_embedding(values: &[f32]) -> Result<Vec<f32>, DiarizationError> {
    if values.len() != SPEAKER_EMBEDDING_DIMENSION || values.iter().any(|v| !v.is_finite()) {
        return Err(DiarizationError::InvalidEmbedding);
    }
    let norm = values
        .iter()
        .map(|v| f64::from(*v).powi(2))
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm <= f64::EPSILON {
        return Err(DiarizationError::InvalidEmbedding);
    }
    Ok(values
        .iter()
        .map(|v| (f64::from(*v) / norm) as f32)
        .collect())
}
pub(crate) fn cosine_distance(left: &[f32], right: &[f32]) -> f64 {
    (1.0 - left
        .iter()
        .zip(right)
        .map(|(a, b)| f64::from(*a) * f64::from(*b))
        .sum::<f64>()
        .clamp(-1.0, 1.0))
    .max(0.0)
}
fn condensed_distances<F: FnMut(usize, usize) -> f64>(count: usize, mut distance: F) -> Vec<f64> {
    let mut result = Vec::with_capacity(count * count.saturating_sub(1) / 2);
    for left in 0..count {
        for right in left + 1..count {
            result.push(distance(left, right));
        }
    }
    result
}
fn validate_cluster_labels(count: usize, labels: &[u32]) -> Result<(), DiarizationError> {
    let distinct = labels.iter().copied().collect::<BTreeSet<_>>();
    if labels.len() != count || distinct.iter().copied().ne(0..distinct.len() as u32) {
        return Err(DiarizationError::InvalidClusterLabels);
    }
    Ok(())
}
fn ordered_pair(a: usize, b: usize) -> (usize, usize) {
    (a.min(b), a.max(b))
}
fn midpoint(left: u64, right: u64) -> u64 {
    left + (right - left) / 2
}
fn union_intervals(mut intervals: Vec<LocalSegment>) -> Vec<LocalSegment> {
    intervals.sort_by_key(|s| (s.start_sample, s.end_sample));
    let mut merged: Vec<LocalSegment> = Vec::new();
    for interval in intervals {
        if let Some(last) = merged.last_mut()
            && interval.start_sample <= last.end_sample
        {
            last.end_sample = last.end_sample.max(interval.end_sample);
        } else {
            merged.push(interval);
        }
    }
    merged
}
fn overlap_duration(left: &[LocalSegment], right: &[LocalSegment]) -> u64 {
    let mut total = 0;
    let mut a = 0;
    let mut b = 0;
    while a < left.len() && b < right.len() {
        if let Some(overlap) = left[a].intersect(right[b]) {
            total += overlap.duration();
        }
        if left[a].end_sample <= right[b].end_sample {
            a += 1;
        } else {
            b += 1;
        }
    }
    total
}

/// One source's bounded PCM window. No inference model, queue or durable state
/// is duplicated. Gaps/epochs finish the previous context instead of padding it.
pub struct SourceWindowBuffer {
    source: TrackKind,
    config: BoundedDiarizationConfig,
    pcm: Zeroizing<Vec<f32>>,
    start: u64,
    next_index: u32,
    last_emitted_end: u64,
    unreliable_until: u64,
    excluded_echo: Vec<LocalSegment>,
}
pub struct DiarizationWindow {
    pub spec: WindowSpec,
    pub pcm: Zeroizing<Vec<f32>>,
    pub excluded_echo: Vec<LocalSegment>,
}
impl SourceWindowBuffer {
    pub fn new(
        source: TrackKind,
        config: BoundedDiarizationConfig,
    ) -> Result<Self, DiarizationError> {
        validate_config(config)?;
        Ok(Self {
            source,
            config,
            pcm: Zeroizing::new(Vec::with_capacity(config.window_samples as usize)),
            start: 0,
            next_index: 0,
            last_emitted_end: 0,
            unreliable_until: 0,
            excluded_echo: Vec::new(),
        })
    }
    pub fn accept(
        &mut self,
        chunk: &crate::record_source::SourceAudioChunk,
    ) -> Result<Vec<DiarizationWindow>, DiarizationError> {
        use crate::protocol::record_timeline::CaptureTimeQuality;
        if chunk.track != self.source {
            return Err(DiarizationError::InvalidSegment);
        }
        let mut ready = Vec::new();
        let gap = chunk.quality == CaptureTimeQuality::Gap;
        if gap || chunk.discontinuity || chunk.start_sample != self.start + self.pcm.len() as u64 {
            if let Some(tail) = self.finish()? {
                ready.push(tail);
            }
            self.start = chunk.start_sample;
            self.last_emitted_end = self.start;
            self.unreliable_until = 0;
        }
        if gap {
            self.start = chunk.end_sample();
            return Ok(ready);
        }
        if chunk.quality != CaptureTimeQuality::Clock {
            self.unreliable_until = chunk.end_sample();
        }
        let mut mono = chunk.mono_samples();
        if chunk.echo_reference.is_some() {
            mono.fill(0.0);
            let interval = LocalSegment {
                start_sample: chunk.start_sample,
                end_sample: chunk.end_sample(),
            };
            if let Some(previous) = self.excluded_echo.last_mut()
                && previous.end_sample == interval.start_sample
            {
                previous.end_sample = interval.end_sample;
            } else {
                self.excluded_echo.push(interval);
            }
        }
        let mut consumed = 0;
        while consumed < mono.len() {
            let take =
                (self.config.window_samples as usize - self.pcm.len()).min(mono.len() - consumed);
            self.pcm.extend_from_slice(&mono[consumed..consumed + take]);
            consumed += take;
            if self.pcm.len() == self.config.window_samples as usize {
                ready.push(self.window()?);
                let step = (self.config.window_samples - self.config.overlap_samples) as usize;
                self.pcm.copy_within(step.., 0);
                let retained = self.pcm.len() - step;
                self.pcm[retained..].zeroize();
                self.pcm.truncate(retained);
                self.start += step as u64;
                self.excluded_echo.retain(|s| s.end_sample > self.start);
            }
        }
        Ok(ready)
    }
    pub fn finish(&mut self) -> Result<Option<DiarizationWindow>, DiarizationError> {
        let tail =
            if !self.pcm.is_empty() && self.start + self.pcm.len() as u64 > self.last_emitted_end {
                Some(self.window()?)
            } else {
                None
            };
        self.pcm.zeroize();
        self.pcm.clear();
        self.excluded_echo.clear();
        Ok(tail)
    }
    fn window(&mut self) -> Result<DiarizationWindow, DiarizationError> {
        if self.next_index as usize >= MAX_WINDOWS {
            return Err(DiarizationError::ResourceLimit);
        }
        let spec = WindowSpec {
            index: self.next_index,
            source: self.source,
            start_sample: self.start,
            end_sample: self.start + self.pcm.len() as u64,
            time_reliable: self.start >= self.unreliable_until,
        };
        self.next_index += 1;
        self.last_emitted_end = spec.end_sample;
        Ok(DiarizationWindow {
            spec,
            pcm: Zeroizing::new(self.pcm.to_vec()),
            excluded_echo: self
                .excluded_echo
                .iter()
                .filter_map(|s| {
                    s.intersect(LocalSegment {
                        start_sample: spec.start_sample,
                        end_sample: spec.end_sample,
                    })
                })
                .map(|s| LocalSegment {
                    start_sample: s.start_sample - spec.start_sample,
                    end_sample: s.end_sample - spec.start_sample,
                })
                .collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Small independent complete-link oracle for policy tests. Production
    // always invokes the locked native library, tested at its actual ABI.
    fn cluster(
        distances: &[f64],
        count: usize,
        threshold: f64,
    ) -> Result<Vec<u32>, DiarizationError> {
        let mut matrix = vec![vec![0.0; count]; count];
        for (left, row) in matrix.iter_mut().enumerate() {
            for (right, cell) in row.iter_mut().enumerate() {
                if left != right {
                    let (a, b) = ordered_pair(left, right);
                    *cell = distances[a * (2 * count - a - 1) / 2 + b - a - 1];
                }
            }
        }
        let mut groups = (0..count).map(|i| vec![i]).collect::<Vec<_>>();
        loop {
            let mut best = None;
            for left in 0..groups.len() {
                for right in left + 1..groups.len() {
                    let distance = groups[left]
                        .iter()
                        .flat_map(|a| groups[right].iter().map(|b| matrix[*a][*b]))
                        .fold(0.0_f64, f64::max);
                    if distance < threshold && best.is_none_or(|(_, _, old)| distance < old) {
                        best = Some((left, right, distance));
                    }
                }
            }
            let Some((left, right, _)) = best else {
                break;
            };
            let right_members = groups.remove(right);
            groups[left].extend(right_members);
        }
        let mut labels = vec![0; count];
        for (label, members) in groups.iter().enumerate() {
            for member in members {
                labels[*member] = label as u32;
            }
        }
        Ok(labels)
    }
    fn interval(start: u64, end: u64) -> LocalSegment {
        LocalSegment {
            start_sample: start,
            end_sample: end,
        }
    }
    fn raw(
        id: u32,
        chunk: u32,
        slot: u32,
        extent: LocalSegment,
        activity: Vec<LocalSegment>,
        clean: Vec<LocalSegment>,
        dimension: Option<usize>,
    ) -> LocalSpeakerObservation {
        let mut embedding = Vec::new();
        if let Some(dimension) = dimension {
            embedding.resize(512, 0.0);
            embedding[dimension] = 1.0;
        }
        LocalSpeakerObservation {
            local_speaker: id,
            chunk_index: chunk,
            slot,
            chunk_start: extent.start_sample,
            chunk_end: extent.end_sample,
            embedding_status: if dimension.is_some() { 0 } else { 1 },
            embedding,
            segments: activity,
            clean_segments: clean,
        }
    }
    fn window(
        source: TrackKind,
        start: u64,
        end: u64,
        speakers: Vec<LocalSpeakerObservation>,
    ) -> WindowObservation {
        WindowObservation {
            window: WindowSpec {
                index: 0,
                source,
                start_sample: start,
                end_sample: end,
                time_reliable: true,
            },
            speakers,
        }
    }
    #[test]
    fn eight_hour_five_person_meeting_fits_the_shared_candidate_budget() {
        let config = BoundedDiarizationConfig::default();
        let mut fusion = BoundedDiarization::new(config).unwrap();
        let duration = 8 * 3_600 * u64::from(DEFAULT_SAMPLE_RATE);
        let step = config.window_samples - config.overlap_samples;
        let mut expected_activity = 0;
        for start in (0..duration).step_by(step as usize) {
            let end = (start + config.window_samples).min(duration);
            let owned = interval(
                start
                    + if start == 0 {
                        0
                    } else {
                        config.overlap_samples / 2
                    },
                if end == duration {
                    end
                } else {
                    end - config.overlap_samples / 2
                },
            );
            if owned.start_sample >= owned.end_sample {
                continue;
            }
            for (source, count, first_axis) in
                [(TrackKind::Microphone, 1, 0), (TrackKind::System, 4, 1)]
            {
                let speakers = (0..count)
                    .filter_map(|person| {
                        let begin = (5 + person as u64 * 10) * 16_000;
                        let chunk_end = (begin + 10 * 16_000).min(end - start);
                        let activity =
                            interval(begin + 16_000, (begin + 5 * 16_000).min(chunk_end));
                        if activity.start_sample >= activity.end_sample {
                            return None;
                        }
                        expected_activity += 1;
                        Some(raw(
                            person,
                            person,
                            0,
                            interval(begin, chunk_end),
                            vec![activity],
                            vec![activity],
                            Some(first_axis + person as usize),
                        ))
                    })
                    .collect();
                fusion
                    .push(window(source, start, end, speakers), owned, cluster)
                    .expect("normal five-person meeting must reach the eight-hour tail");
            }
        }
        assert!(fusion.prototypes.len() <= MAX_GLOBAL_PROTOTYPES);
        // For fixed orthogonal voices only 0, 1 and conflict-barrier distances
        // occur, so their zero-distance equivalence classes are the exact
        // complete-link result without the small oracle's cubic test cost.
        let result = fusion
            .finish(|distances, count, threshold| {
                assert!(threshold > 0.0 && threshold < 1.0);
                assert!(
                    distances
                        .iter()
                        .all(|d| [0.0, 1.0, CANNOT_LINK_DISTANCE].contains(d))
                );
                let mut labels = Vec::new();
                let mut next = 0;
                for right in 0..count {
                    let same = (0..right).find(|left| {
                        distances[left * (2 * count - left - 1) / 2 + right - left - 1] == 0.0
                    });
                    let label = same.map_or_else(
                        || {
                            let label = next;
                            next += 1;
                            label
                        },
                        |left| labels[left],
                    );
                    labels.push(label);
                }
                Ok(labels)
            })
            .unwrap();
        assert_eq!(result.speaker_count, 5);
        assert_eq!(result.segments.len(), expected_activity);
        assert!(result.segments.iter().all(|s| s.global_speaker.is_some()));
        assert!(
            result
                .segments
                .iter()
                .any(|s| s.start_sample > duration - config.window_samples)
        );
    }

    #[test]
    fn context_only_detections_survive_once_without_inventing_an_identity() {
        for second_window_knows_one in [false, true] {
            let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
            fusion
                .push(
                    window(
                        TrackKind::Microphone,
                        0,
                        128_000,
                        (0..2)
                            .map(|slot| {
                                raw(
                                    slot,
                                    0,
                                    slot,
                                    interval(0, 128_000),
                                    vec![interval(80_000, 120_000)],
                                    vec![],
                                    None,
                                )
                            })
                            .collect(),
                    ),
                    interval(0, 64_000),
                    cluster,
                )
                .unwrap();
            let observed = if second_window_knows_one {
                vec![raw(
                    0,
                    0,
                    0,
                    interval(0, 128_000),
                    vec![interval(16_000, 56_000)],
                    vec![interval(16_000, 56_000)],
                    Some(0),
                )]
            } else {
                vec![]
            };
            fusion
                .push(
                    window(TrackKind::Microphone, 64_000, 192_000, observed),
                    interval(64_000, 192_000),
                    cluster,
                )
                .unwrap();
            // A third observation of the same context must not double votes.
            fusion
                .push(
                    window(
                        TrackKind::Microphone,
                        64_000,
                        224_000,
                        (0..2)
                            .map(|slot| {
                                raw(
                                    slot,
                                    0,
                                    slot,
                                    interval(0, 160_000),
                                    vec![interval(16_000, 56_000)],
                                    vec![],
                                    None,
                                )
                            })
                            .collect(),
                    ),
                    interval(192_000, 224_000),
                    cluster,
                )
                .unwrap();
            let result = fusion.finish(cluster).unwrap();
            assert_eq!(result.speaker_count, u32::from(second_window_knows_one));
            assert_eq!(result.segments.len(), 2);
            assert!(
                result
                    .segments
                    .iter()
                    .all(|s| s.start_sample == 80_000 && s.end_sample == 120_000)
            );
            assert_eq!(
                result
                    .segments
                    .iter()
                    .filter(|s| s.global_speaker.is_none())
                    .count(),
                if second_window_knows_one { 1 } else { 2 }
            );
        }
    }

    #[test]
    fn unknown_is_not_an_identity_that_can_merge_simultaneous_speakers() {
        for second_start in [0, 8_000] {
            let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
            fusion
                .push(
                    window(
                        TrackKind::Microphone,
                        0,
                        32_000,
                        vec![
                            raw(
                                0,
                                0,
                                0,
                                interval(0, 32_000),
                                vec![interval(0, 32_000)],
                                vec![],
                                None,
                            ),
                            raw(
                                1,
                                0,
                                1,
                                interval(0, 32_000),
                                vec![interval(second_start, 32_000)],
                                vec![],
                                None,
                            ),
                        ],
                    ),
                    interval(0, 32_000),
                    cluster,
                )
                .unwrap();
            let result = fusion.finish(cluster).unwrap();
            assert_eq!(result.speaker_count, 0);
            assert_eq!(result.segments.len(), 2);
            assert_eq!(
                result
                    .segments
                    .iter()
                    .map(|s| s.end_sample - s.start_sample)
                    .sum::<u64>(),
                64_000 - second_start
            );
            assert!(result.segments.iter().all(|s| s.global_speaker.is_none()));
        }
    }

    #[test]
    fn missing_or_short_voice_vector_keeps_detected_activity_unknown() {
        for vector in [None, Some(0)] {
            let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
            let clean = if vector.is_some() {
                vec![interval(0, 320)]
            } else {
                vec![]
            };
            fusion
                .push(
                    window(
                        TrackKind::Microphone,
                        71,
                        391,
                        vec![raw(
                            0,
                            0,
                            0,
                            interval(0, 320),
                            vec![interval(0, 320)],
                            clean,
                            vector,
                        )],
                    ),
                    interval(71, 391),
                    cluster,
                )
                .unwrap();
            let result = fusion.finish(cluster).unwrap();
            assert_eq!(result.speaker_count, 0);
            assert_eq!(
                result.segments,
                vec![GlobalSpeakerSegment {
                    source: TrackKind::Microphone,
                    start_sample: 71,
                    end_sample: 391,
                    global_speaker: None
                }]
            );
        }
    }
    #[test]
    fn weak_voice_can_be_assigned_but_cannot_build_or_move_an_identity() {
        let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
        let mut reply = raw(
            1,
            1,
            0,
            interval(48_000, 80_000),
            vec![interval(50_000, 58_000)],
            vec![interval(50_000, 58_000)],
            Some(0),
        );
        reply.embedding[0] = 0.9;
        reply.embedding[1] = 0.4358899;
        fusion
            .push(
                window(
                    TrackKind::Microphone,
                    0,
                    112_000,
                    vec![
                        raw(
                            0,
                            0,
                            0,
                            interval(0, 48_000),
                            vec![interval(0, 48_000)],
                            vec![interval(0, 48_000)],
                            Some(0),
                        ),
                        reply,
                        raw(
                            2,
                            2,
                            0,
                            interval(80_000, 112_000),
                            vec![interval(80_000, 104_000)],
                            vec![interval(80_000, 104_000)],
                            Some(2),
                        ),
                    ],
                ),
                interval(0, 112_000),
                cluster,
            )
            .unwrap();
        assert_eq!(
            fusion.prototypes.len(),
            1,
            "a weak unrelated vector is not a new person"
        );
        assert_eq!(fusion.prototypes[0].embedding[0], 1.0);
        assert_eq!(
            fusion.prototypes[0].embedding[1], 0.0,
            "assigned replies cannot move the voice centre"
        );
        assert_eq!(fusion.prototypes[0].witnesses.len(), 1);
        let result = fusion.finish(cluster).unwrap();
        assert_eq!(result.speaker_count, 1);
        assert_eq!(result.segments.len(), 3);
        assert_eq!(
            result.segments[0].global_speaker,
            result.segments[1].global_speaker
        );
        assert_eq!(result.segments[2].global_speaker, None);
    }

    #[test]
    fn simultaneously_active_weak_slots_cannot_claim_the_same_identity() {
        let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
        fusion
            .push(
                window(
                    TrackKind::Microphone,
                    0,
                    80_000,
                    vec![
                        raw(
                            0,
                            0,
                            0,
                            interval(0, 48_000),
                            vec![interval(0, 48_000)],
                            vec![interval(0, 48_000)],
                            Some(0),
                        ),
                        raw(
                            1,
                            1,
                            0,
                            interval(48_000, 80_000),
                            vec![interval(48_000, 64_000)],
                            vec![interval(48_000, 56_000)],
                            Some(0),
                        ),
                        raw(
                            2,
                            1,
                            1,
                            interval(48_000, 80_000),
                            vec![interval(56_000, 72_000)],
                            vec![interval(64_000, 72_000)],
                            Some(0),
                        ),
                    ],
                ),
                interval(0, 80_000),
                cluster,
            )
            .unwrap();
        let result = fusion.finish(cluster).unwrap();
        assert_eq!(result.speaker_count, 1);
        assert_eq!(result.segments.len(), 3);
        assert!(
            result.segments[1..]
                .iter()
                .all(|s| s.global_speaker.is_none())
        );
    }

    #[test]
    fn a_close_alternative_keeps_a_weak_reply_unassigned() {
        let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
        let mut second = raw(
            1,
            0,
            1,
            interval(0, 128_000),
            vec![interval(32_000, 128_000)],
            vec![interval(96_000, 128_000)],
            Some(0),
        );
        second.embedding[0] = 0.95;
        second.embedding[1] = 0.3122499;
        fusion
            .push(
                window(
                    TrackKind::Microphone,
                    0,
                    160_000,
                    vec![
                        raw(
                            0,
                            0,
                            0,
                            interval(0, 128_000),
                            vec![interval(0, 96_000)],
                            vec![interval(0, 32_000)],
                            Some(0),
                        ),
                        second,
                        raw(
                            2,
                            1,
                            0,
                            interval(128_000, 160_000),
                            vec![interval(136_000, 152_000)],
                            vec![interval(136_000, 152_000)],
                            Some(0),
                        ),
                    ],
                ),
                interval(0, 160_000),
                cluster,
            )
            .unwrap();
        let result = fusion.finish(cluster).unwrap();
        assert_eq!(result.speaker_count, 2);
        assert_eq!(
            result
                .segments
                .iter()
                .find(|s| s.start_sample == 136_000)
                .unwrap()
                .global_speaker,
            None
        );
    }

    #[test]
    fn assigned_weak_activity_retains_cross_source_conflicts() {
        let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
        fusion
            .push(
                window(
                    TrackKind::Microphone,
                    0,
                    64_000,
                    vec![
                        raw(
                            0,
                            0,
                            0,
                            interval(0, 48_000),
                            vec![interval(0, 48_000)],
                            vec![interval(0, 48_000)],
                            Some(0),
                        ),
                        raw(
                            1,
                            1,
                            0,
                            interval(48_000, 64_000),
                            vec![interval(52_000, 60_000)],
                            vec![interval(52_000, 60_000)],
                            Some(0),
                        ),
                    ],
                ),
                interval(0, 64_000),
                cluster,
            )
            .unwrap();
        fusion
            .push(
                window(
                    TrackKind::System,
                    48_000,
                    96_000,
                    vec![raw(
                        0,
                        0,
                        0,
                        interval(0, 48_000),
                        vec![interval(0, 48_000)],
                        vec![interval(0, 48_000)],
                        Some(0),
                    )],
                ),
                interval(48_000, 96_000),
                cluster,
            )
            .unwrap();
        let result = fusion.finish(cluster).unwrap();
        assert_eq!(result.speaker_count, 2);
        let microphone = result
            .segments
            .iter()
            .find(|s| s.source == TrackKind::Microphone && s.start_sample == 52_000)
            .unwrap();
        let system = result
            .segments
            .iter()
            .find(|s| s.source == TrackKind::System)
            .unwrap();
        assert!(microphone.global_speaker.is_some());
        assert_ne!(microphone.global_speaker, system.global_speaker);
    }

    #[test]
    fn overlap_cannot_link_survives_local_prototypes_and_a_third_bridge() {
        let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
        let observations = vec![
            raw(
                0,
                0,
                0,
                interval(0, 120_000),
                vec![interval(0, 80_000)],
                vec![interval(0, 40_000)],
                Some(0),
            ),
            raw(
                1,
                0,
                1,
                interval(0, 120_000),
                vec![interval(40_000, 120_000)],
                vec![interval(80_000, 120_000)],
                Some(0),
            ),
            raw(
                2,
                1,
                0,
                interval(120_000, 200_000),
                vec![interval(120_000, 200_000)],
                vec![interval(120_000, 200_000)],
                Some(0),
            ),
        ];
        fusion
            .push(
                window(TrackKind::System, 0, 200_000, observations),
                interval(0, 200_000),
                cluster,
            )
            .unwrap();
        assert_eq!(fusion.cannot_link.len(), 1);
        let result = fusion.finish(cluster).unwrap();
        assert_eq!(result.speaker_count, 2);
        let a = result
            .segments
            .iter()
            .find(|s| s.start_sample == 0)
            .unwrap();
        let b = result
            .segments
            .iter()
            .find(|s| s.start_sample == 40_000)
            .unwrap();
        assert_ne!(a.global_speaker, b.global_speaker);
    }
    #[test]
    fn same_window_labels_without_simultaneous_activity_may_merge() {
        let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
        let observations = vec![
            raw(
                0,
                0,
                0,
                interval(0, 64_000),
                vec![interval(0, 32_000)],
                vec![interval(0, 32_000)],
                Some(0),
            ),
            raw(
                1,
                0,
                1,
                interval(0, 64_000),
                vec![interval(32_000, 64_000)],
                vec![interval(32_000, 64_000)],
                Some(0),
            ),
        ];
        fusion
            .push(
                window(TrackKind::System, 0, 64_000, observations),
                interval(0, 64_000),
                cluster,
            )
            .unwrap();
        let result = fusion.finish(cluster).unwrap();
        assert_eq!(result.speaker_count, 1);
        assert_eq!(result.segments.len(), 1);
    }
    #[test]
    fn shared_identity_can_cross_sources_but_reliable_double_talk_cannot() {
        for (second_start, expected) in [(0, 2), (32_000, 1)] {
            let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig::default()).unwrap();
            for (source, start) in [
                (TrackKind::Microphone, 0),
                (TrackKind::System, second_start),
            ] {
                fusion
                    .push(
                        window(
                            source,
                            start,
                            start + 32_000,
                            vec![raw(
                                0,
                                0,
                                0,
                                interval(0, 32_000),
                                vec![interval(0, 32_000)],
                                vec![interval(0, 32_000)],
                                Some(0),
                            )],
                        ),
                        interval(start, start + 32_000),
                        cluster,
                    )
                    .unwrap();
            }
            let result = fusion.finish(cluster).unwrap();
            assert_eq!(result.speaker_count, expected);
            assert_eq!(result.segments.len(), 2);
        }
    }
    #[test]
    fn owned_clean_duration_prevents_repeated_pcm_from_overweighting_a_vector() {
        let mut fusion = BoundedDiarization::new(BoundedDiarizationConfig {
            window_merge_distance: 1.5,
            ..Default::default()
        })
        .unwrap();
        let observations = vec![
            raw(
                0,
                0,
                0,
                interval(0, 64_000),
                vec![interval(0, 64_000)],
                vec![interval(0, 64_000)],
                Some(0),
            ),
            raw(
                1,
                1,
                0,
                interval(16_000, 80_000),
                vec![interval(16_000, 80_000)],
                vec![interval(16_000, 80_000)],
                Some(1),
            ),
        ];
        fusion
            .push(
                window(TrackKind::System, 0, 80_000, observations),
                interval(24_000, 72_000),
                cluster,
            )
            .unwrap();
        assert_eq!(fusion.prototypes.len(), 1);
        let centre = &fusion.prototypes[0].embedding;
        // Native chunks own [24k,40k), [40k,72k): 1:2 independent PCM.
        assert!((centre[1] / centre[0] - 2.0).abs() < 1e-5);
    }
    #[test]
    fn source_window_gap_and_exact_tail_do_not_stretch_or_repeat_audio() {
        use crate::protocol::record_timeline::CaptureTimeQuality;
        use crate::record_source::SourceAudioChunk;
        let config = BoundedDiarizationConfig {
            window_samples: 1000,
            overlap_samples: 100,
            ..Default::default()
        };
        let mut buffer = SourceWindowBuffer::new(TrackKind::Microphone, config).unwrap();
        let chunk = |start, count, quality| SourceAudioChunk {
            track: TrackKind::Microphone,
            start_sample: start,
            channels: 1,
            quality,
            discontinuity: false,
            echo_reference: None,
            aec_applied: false,
            samples: Zeroizing::new(vec![0.25; count]),
        };
        let ready = buffer
            .accept(&chunk(77, 1000, CaptureTimeQuality::Clock))
            .unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].spec.start_sample, 77);
        assert_eq!(ready[0].spec.end_sample, 1077);
        assert!(buffer.finish().unwrap().is_none());
        assert!(
            buffer
                .accept(&chunk(2000, 20, CaptureTimeQuality::Clock))
                .unwrap()
                .is_empty()
        );
        let ready = buffer
            .accept(&chunk(2020, 80, CaptureTimeQuality::Gap))
            .unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].pcm.len(), 20);
        assert_eq!(ready[0].spec.end_sample, 2020);
        assert!(
            buffer
                .accept(&chunk(2100, 1, CaptureTimeQuality::Estimated))
                .unwrap()
                .is_empty()
        );
        let tail = buffer.finish().unwrap().unwrap();
        assert_eq!(tail.spec.start_sample, 2100);
        assert_eq!(tail.pcm.len(), 1);
        assert!(!tail.spec.time_reliable);
    }
    #[test]
    fn empty_and_invalid_observations_are_distinct() {
        let mut fusion = BoundedDiarization::new(Default::default()).unwrap();
        fusion
            .push(
                window(TrackKind::System, 0, 320, vec![]),
                interval(0, 320),
                cluster,
            )
            .unwrap();
        assert_eq!(fusion.finish(cluster).unwrap().speaker_count, 0);
        assert!(
            BoundedDiarization::new(BoundedDiarizationConfig {
                global_same_speaker_distance: f64::NAN,
                ..Default::default()
            })
            .is_err()
        );
        let mut malformed = raw(
            0,
            0,
            0,
            interval(0, 32_000),
            vec![interval(0, 32_000)],
            vec![interval(0, 32_000)],
            Some(0),
        );
        malformed.embedding[0] = f32::NAN;
        assert_eq!(
            BoundedDiarization::new(Default::default()).unwrap().push(
                window(TrackKind::System, 0, 32_000, vec![malformed]),
                interval(0, 32_000),
                cluster
            ),
            Err(DiarizationError::InvalidEmbedding)
        );
    }
}
