//! Bounded original-audio identity evidence, shared by the computing Worker and
//! publishing Store. Distances are millionths of cosine distance, not odds.
use crate::{MAX_MEDIA_SAMPLES_PER_TRACK, TrackKind};
use serde::{Deserialize, Serialize};

pub const MAX_IDENTITY_PEOPLE: usize = 2_048;
pub const MAX_IDENTITY_INTERVALS: usize = 32_768;
pub const MAX_IDENTITY_DOCUMENT_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_IDENTITY_LABELS_PER_PERSON: usize = 64;
pub const MAX_IDENTITY_BATCH: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginalSpeechInterval {
    pub source: TrackKind,
    pub start_sample: u64,
    pub end_sample: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonAnchor {
    pub person_id: u32,
    /// Each scope was one original identity. Several scopes are related only
    /// by an explicit human merge; they need not pass a same-voice test.
    pub identity_scopes: Vec<Vec<OriginalSpeechInterval>>,
    pub has_unresolved_activity: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityAnchorDocument {
    pub schema_version: u32,
    pub audio_identity: String,
    pub people: Vec<PersonAnchor>,
    /// Explicit paragraph assignments are projected separately. They must not
    /// change the acoustic definition of either the donor or target identity.
    pub assignment_exclusions: Vec<OriginalSpeechInterval>,
}
impl IdentityAnchorDocument {
    pub fn has_valid_shape(&self) -> bool {
        self.schema_version == 1
            && self.audio_identity.len() == 64
            && self.audio_identity.bytes().all(|b| b.is_ascii_hexdigit())
            && self.people.len() <= MAX_IDENTITY_PEOPLE
            && self
                .people
                .windows(2)
                .all(|pair| pair[0].person_id < pair[1].person_id)
            && self
                .people
                .iter()
                .flat_map(|p| &p.identity_scopes)
                .map(Vec::len)
                .sum::<usize>()
                + self.assignment_exclusions.len()
                <= MAX_IDENTITY_INTERVALS
            && self.people.iter().all(|p| {
                p.identity_scopes.len() <= MAX_IDENTITY_PEOPLE
                    && p.identity_scopes
                        .iter()
                        .all(|scope| !scope.is_empty() && valid_intervals(scope))
            })
            && valid_intervals(&self.assignment_exclusions)
    }
}

fn valid_intervals(intervals: &[OriginalSpeechInterval]) -> bool {
    intervals.iter().all(|i| {
        matches!(
            i.source,
            TrackKind::Microphone | TrackKind::System | TrackKind::Mixed
        ) && i.start_sample < i.end_sample
            && i.end_sample <= MAX_MEDIA_SAMPLES_PER_TRACK
    }) && intervals.windows(2).all(|pair| {
        let a = &pair[0];
        let b = &pair[1];
        a.source < b.source || (a.source == b.source && a.end_sample < b.start_sample)
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityAnchorInput {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonMatchEvidence {
    pub person_id: u32,
    pub model_labels: Vec<u32>,
    pub reference_samples: u64,
    pub reference_covered_samples: u64,
    pub candidate_samples: u64,
    pub candidate_covered_samples: u64,
    pub independent_clean_spans: u32,
    pub maximum_voice_distance: u32,
    pub nearest_alternative_distance: u32,
    pub activity_conflict: bool,
    pub has_unresolved_activity: bool,
}
impl PersonMatchEvidence {
    pub fn has_valid_shape(&self) -> bool {
        self.model_labels.len() <= MAX_IDENTITY_LABELS_PER_PERSON
            && self
                .model_labels
                .iter()
                .all(|label| *label < MAX_IDENTITY_PEOPLE as u32)
            && self.model_labels.windows(2).all(|pair| pair[0] < pair[1])
            && self.reference_samples <= 2 * MAX_MEDIA_SAMPLES_PER_TRACK
            && self.candidate_samples <= 2 * MAX_MEDIA_SAMPLES_PER_TRACK
            && self.reference_covered_samples <= self.reference_samples
            && self.candidate_covered_samples <= self.candidate_samples
            && self.maximum_voice_distance <= 3_000_000
            && self.nearest_alternative_distance <= 3_000_000
            && self.independent_clean_spans <= MAX_IDENTITY_INTERVALS as u32
    }

    /// Initial precision-first policy. Quality gates must calibrate and freeze
    /// these constants; shape validity or cosine similarity is not confidence.
    pub fn is_accepted(&self) -> bool {
        self.has_valid_shape()
            && !self.model_labels.is_empty()
            && !self.activity_conflict
            && !self.has_unresolved_activity
            && self.reference_samples >= 16_000
            && self.candidate_samples >= 16_000
            && self.reference_covered_samples as u128 * 100 >= self.reference_samples as u128 * 95
            && self.candidate_covered_samples as u128 * 100 >= self.candidate_samples as u128 * 95
            && self.independent_clean_spans >= 2
            && self.maximum_voice_distance < 300_000
            && self.nearest_alternative_distance >= self.maximum_voice_distance + 100_000
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn verified() -> PersonMatchEvidence {
        PersonMatchEvidence {
            person_id: 17,
            model_labels: vec![4],
            reference_samples: 32_000,
            reference_covered_samples: 32_000,
            candidate_samples: 32_000,
            candidate_covered_samples: 32_000,
            independent_clean_spans: 2,
            maximum_voice_distance: 150_000,
            nearest_alternative_distance: 450_000,
            activity_conflict: false,
            has_unresolved_activity: false,
        }
    }
    #[test]
    fn precise_temporal_match_does_not_erase_acoustic_or_source_ambiguity() {
        assert!(verified().is_accepted());
        let mut proof = verified();
        proof.maximum_voice_distance = 300_000;
        assert!(!proof.is_accepted());
        let mut proof = verified();
        proof.has_unresolved_activity = true;
        assert!(!proof.is_accepted());
        let mut proof = verified();
        proof.activity_conflict = true;
        assert!(!proof.is_accepted());
        let mut proof = verified();
        proof.independent_clean_spans = 1;
        assert!(!proof.is_accepted());
        let mut proof = verified();
        proof.nearest_alternative_distance = 249_999;
        assert!(!proof.is_accepted());
    }
    #[test]
    fn partial_coverage_cannot_rename_a_larger_or_mixed_identity() {
        let mut proof = verified();
        proof.candidate_samples = 64_000;
        assert!(!proof.is_accepted());
        let mut proof = verified();
        proof.reference_samples = 64_000;
        assert!(!proof.is_accepted());
        let mut proof = verified();
        proof.model_labels = vec![4, 4];
        assert!(!proof.has_valid_shape());
        let mut proof = verified();
        proof.reference_covered_samples = u64::MAX;
        assert!(!proof.has_valid_shape());
    }
    #[test]
    fn anchor_documents_preserve_component_scopes_and_reject_unbounded_or_ambiguous_order() {
        let interval = |start_sample, end_sample| OriginalSpeechInterval {
            source: TrackKind::Microphone,
            start_sample,
            end_sample,
        };
        let doc = IdentityAnchorDocument {
            schema_version: 1,
            audio_identity: "a".repeat(64),
            people: vec![PersonAnchor {
                person_id: 7,
                identity_scopes: vec![vec![interval(0, 16_000)], vec![interval(32_000, 64_000)]],
                has_unresolved_activity: false,
            }],
            assignment_exclusions: vec![interval(16_000, 24_000)],
        };
        assert!(doc.has_valid_shape());
        let roundtrip: IdentityAnchorDocument =
            serde_json::from_slice(&serde_json::to_vec(&doc).unwrap()).unwrap();
        assert_eq!(roundtrip, doc);
        let mut invalid = doc.clone();
        invalid.people.push(doc.people[0].clone());
        assert!(!invalid.has_valid_shape());
        let mut invalid = doc.clone();
        invalid.people[0].identity_scopes[0].push(interval(15_000, 20_000));
        assert!(!invalid.has_valid_shape());
        let mut invalid = doc.clone();
        invalid.people[0].identity_scopes.push(vec![]);
        assert!(!invalid.has_valid_shape());
        let mut invalid = doc.clone();
        invalid.assignment_exclusions[0].end_sample = MAX_MEDIA_SAMPLES_PER_TRACK + 1;
        assert!(!invalid.has_valid_shape());
        let mut invalid = doc;
        invalid.people[0].identity_scopes = vec![vec![interval(0, 1)]; MAX_IDENTITY_INTERVALS + 1];
        assert!(!invalid.has_valid_shape());
    }
}
