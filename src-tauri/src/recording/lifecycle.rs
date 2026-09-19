//! Checksummed lifecycle journal for capture/device/recovery facts.

use crate::durable_journal::DurableRecordJournal;
use crate::record::AudioTrackKind;
use myagents_media_worker_protocol::record_timeline::{
    CaptureTimeQuality, RecordTrackTimeline, TrackTimeSpan, MAX_TRACK_TIME_SPANS,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

const LIFECYCLE_SCHEMA_VERSION: u32 = 1;
const MAX_JOURNAL_LINE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LifecycleEvent {
    CaptureTrackTime {
        track: AudioTrackKind,
        from_index: usize,
        spans: Vec<TrackTimeSpan>,
    },
    CaptureAdmitted {
        operation_id: String,
        sources: Vec<String>,
    },
    CaptureStatusChanged {
        from: String,
        to: String,
        reason: String,
    },
    PauseStarted {
        operation_id: String,
    },
    PauseEnded {
        operation_id: String,
        paused_wall_ms: u64,
    },
    DeviceGap {
        source: String,
        error_code: String,
    },
    WakeLockWarning {
        error_code: String,
    },
    ArchiveFinalized {
        tracks: Vec<String>,
        size_bytes: u64,
        overrun_samples: u64,
    },
    RecoveryCommitted {
        repaired_tracks: Vec<String>,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleEntry {
    pub seq: u64,
    pub wall_time_ms: i64,
    pub media_ms: u64,
    pub event: LifecycleEvent,
}

pub struct LifecycleJournal {
    inner: DurableRecordJournal<LifecycleEvent>,
}

impl LifecycleJournal {
    pub fn recover_track_time(
        entries: &[LifecycleEntry],
        track: AudioTrackKind,
        samples: u64,
    ) -> Result<Option<RecordTrackTimeline>, String> {
        let mut spans = Vec::new();
        for entry in entries {
            let LifecycleEvent::CaptureTrackTime {
                track: kind,
                from_index,
                spans: update,
            } = &entry.event
            else {
                continue;
            };
            if *kind != track {
                continue;
            }
            if *from_index > spans.len()
                || from_index.saturating_add(update.len()) > MAX_TRACK_TIME_SPANS
            {
                return Err("invalid capture time checkpoint sequence".into());
            }
            spans.truncate(*from_index);
            spans.extend_from_slice(update);
            if !(RecordTrackTimeline {
                spans: spans.clone(),
            })
            .is_valid()
            {
                return Err("invalid capture time checkpoint".into());
            }
        }
        let Some(last) = spans.last().cloned() else {
            return Ok(None);
        };
        if samples > last.source_end {
            // After a crash the audio can be ahead of the last time checkpoint.
            // Preserve that speech while explicitly withholding precise timing.
            spans.push(TrackTimeSpan {
                source_start: last.source_end,
                source_end: samples,
                record_start: last.record_end,
                record_end: last.record_end.saturating_add(samples - last.source_end),
                quality: CaptureTimeQuality::Estimated,
                discontinuity: true,
            });
        }
        let timeline = RecordTrackTimeline { spans };
        timeline
            .prefix(samples)
            .map(Some)
            .ok_or_else(|| "invalid recovered capture time extent".into())
    }

    pub fn open(record_dir: &Path, record_id: &str) -> Result<Self, String> {
        let path = record_dir.join("lifecycle.jsonl");
        Ok(Self {
            inner: DurableRecordJournal::open(
                path,
                record_id,
                LIFECYCLE_SCHEMA_VERSION,
                MAX_JOURNAL_LINE_BYTES,
            )?,
        })
    }

    pub fn append(
        &mut self,
        wall_time_ms: i64,
        media_ms: u64,
        event: LifecycleEvent,
    ) -> Result<LifecycleEntry, String> {
        let entry = self.inner.append(wall_time_ms, media_ms, event)?;
        Ok(LifecycleEntry {
            seq: entry.seq,
            wall_time_ms: entry.wall_time_ms,
            media_ms: entry.media_ms,
            event: entry.event,
        })
    }

    pub fn read_entries(record_dir: &Path, record_id: &str) -> Result<Vec<LifecycleEntry>, String> {
        crate::durable_journal::recover_and_read::<LifecycleEvent>(
            &record_dir.join("lifecycle.jsonl"),
            record_id,
            LIFECYCLE_SCHEMA_VERSION,
            MAX_JOURNAL_LINE_BYTES,
        )
        .map(|entries| {
            entries
                .into_iter()
                .map(|entry| LifecycleEntry {
                    seq: entry.seq,
                    wall_time_ms: entry.wall_time_ms,
                    media_ms: entry.media_ms,
                    event: entry.event,
                })
                .collect()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, OpenOptions};
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn recovery_replays_timing_updates_and_marks_audio_after_checkpoint_estimated() {
        let mut entries = Vec::new();
        let span = |end, record_end| TrackTimeSpan {
            source_start: 0,
            source_end: end,
            record_start: 3_200,
            record_end,
            quality: CaptureTimeQuality::Clock,
            discontinuity: true,
        };
        for (seq, extent, record_end) in [(1, 1_600, 4_800), (2, 3_200, 6_402)] {
            entries.push(LifecycleEntry {
                seq,
                wall_time_ms: 0,
                media_ms: 0,
                event: LifecycleEvent::CaptureTrackTime {
                    track: AudioTrackKind::Microphone,
                    from_index: 0,
                    spans: vec![span(extent, record_end)],
                },
            });
        }
        let recovered =
            LifecycleJournal::recover_track_time(&entries, AudioTrackKind::Microphone, 4_000)
                .unwrap()
                .unwrap();
        assert_eq!(recovered.spans.len(), 2);
        assert_eq!(recovered.spans[0], span(3_200, 6_402));
        assert_eq!(recovered.spans[1].quality, CaptureTimeQuality::Estimated);
        assert_eq!(recovered.spans[1].source_end, 4_000);
        let truncated =
            LifecycleJournal::recover_track_time(&entries, AudioTrackKind::Microphone, 1_600)
                .unwrap()
                .unwrap();
        assert_eq!(truncated.spans[0].record_end, 4_801);
        assert!(
            LifecycleJournal::recover_track_time(&entries, AudioTrackKind::System, 4_000)
                .unwrap()
                .is_none()
        );
        entries.push(LifecycleEntry {
            seq: 3,
            wall_time_ms: 0,
            media_ms: 0,
            event: LifecycleEvent::CaptureTrackTime {
                track: AudioTrackKind::Microphone,
                from_index: 2,
                spans: vec![span(5_000, 8_200)],
            },
        });
        assert!(
            LifecycleJournal::recover_track_time(&entries, AudioTrackKind::Microphone, 5_000)
                .is_err()
        );
    }

    #[test]
    fn journal_repairs_torn_tail_and_continues_sequence() {
        let root = tempdir().unwrap();
        let path = root.path().join("lifecycle.jsonl");
        File::create(&path).unwrap();
        let mut journal = LifecycleJournal::open(root.path(), "record-1").unwrap();
        journal
            .append(
                10,
                0,
                LifecycleEvent::CaptureStatusChanged {
                    from: "preparing".into(),
                    to: "recording".into(),
                    reason: "device_opened".into(),
                },
            )
            .unwrap();
        OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"schemaVersion\":")
            .unwrap();

        let mut recovered = LifecycleJournal::open(root.path(), "record-1").unwrap();
        let second = recovered
            .append(
                20,
                100,
                LifecycleEvent::PauseStarted {
                    operation_id: "pause-1".into(),
                },
            )
            .unwrap();
        assert_eq!(second.seq, 2);
        let entries = LifecycleJournal::read_entries(root.path(), "record-1").unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn checksum_or_record_identity_mismatch_is_not_accepted() {
        let root = tempdir().unwrap();
        let path = root.path().join("lifecycle.jsonl");
        File::create(&path).unwrap();
        let mut journal = LifecycleJournal::open(root.path(), "record-1").unwrap();
        journal
            .append(
                10,
                0,
                LifecycleEvent::WakeLockWarning {
                    error_code: "unsupported".into(),
                },
            )
            .unwrap();
        assert!(LifecycleJournal::read_entries(root.path(), "record-2").is_err());
        assert!(path.metadata().unwrap().len() > 0);
    }

    #[test]
    fn pre_extraction_lifecycle_bytes_remain_readable() {
        let root = tempdir().unwrap();
        let path = root.path().join("lifecycle.jsonl");
        let legacy_line = concat!(
            "{\"schemaVersion\":1,\"recordId\":\"record-1\",\"seq\":1,",
            "\"eventId\":\"event-1\",\"wallTimeMs\":10,\"mediaMs\":0,",
            "\"event\":{\"type\":\"wake_lock_warning\",\"error_code\":\"unsupported\"},",
            "\"checksum\":\"60e4600439af99c25a5a0144c3b9abc28d23520dec0876751c92565211c925cc\"}\n"
        );
        std::fs::write(&path, legacy_line).unwrap();

        let entries = LifecycleJournal::read_entries(root.path(), "record-1").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].event,
            LifecycleEvent::WakeLockWarning {
                error_code: "unsupported".into()
            }
        );
        assert_eq!(std::fs::read_to_string(path).unwrap(), legacy_line);
    }
}
