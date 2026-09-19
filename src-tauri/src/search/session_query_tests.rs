use super::*;
use serde_json::json;

fn fixture(bodies: &[&str]) -> (tempfile::TempDir, Arc<SessionIndex>, Vec<Value>) {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir_all(temp.path().join("sessions")).unwrap();
    let base = chrono::DateTime::parse_from_rfc3339("2026-09-01T00:00:00Z").unwrap();
    let metadata: Vec<_> = bodies
        .iter()
        .enumerate()
        .map(|(i, body)| {
            let id = format!("session-{i:04}");
            fs::write(
                temp.path().join("sessions").join(format!("{id}.jsonl")),
                format!(
                    "{}\n",
                    json!({"id": format!("m-{i}"), "role": "user", "content": body})
                ),
            )
            .unwrap();
            json!({"id": id, "title": "Conversation", "agentDir": "/workspace",
            "createdAt": base.to_rfc3339(),
            "lastActiveAt": (base + chrono::Duration::minutes(i as i64)).to_rfc3339(),
            "userTags": ["Alpha"], "providerEnvJson": "must-be-redacted"})
        })
        .collect();
    write_metadata(temp.path(), &metadata);
    let index =
        Arc::new(SessionIndex::new(temp.path().join("index"), temp.path().to_path_buf()).unwrap());
    index.index_all_sessions(temp.path()).unwrap();
    (temp, index, metadata)
}

fn write_metadata(dir: &Path, metadata: &[Value]) {
    fs::write(
        dir.join("sessions.json"),
        serde_json::to_vec(metadata).unwrap(),
    )
    .unwrap();
}

fn request(query: &str, generation: u64) -> SessionSearchRequest {
    SessionSearchRequest {
        consumer_id: "overlay".into(),
        generation,
        query: query.into(),
        tag: None,
        workspaces: vec!["/workspace".into()],
    }
}

fn page_request(result: &SessionSearchResult, generation: u64) -> SessionSearchPageRequest {
    SessionSearchPageRequest {
        consumer_id: "overlay".into(),
        generation,
        query_id: result.query_id.clone(),
        cursor: result.next_cursor.unwrap(),
    }
}

