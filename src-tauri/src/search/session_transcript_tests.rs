use super::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Opt-in, synthetic data only: each input directory contains sessions.json,
/// sessions/ and sessions-v2/ with one 10 or 100 MiB conversation named bench.
#[test]
#[ignore = "Requires MYAGENTS_TRANSCRIPT_INDEX_BENCH_DIR synthetic v1/v2 fixtures"]
fn benchmark_v1_v2_indexing() {
    let root = std::env::var("MYAGENTS_TRANSCRIPT_INDEX_BENCH_DIR")
        .expect("synthetic fixture directory required");
    for mib in [10, 100] {
        for version in [1, 2] {
            let data = Path::new(&root).join(format!("v{version}-{mib}"));
            let sessions = data.join("sessions");
            let mut full_ms = Vec::new();
            let mut unchanged_ms = Vec::new();
            for _ in 0..3 {
                let temp = tempfile::tempdir().unwrap();
                let index = SessionIndex::new(temp.path().join("index"), data.clone()).unwrap();
                let start = std::time::Instant::now();
                index.index_all_sessions(&data).unwrap();
                full_ms.push(start.elapsed().as_secs_f64() * 1000.0);
                let result = index.search("recovery", 10).unwrap();
                assert_eq!(result.total_count, 1);
                assert_eq!(result.hits[0].session_id, "bench");
                let start = std::time::Instant::now();
                index.reindex_session("bench", &sessions).unwrap();
                unchanged_ms.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            eprintln!("Session index V{version} {mib} MiB: full_ms={full_ms:?}, unchanged_ms={unchanged_ms:?}");
        }
    }
}

fn batch(revision: u64, operations: Value) -> String {
    let body = json!({"id":format!("batch-{revision}"),"mode":"delta","fromRevision":revision,"revision":revision,"operations":operations}).to_string();
    format!(
        "{{\"batch\":{body},\"checksum\":\"{:x}\"}}\n",
        Sha256::digest(body.as_bytes())
    )
}

fn initial(id: &str, generation: &str, content: &str) -> String {
    let header = json!({"kind":"session-transcript","version":2,"sessionId":id,"generation":generation,"baseRevision":0,"baseline":false});
    format!(
        "{header}\n{}",
        batch(
            1,
            json!([
                {"kind":"message-create","message":{"id":"1","role":"assistant","timestamp":"2026-09-12T00:00:00Z","content":[{"id":"text","type":"text","text":content}]}}
            ])
        )
    )
}

fn setup() -> (tempfile::TempDir, SessionIndex, Vec<Value>) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sessions")).unwrap();
    fs::create_dir(dir.path().join("sessions-v2")).unwrap();
    let metadata = vec![
        json!({"id":"first","transcriptFormat":2,"title":"firsttitle","agentDir":"/workspace","lastActiveAt":"2026-09-12T00:00:00Z"}),
        json!({"id":"second","transcriptFormat":2,"title":"secondtitle","agentDir":"/workspace","lastActiveAt":"2026-09-12T00:00:00Z"}),
    ];
    fs::write(
        dir.path().join("sessions.json"),
        serde_json::to_vec(&metadata).unwrap(),
    )
    .unwrap();
    fs::write(
        dir.path().join("sessions-v2/first.jsonl"),
        initial("first", "g1", "originalunique"),
    )
    .unwrap();
    fs::write(
        dir.path().join("sessions-v2/second.jsonl"),
        initial("second", "g1", "originalunique"),
    )
    .unwrap();
    let index = SessionIndex::new(dir.path().join("index"), dir.path().to_path_buf()).unwrap();
    index.index_all_sessions(dir.path()).unwrap();
    (dir, index, metadata)
}

