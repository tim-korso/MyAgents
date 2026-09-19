//! Filesystem watcher that keeps the session search index in sync with
//! on-disk state.
//!
//! # Why a watcher instead of call-site notifications
//!
//! MyAgents session files are written by the Bun Sidecar while the search
//! index lives in Rust. The obvious alternative — have Bun POST to Rust on
//! every save — has two problems:
//!
//! 1. **There is no Bun → Rust channel.** Rust proxies HTTP *to* Bun, not
//!    the other way around. Wiring a reverse channel would add process
//!    coupling for a cross-cutting concern.
//! 2. **It relies on every writer remembering.** Today it's one Sidecar;
//!    tomorrow it's the CLI, a migration, a crash recovery pass. Anything
//!    that forgets to notify silently orphans the index.
//!
//! Watching the filesystem makes the correct behavior the default: *any*
//! process that touches `~/.myagents/sessions/` flows through to the index
//! with zero coupling. Same "pit of success" pattern as `local_http` and
//! `process_cmd`.
//!
//! # Debouncing
//!
//! During an active conversation, each message append writes the JSONL.
//! A sliding 5-second debounce means we only reindex after the user has
//! been idle for 5 seconds — reindex cost scales with *conversations*,
//! not *messages*.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify_debouncer_full::{new_debouncer, notify::RecursiveMode, DebounceEventResult};

use crate::perf_trace::{elapsed_ms, emit_perf_trace, trace_start, PerfTrace, PerfTraceName};
use crate::utils::bom::strip_bom;
use crate::{ulog_error, ulog_info, ulog_warn};

use super::session_indexer::SessionIndex;

/// Sliding-window debounce: every new event resets the timer, and the batch
/// is flushed only after this much quiet time. 5s is a compromise between
/// "user expects search to reflect recent activity" and "don't thrash the
/// index during active typing".
const DEBOUNCE_WINDOW: Duration = Duration::from_secs(5);

/// Baseline snapshot of a session's sessions.json entry, used to detect
/// metadata-only changes (title edits, manual JSON edits) that wouldn't
/// otherwise fire a JSONL write event.
#[derive(Clone, Debug, PartialEq, Eq)]
struct SessionSnapshot {
    title: String,
    last_active_at: String,
    transcript_format: Option<serde_json::Value>,
    materialization_state: Option<serde_json::Value>,
}

/// Spawn the session index filesystem watcher on a dedicated background
/// thread. Runs for the lifetime of the process; the OS tears it down on
/// exit along with every other daemon thread.
///
/// MUST be called after the initial `index_all_sessions` pass so the
/// baseline snapshot matches the index's starting state. Otherwise the
/// very first debounce tick would treat every pre-existing session as
/// "changed" and trigger a second full reindex.
pub fn spawn_session_watcher(data_dir: PathBuf, session_index: Arc<SessionIndex>) {
    std::thread::Builder::new()
        .name("search-session-watcher".to_string())
        .spawn(move || {
            if let Err(e) = run_watcher(data_dir, session_index) {
                ulog_error!("[search] session watcher terminated: {}", e);
            }
        })
        .expect("failed to spawn session watcher thread");
}