#[tokio::test]
async fn paginates_all_sessions_in_frozen_order_and_retries_the_same_cursor() {
    let (temp, index, mut metadata) = fixture(&vec!["needle"; 161]);
    let first = index
        .start_search("main", request("needle", 1))
        .await
        .unwrap();
    assert_eq!(first.hits.len(), 20);
    assert_eq!(first.total_count, 161);
    assert_eq!(first.hits[0].session_id, "session-0160");
    assert_eq!(first.hits[0].session["providerEnvJson"], "[redacted]");
    let next = page_request(&first, 1);
    metadata[140]["lastActiveAt"] = json!("2099-01-01T00:00:00Z");
    write_metadata(temp.path(), &metadata);
    let second = index.next_search_page("main", next.clone()).await.unwrap();
    let repeated = index.next_search_page("main", next).await.unwrap();
    assert_eq!(
        serde_json::to_value(&second.hits).unwrap(),
        serde_json::to_value(&repeated.hits).unwrap()
    );
    assert_eq!(second.hits[0].session_id, "session-0140");
    assert_eq!(second.hits[0].last_active_at, "2026-09-01T02:20:00+00:00");
    let mut ids: Vec<_> = first
        .hits
        .iter()
        .chain(&second.hits)
        .map(|h| h.session_id.clone())
        .collect();
    let mut current = second;
    while current.next_cursor.is_some() {
        current = index
            .next_search_page("main", page_request(&current, 1))
            .await
            .unwrap();
        assert!(current.hits.len() <= PAGE_SIZE);
        ids.extend(current.hits.iter().map(|h| h.session_id.clone()));
    }
    assert_eq!(
        ids,
        (0..161)
            .rev()
            .map(|i| format!("session-{i:04}"))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn applies_current_visibility_before_page_budget_and_drops_removed_sessions() {
    let (temp, index, mut metadata) = fixture(&vec!["needle"; 50]);
    metadata[49]["agentDir"] = json!("/removed");
    metadata[48]["userTags"] = json!(["Beta"]);
    metadata[47]["materializationState"] = json!("prepared");
    write_metadata(temp.path(), &metadata);
    let mut input = request("needle", 1);
    input.tag = Some("Alpha".into());
    let first = index.start_search("main", input).await.unwrap();
    assert_eq!(first.total_count, 47);
    assert_eq!(first.hits[0].session_id, "session-0046");
    metadata.retain(|m| m["id"] != "session-0026");
    write_metadata(temp.path(), &metadata);
    let second = index
        .next_search_page("main", page_request(&first, 1))
        .await
        .unwrap();
    assert_eq!(second.hits.len(), 20);
    assert_eq!(second.hits[0].session_id, "session-0025");
    assert_eq!(second.hits.last().unwrap().session_id, "session-0006");
    fs::write(temp.path().join("sessions.json"), "invalid json").unwrap();
    assert!(index
        .next_search_page("main", page_request(&second, 1))
        .await
        .unwrap_err()
        .contains("parse sessions.json"));
}

#[tokio::test]
async fn excluded_sessions_only_reenter_on_a_fresh_query() {
    let (temp, index, mut metadata) = fixture(&vec!["needle"; 50]);
    let mut input = request("needle", 1);
    input.tag = Some("Alpha".into());
    let first = index.start_search("main", input.clone()).await.unwrap();
    // One previously loaded row and one upcoming row lose eligibility.
    metadata[49]["userTags"] = json!([]);
    metadata[29]["userTags"] = json!([]);
    write_metadata(temp.path(), &metadata);
    let second = index
        .next_search_page("main", page_request(&first, 1))
        .await
        .unwrap();
    assert_eq!(second.total_count, 48);
    assert_eq!(second.removed_session_ids.len(), 2);
    metadata[49]["userTags"] = json!(["Alpha"]);
    metadata[29]["userTags"] = json!(["Alpha"]);
    write_metadata(temp.path(), &metadata);
    let last = index
        .next_search_page("main", page_request(&second, 1))
        .await
        .unwrap();
    assert_eq!(last.total_count, 48);
    assert_eq!(last.removed_session_ids.len(), 2);
    assert!(last.next_cursor.is_none());
    assert_eq!(
        first.hits.len() - 1 + second.hits.len() + last.hits.len(),
        48
    );
    input.generation = 2;
    assert_eq!(
        index.start_search("main", input).await.unwrap().total_count,
        50
    );
}

#[tokio::test]
async fn uses_current_metadata_dates_with_offsets_unknowns_and_stable_ties() {
    let (temp, index, mut metadata) = fixture(&vec!["needle"; 5]);
    metadata[0]["lastActiveAt"] = json!("2026-09-01T01:00:00+08:00");
    metadata[1]["lastActiveAt"] = json!("2026-08-31T18:00:00Z");
    metadata[2]["lastActiveAt"] = json!("2026-08-31T18:00:00Z");
    metadata[3].as_object_mut().unwrap().remove("lastActiveAt");
    metadata[4]["lastActiveAt"] = json!("broken");
    write_metadata(temp.path(), &metadata);
    let result = index
        .start_search("main", request("needle", 1))
        .await
        .unwrap();
    assert_eq!(
        result
            .hits
            .iter()
            .map(|h| h.session_id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "session-0001",
            "session-0002",
            "session-0000",
            "session-0003",
            "session-0004"
        ]
    );
    assert_eq!(result.hits[0].last_active_at, "2026-08-31T18:00:00Z");
}

#[tokio::test]
async fn requires_combined_terms_and_preserves_explicit_or_chinese_and_phrases() {
    let (_temp, index, _) = fixture(&[
        "alpha beta",
        "alpha",
        "beta",
        "微信连接失败",
        "微信消息正常",
        "连接失败",
    ]);
    for (generation, query, expected) in [
        (1, "alpha beta", 1),
        (2, "alpha OR beta", 3),
        (3, "\"alpha beta\"", 1),
        (4, "微信 连接失败", 1),
        (5, "微信 OR 连接失败", 3),
    ] {
        let result = index
            .start_search("main", request(query, generation))
            .await
            .unwrap();
        assert_eq!(result.total_count, expected, "{query}");
        assert!(
            result.hits.iter().any(|h| !h.snippet_highlights.is_empty()),
            "{query}"
        );
    }
}

#[tokio::test]
async fn late_close_cannot_cancel_new_search_and_close_before_start_cannot_resurrect() {
    let (_temp, index, _) = fixture(&["needle"]);
    index.close_search("main", "overlay", 1);
    assert!(index
        .start_search("main", request("needle", 1))
        .await
        .unwrap_err()
        .contains(CANCELLED));
    let result = index
        .start_search("main", request("needle", 2))
        .await
        .unwrap();
    index.close_search("main", "overlay", 1);
    let page = SessionSearchPageRequest {
        consumer_id: "overlay".into(),
        generation: 2,
        query_id: result.query_id,
        cursor: 0,
    };
    assert_eq!(
        index
            .next_search_page("main", page.clone())
            .await
            .unwrap()
            .hits
            .len(),
        1
    );
    index.close_search("main", "overlay", 2);
    assert!(index.next_search_page("main", page).await.is_err());
    let state = index.state.read().unwrap();
    assert!(state.as_ref().unwrap().searches.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cancelled_queued_query_leaves_without_waiting_for_the_running_job() {
    let (_temp, index, _) = fixture(&["needle"]);
    let permit = index.queries.gate.clone().acquire_owned().await.unwrap();
    let worker_index = index.clone();
    let queued = tauri::async_runtime::spawn(async move {
        worker_index
            .start_search("main", request("needle", 1))
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !index
            .queries
            .intents
            .lock()
            .unwrap()
            .contains_key("main\0overlay")
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    index.close_search("main", "overlay", 1);
    assert!(tokio::time::timeout(Duration::from_secs(2), queued)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err()
        .contains(CANCELLED));
    drop(permit);
}

#[tokio::test]
async fn expiry_and_index_recovery_release_snapshot_readers() {
    let (_temp, index, _) = fixture(&["needle"]);
    let first = index
        .start_search("main", request("needle", 1))
        .await
        .unwrap();
    let weak = {
        let state = index.state.read().unwrap();
        let snapshots = state.as_ref().unwrap().searches.lock().unwrap();
        let snapshot = snapshots.get("main\0overlay").unwrap();
        let weak = Arc::downgrade(snapshot);
        *snapshot.touched.lock().unwrap() = Instant::now() - IDLE_TTL;
        weak
    };
    index.prune_searches();
    assert!(weak.upgrade().is_none());
    let second = index
        .start_search("main", request("needle", 2))
        .await
        .unwrap();
    let weak = {
        let state = index.state.read().unwrap();
        let snapshots = state.as_ref().unwrap().searches.lock().unwrap();
        Arc::downgrade(snapshots.get("main\0overlay").unwrap())
    };
    let attempts = std::sync::atomic::AtomicUsize::new(0);
    index
        .with_recovery("test recovery", |_| {
            if attempts.fetch_add(1, Ordering::Relaxed) < 2 {
                Err(INDEX_RECOVERY_REQUIRED.to_string())
            } else {
                Ok(())
            }
        })
        .unwrap();
    assert!(weak.upgrade().is_none());
    let page = SessionSearchPageRequest {
        consumer_id: "overlay".into(),
        generation: 2,
        query_id: second.query_id,
        cursor: 0,
    };
    assert!(index
        .next_search_page("main", page)
        .await
        .unwrap_err()
        .contains(EXPIRED));
    assert_ne!(
        first.query_id,
        index
            .start_search("main", request("needle", 3))
            .await
            .unwrap()
            .query_id
    );
}

#[test]
fn session_schema_upgrade_preserves_file_schema_version() {
    assert_eq!(super::super::super::schema::SCHEMA_VERSION, 3);
    let (temp, index, _) = fixture(&["needle"]);
    drop(index);
    fs::write(temp.path().join("index/.schema_version"), "3").unwrap();
    let reopened = SessionIndex::new(temp.path().join("index"), temp.path().to_path_buf()).unwrap();
    reopened.index_all_sessions(temp.path()).unwrap();
    assert_eq!(reopened.search("needle", 20).unwrap().total_count, 1);
    assert_eq!(
        fs::read_to_string(temp.path().join("index/.schema_version")).unwrap(),
        "4"
    );
}

/// Explicit, local-only benchmark of the production collector, metadata IO,
/// snapshot and page path. Run with --ignored --nocapture in a release build.
#[tokio::test]
#[ignore = "synthetic performance fixture; run explicitly"]
async fn benchmark_production_session_paging() {
    for count in [1_000, 10_000] {
        let (temp, index, metadata) = fixture(&vec!["common 微信连接失败"; count]);
        index
            .with_recovery("benchmark fixture", |state| {
                let mut writer = state.writer.lock().unwrap();
                for (i, session) in metadata.iter().enumerate() {
                    // The newest page includes a long conversation; every 250th
                    // Session also matches a sparse query.
                    for message in 0..if i + 1 == count { 20_000 } else { 100 } {
                        let content = format!(
                            "common 微信连接失败 conversation {i} message {message} {} {}",
                            if i % 250 == 0 { "sparse" } else { "ordinary" },
                            "Review the implementation and explain the current state. ".repeat(6)
                        );
                        writer
                            .add_document(
                                doc!(state.fields.session_id => session["id"].as_str().unwrap(),
                        state.fields.message_id => format!("m-{i}-{message}"),
                        state.fields.role => "user", state.fields.content => content),
                            )
                            .unwrap();
                    }
                }
                writer.commit().unwrap();
                state.reader.reload().unwrap();
                eprintln!(
                    "benchmark sessions={count} documents={} segments={}",
                    state.reader.searcher().num_docs(),
                    state.reader.searcher().segment_readers().len()
                );
                Ok(())
            })
            .unwrap();
        let mut generation = 0;
        for query in ["common", "sparse", "微信 连接失败"] {
            let mut first_times = Vec::new();
            let mut page_times = Vec::new();
            for _ in 0..12 {
                generation += 1;
                let start = Instant::now();
                let first = index
                    .start_search("bench", request(query, generation))
                    .await
                    .unwrap();
                first_times.push(start.elapsed().as_secs_f64() * 1000.0);
                assert_eq!(
                    first.total_count,
                    if query == "sparse" {
                        count / 250
                    } else {
                        count
                    }
                );
                assert_eq!(first.hits.len(), first.total_count.min(20));
                if first.next_cursor.is_some() {
                    let start = Instant::now();
                    let next = index
                        .next_search_page("bench", page_request(&first, generation))
                        .await
                        .unwrap();
                    page_times.push(start.elapsed().as_secs_f64() * 1000.0);
                    assert_eq!(next.hits.len(), 20);
                }
                index.close_search("bench", "overlay", generation);
            }
            first_times.sort_by(f64::total_cmp);
            page_times.sort_by(f64::total_cmp);
            eprintln!("benchmark sessions={count} query={query:?} first_ms_median={:.2} first_ms_max={:.2} page_ms_median={:?} page_ms_max={:?}",
                first_times[6], first_times[11], page_times.get(page_times.len()/2), page_times.last());
        }
        drop(index);
        drop(temp);
    }
}