#[test]
fn v2_updates_original_message_without_deleting_other_session_and_removes_old_title() {
    let (dir, index, mut metadata) = setup();
    let sessions = dir.path().join("sessions");
    let path = dir.path().join("sessions-v2/first.jsonl");
    let mut wire = fs::read_to_string(&path).unwrap();
    wire.push_str(&batch(2, json!([{"kind":"text-append","messageId":"1","blockId":"text","field":"text","offset":14,"text":" appendedunique"}])));
    fs::write(&path, &wire).unwrap();
    index.reindex_session("first", &sessions).unwrap();
    assert_eq!(
        index.search("appendedunique", 10).unwrap().hits[0].session_id,
        "first"
    );
    assert_eq!(index.search("originalunique", 10).unwrap().total_count, 2);
    wire.push_str(&batch(3, json!([{"kind":"content-confirm","messageId":"1","content":[{"id":"text","type":"text","text":"confirmedunique"}]}])));
    fs::write(&path, &wire).unwrap();
    index.reindex_session("first", &sessions).unwrap();
    assert_eq!(index.search("appendedunique", 10).unwrap().total_count, 0);
    let original = index.search("originalunique", 10).unwrap();
    assert_eq!(original.total_count, 1);
    assert_eq!(original.hits[0].session_id, "second");
    assert_eq!(index.search("confirmedunique", 10).unwrap().total_count, 1);
    metadata[0]["title"] = json!("renamedtitleunique");
    fs::write(
        dir.path().join("sessions.json"),
        serde_json::to_vec(&metadata).unwrap(),
    )
    .unwrap();
    index.reindex_session("first", &sessions).unwrap();
    assert_eq!(index.search("firsttitle", 10).unwrap().total_count, 0);
    assert_eq!(
        index.search("renamedtitleunique", 10).unwrap().total_count,
        1
    );
    wire.push_str(&batch(
        4,
        json!([{"kind":"messages-remove","messageIds":["1"]}]),
    ));
    fs::write(&path, &wire).unwrap();
    index.reindex_session("first", &sessions).unwrap();
    assert_eq!(index.search("confirmedunique", 10).unwrap().total_count, 0);
    assert_eq!(
        index.search("originalunique", 10).unwrap().hits[0].session_id,
        "second"
    );
}

#[test]
fn v2_repaired_tail_and_larger_or_same_size_generation_replacement_rebuild() {
    let (dir, index, _) = setup();
    let sessions = dir.path().join("sessions");
    let path = dir.path().join("sessions-v2/first.jsonl");
    let prefix = fs::read_to_string(&path).unwrap();
    let delta = batch(
        2,
        json!([{"kind":"text-append","messageId":"1","blockId":"text","field":"text","offset":14,"text":" repairedunique"}]),
    );
    fs::write(&path, format!("{}{}", prefix, &delta[..delta.len() - 4])).unwrap();
    index.reindex_session("first", &sessions).unwrap();
    assert_eq!(index.search("repairedunique", 10).unwrap().total_count, 0);
    fs::write(&path, format!("{prefix}{delta}")).unwrap();
    index.reindex_session("first", &sessions).unwrap();
    assert_eq!(index.search("repairedunique", 10).unwrap().total_count, 1);
    let longer = initial("first", "g2", &"replacementunique ".repeat(80));
    fs::write(&path, &longer).unwrap();
    index.reindex_session("first", &sessions).unwrap();
    assert_eq!(index.search("repairedunique", 10).unwrap().total_count, 0);
    assert_eq!(
        index.search("replacementunique", 10).unwrap().total_count,
        1
    );
    // Identical length, entirely different generation and searchable content.
    let same_size = initial("first", "g3", &"samecontentunique ".repeat(80));
    assert_eq!(same_size.len(), longer.len());
    fs::write(&path, same_size).unwrap();
    index.reindex_session("first", &sessions).unwrap();
    assert_eq!(
        index.search("replacementunique", 10).unwrap().total_count,
        0
    );
    assert_eq!(
        index.search("samecontentunique", 10).unwrap().total_count,
        1
    );
}

#[test]
fn v2_startup_reconciles_offline_changes_and_invalid_files_never_use_legacy() {
    let (dir, index, _) = setup();
    let path = dir.path().join("sessions-v2/first.jsonl");
    drop(index);
    fs::write(&path, initial("first", "g2", "offlineunique")).unwrap();
    let index = SessionIndex::new(dir.path().join("index"), dir.path().to_path_buf()).unwrap();
    index.index_all_sessions(dir.path()).unwrap();
    assert_eq!(index.search("offlineunique", 10).unwrap().total_count, 1);
    fs::write(&path, "invalid header\n").unwrap();
    assert!(index
        .reindex_session("first", &dir.path().join("sessions"))
        .is_err());
    assert_eq!(index.search("offlineunique", 10).unwrap().total_count, 0);
    fs::write(&path, initial("first", "g3", "versionedunique")).unwrap();
    fs::write(
        dir.path().join("sessions/first.jsonl"),
        "{\"id\":\"1\",\"role\":\"user\",\"content\":\"legacyunique\"}\n",
    )
    .unwrap();
    assert!(index
        .reindex_session("first", &dir.path().join("sessions"))
        .is_err());
    assert_eq!(index.search("legacyunique", 10).unwrap().total_count, 0);
    assert_eq!(index.search("versionedunique", 10).unwrap().total_count, 0);
}