fn run_watcher(data_dir: PathBuf, session_index: Arc<SessionIndex>) -> Result<(), String> {
    let sessions_dir = data_dir.join("sessions");
    let sessions_v2_dir = data_dir.join("sessions-v2");
    let sessions_file = data_dir.join("sessions.json");

    // Ensure the watched directories exist — notify backends return ENOENT
    // on a fresh install otherwise.
    std::fs::create_dir_all(&sessions_dir)
        .map_err(|e| format!("create sessions dir failed: {}", e))?;
    std::fs::create_dir_all(&sessions_v2_dir)
        .map_err(|e| format!("create sessions-v2 dir failed: {}", e))?;

    // Seed the baseline from sessions.json BEFORE starting the watcher so
    // the first tick's diff is against an accurate picture.
    let mut snapshot = read_snapshot(&sessions_file);

    let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();
    let mut debouncer = new_debouncer(DEBOUNCE_WINDOW, None, tx)
        .map_err(|e| format!("create debouncer failed: {}", e))?;

    // Watch per-session JSONL files.
    debouncer
        .watch(&sessions_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch sessions dir failed: {}", e))?;
    debouncer
        .watch(&sessions_v2_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch sessions-v2 dir failed: {}", e))?;

    // Watch sessions.json. Most platforms only allow watching directories,
    // so we watch the parent data_dir non-recursively and filter by path.
    debouncer
        .watch(&data_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch data dir failed: {}", e))?;

    ulog_info!(
        "[search] session watcher started (debounce={:?}, dir={:?})",
        DEBOUNCE_WINDOW,
        sessions_dir
    );

    // Block until the channel closes (debouncer dropped → happens on app
    // exit). We intentionally never break out of this loop ourselves.
    loop {
        session_index.prune_searches();
        let result = match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(result) => result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let events = match result {
            Ok(events) => events,
            Err(errors) => {
                for e in errors {
                    ulog_warn!("[search] watcher event error: {}", e);
                }
                continue;
            }
        };
        let trace_started = trace_start();

        // Partition paths into per-session deltas. Use a HashSet so repeated
        // events for the same session within one tick collapse to a single
        // reindex. Dedup is important — a message append can fire multiple
        // events (create+modify on some platforms).
        let mut changed: HashSet<String> = HashSet::new();
        let mut deleted: HashSet<String> = HashSet::new();
        let mut sessions_json_changed = false;

        for event in events {
            for path in &event.event.paths {
                // Match structurally rather than by absolute-path equality:
                // on macOS, notify may report APFS firmlink paths (e.g.
                // /System/Volumes/Data/Users/...) while we watched via
                // /Users/..., so `path.parent() == sessions_dir` would
                // silently miss every event.
                match classify_path(path) {
                    Classified::SessionFile(id) => {
                        if path.exists() {
                            changed.insert(id);
                        } else {
                            deleted.insert(id);
                        }
                    }
                    Classified::SessionsJson => {
                        sessions_json_changed = true;
                    }
                    Classified::Other => {}
                }
            }
        }

        // sessions.json diff catches title edits and metadata-only deletes
        // that don't touch any JSONL file. Always compare snapshots — a
        // missing/unreadable sessions.json produces an empty map, which
        // is the correct "everything gone" signal.
        if sessions_json_changed {
            let new_snapshot = read_snapshot(&sessions_file);
            for (id, meta) in &new_snapshot {
                match snapshot.get(id) {
                    Some(prev) if prev == meta => {}
                    _ => {
                        changed.insert(id.clone());
                    }
                }
            }
            for id in snapshot.keys() {
                if !new_snapshot.contains_key(id) {
                    deleted.insert(id.clone());
                }
            }
            snapshot = new_snapshot;
        }

        // Apply deletes first so a delete+readd sequence within one tick
        // (rare but possible: rename) doesn't leave a dangling delete
        // clobbering a fresh reindex.
        let deleted_count = deleted.len() as u64;
        let changed_count = changed.len() as u64;
        let mut error_count = 0u64;
        for id in deleted {
            // Rename/replace may report removal of the previous inode. The
            // final authority path wins over an intermediate remove event.
            if sessions_dir.join(format!("{id}.jsonl")).exists()
                || sessions_v2_dir.join(format!("{id}.jsonl")).exists()
            {
                changed.insert(id);
                continue;
            }
            changed.remove(&id);
            if let Err(e) = session_index.delete_session(&id) {
                error_count += 1;
                ulog_warn!("[search] delete_session({}) failed: {}", id, e);
            }
        }

        for id in changed {
            if let Err(e) = session_index.reindex_session(&id, &sessions_dir) {
                error_count += 1;
                ulog_warn!("[search] reindex_session({}) failed: {}", id, e);
            }
        }
        emit_perf_trace(
            PerfTrace::new(PerfTraceName::BackgroundJob, "search_watcher_batch")
                .duration_ms(elapsed_ms(trace_started))
                .count(changed_count + deleted_count)
                .status(if error_count == 0 { "ok" } else { "error" })
                .detail("changed", changed_count)
                .detail("deleted", deleted_count)
                .detail("errors", error_count),
        );
    }

    // The channel only closes when the debouncer is dropped. We explicitly
    // keep it alive for the entire loop above; this line is unreachable
    // under normal operation and just documents ownership.
    drop(debouncer);
    Ok(())
}

/// Result of classifying a path reported by the watcher. We only react to
/// two shapes; everything else is ignored (config.json, cron files, etc).
enum Classified {
    /// A per-session JSONL file: `.../sessions/<id>.jsonl`.
    SessionFile(String),
    /// The sessions metadata index: `.../sessions.json`.
    SessionsJson,
    /// Not our concern.
    Other,
}

/// Match a path by structure instead of absolute equality so platform
/// peculiarities (APFS firmlinks, symlink resolution, trailing slashes)
/// cannot cause silent misses.
fn classify_path(path: &Path) -> Classified {
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return Classified::Other,
    };

    // `.../sessions.json` — parent's file name is irrelevant, we only need
    // the file name to match exactly.
    if file_name == "sessions.json" {
        return Classified::SessionsJson;
    }

    // `.../sessions/<id>.jsonl` — must be directly under a directory
    // literally named `sessions`, and the id cannot be empty.
    if let Some(id) = file_name.strip_suffix(".jsonl") {
        if crate::session_transcript::is_valid_session_id(id)
            && matches!(
                path.parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str()),
                Some("sessions" | "sessions-v2")
            )
        {
            return Classified::SessionFile(id.to_string());
        }
    }

    Classified::Other
}

fn read_snapshot(sessions_file: &Path) -> HashMap<String, SessionSnapshot> {
    let content = match std::fs::read_to_string(sessions_file) {
        Ok(s) => s,
        Err(_) => return HashMap::new(),
    };
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(strip_bom(&content)) {
        Ok(v) => v,
        Err(_) => return HashMap::new(),
    };
    let mut out = HashMap::new();
    for session in parsed {
        let id = match session.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };
        let title = session
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let last_active_at = session
            .get("lastActiveAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        out.insert(
            id,
            SessionSnapshot {
                title,
                last_active_at,
                transcript_format: session.get("transcriptFormat").cloned(),
                materialization_state: session.get("materializationState").cloned(),
            },
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_both_formats_but_not_candidates_or_path_escapes() {
        for directory in ["sessions", "sessions-v2"] {
            assert!(
                matches!(classify_path(Path::new(&format!("/System/Volumes/Data/home/.myagents/{directory}/abc-123.jsonl"))), Classified::SessionFile(id) if id == "abc-123")
            );
        }
        for path in [
            "/data/sessions-v2/abc.jsonl.tmp",
            "/data/sessions-v2/.candidate.jsonl",
            "/data/sessions-v2/nested/abc.jsonl",
            "/data/other/abc.jsonl",
        ] {
            assert!(
                matches!(classify_path(Path::new(path)), Classified::Other),
                "{path}"
            );
        }
    }

    #[test]
    fn prepared_commit_and_format_changes_invalidate_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        std::fs::write(
            &path,
            r#"[{"id":"s","title":"x","transcriptFormat":2,"materializationState":"prepared"}]"#,
        )
        .unwrap();
        let prepared = read_snapshot(&path);
        std::fs::write(&path, r#"[{"id":"s","title":"x","transcriptFormat":2}]"#).unwrap();
        let committed = read_snapshot(&path);
        assert_ne!(prepared, committed);
        std::fs::write(&path, r#"[{"id":"s","title":"x","transcriptFormat":null}]"#).unwrap();
        assert_ne!(committed, read_snapshot(&path));
    }
}
