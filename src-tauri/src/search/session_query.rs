//! Query-lifetime Session aggregation and paging. This module is a child of
//! session_indexer so every retained reader is dropped by the same recovery owner.

use super::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use tantivy::collector::{Collector, SegmentCollector};
use tantivy::columnar::StrColumn;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermSetQuery, Weight};
use tantivy::{DocAddress, DocId, Score, Searcher, SegmentOrdinal, SegmentReader, TERMINATED};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

use super::super::searcher::{SessionSearchPageRequest, SessionSearchRequest};

pub(super) const PAGE_SIZE: usize = 20;
const IDLE_TTL: Duration = Duration::from_secs(600);
const CANCELLED: &str = "[search-cancelled]";
const EXPIRED: &str = "[search-expired]";

#[derive(Default)]
pub(super) struct Cancellation {
    cancelled: AtomicBool,
    changed: Notify,
}

impl Cancellation {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.changed.notify_waiters();
    }

    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(CANCELLED.to_string())
        } else {
            Ok(())
        }
    }

    async fn acquire(&self, gate: Arc<Semaphore>) -> Result<OwnedSemaphorePermit, String> {
        // Register before checking the flag so a superseding input cannot be
        // lost between checking and waiting for the blocking-work permit.
        let notified = self.changed.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        self.check()?;
        tokio::select! {
            result = gate.acquire_owned() => {
                let permit = result.map_err(|_| CANCELLED.to_string())?;
                self.check()?;
                Ok(permit)
            }
            _ = notified => Err(CANCELLED.to_string()),
        }
    }
}

struct Intent {
    generation: u64,
    cancellation: Arc<Cancellation>,
    touched: Instant,
}

pub(super) struct QueryControl {
    intents: StdMutex<HashMap<String, Intent>>,
    gate: Arc<Semaphore>,
}

impl Default for QueryControl {
    fn default() -> Self {
        Self {
            intents: StdMutex::new(HashMap::new()),
            gate: Arc::new(Semaphore::new(1)),
        }
    }
}

impl QueryControl {
    fn begin(&self, key: &str, generation: u64) -> Result<Arc<Cancellation>, String> {
        let mut intents = self.intents.lock().map_err(|e| e.to_string())?;
        if let Some(old) = intents.get(key) {
            if generation <= old.generation {
                return Err(CANCELLED.to_string());
            }
            old.cancellation.cancel();
        }
        let cancellation = Arc::new(Cancellation::default());
        intents.insert(
            key.to_string(),
            Intent {
                generation,
                cancellation: cancellation.clone(),
                touched: Instant::now(),
            },
        );
        Ok(cancellation)
    }

    fn current(&self, key: &str, generation: u64) -> Result<Arc<Cancellation>, String> {
        let mut intents = self.intents.lock().map_err(|e| e.to_string())?;
        let intent = intents
            .get_mut(key)
            .filter(|i| i.generation == generation)
            .ok_or_else(|| EXPIRED.to_string())?;
        intent.cancellation.check()?;
        intent.touched = Instant::now();
        Ok(intent.cancellation.clone())
    }

    fn close(&self, key: &str, generation: u64) {
        if let Ok(mut intents) = self.intents.lock() {
            if intents.get(key).is_some_and(|i| i.generation > generation) {
                return;
            }
            if let Some(old) = intents.get(key) {
                old.cancellation.cancel();
            }
            // Preserve the last intent even if close arrives before start.
            // A late invocation of that generation must not resurrect a reader.
            let cancellation = Arc::new(Cancellation::default());
            cancellation.cancel();
            intents.insert(
                key.to_string(),
                Intent {
                    generation,
                    cancellation,
                    touched: Instant::now(),
                },
            );
        }
    }
}

pub(super) struct SearchSnapshot {
    query_id: String,
    generation: u64,
    text_query: Box<dyn Query>,
    highlight_terms: Vec<String>,
    tag: Option<String>,
    workspaces: Option<Vec<String>>,
    searcher: Searcher,
    sessions: Vec<SearchCandidate>,
    cancellation: Arc<Cancellation>,
    touched: StdMutex<Instant>,
}

struct SearchCandidate {
    id: String,
    last_active_at: String,
    excluded: AtomicBool,
}

fn consumer_key(window: &str, consumer: &str) -> Result<String, String> {
    if consumer.is_empty() || consumer.len() > 128 || consumer.contains('\0') {
        return Err("Invalid search consumer".to_string());
    }
    Ok(format!("{window}\0{consumer}"))
}

impl SessionIndex {
    pub async fn start_search(
        self: &Arc<Self>,
        window: &str,
        request: SessionSearchRequest,
    ) -> Result<SessionSearchResult, String> {
        let key = consumer_key(window, &request.consumer_id)?;
        if request.query.trim().is_empty() || request.query.len() > 4096 {
            return Err("Enter a search query of at most 4096 bytes".to_string());
        }
        let cancellation = self.queries.begin(&key, request.generation)?;
        self.prune_searches();
        let permit = cancellation.acquire(self.queries.gate.clone()).await?;
        let index = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            cancellation.check()?;
            index.with_recovery("session search", |state| {
                let start = Instant::now();
                let snapshot = Arc::new(state.prepare_search(
                    &request.query,
                    &index.data_dir,
                    request.tag.as_deref(),
                    Some(&request.workspaces),
                    request.generation,
                    cancellation.clone(),
                )?);
                let mut result =
                    state.read_search_page(&snapshot, &index.data_dir, 0, PAGE_SIZE)?;
                let mut snapshots = state.searches.lock().map_err(|e| e.to_string())?;
                cancellation.check()?;
                snapshots.insert(key.clone(), snapshot);
                result.query_time_ms = start.elapsed().as_secs_f64() * 1000.0;
                Ok(result)
            })
        })
        .await
        .map_err(|e| format!("Session search task failed: {e}"))?
    }

    pub async fn next_search_page(
        self: &Arc<Self>,
        window: &str,
        request: SessionSearchPageRequest,
    ) -> Result<SessionSearchResult, String> {
        let key = consumer_key(window, &request.consumer_id)?;
        let cancellation = self.queries.current(&key, request.generation)?;
        let permit = cancellation.acquire(self.queries.gate.clone()).await?;
        let index = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            cancellation.check()?;
            index.with_recovery("session search page", |state| {
                let snapshot = {
                    let mut snapshots = state.searches.lock().map_err(|e| e.to_string())?;
                    snapshots.retain(|_, s| !s.is_expired());
                    snapshots
                        .get(&key)
                        .filter(|s| {
                            s.query_id == request.query_id && s.generation == request.generation
                        })
                        .cloned()
                        .ok_or_else(|| EXPIRED.to_string())?
                };
                *snapshot.touched.lock().map_err(|e| e.to_string())? = Instant::now();
                state.read_search_page(&snapshot, &index.data_dir, request.cursor, PAGE_SIZE)
            })
        })
        .await
        .map_err(|e| format!("Session search page task failed: {e}"))?
    }

    pub fn close_search(&self, window: &str, consumer: &str, generation: u64) {
        let Ok(key) = consumer_key(window, consumer) else {
            return;
        };
        self.queries.close(&key, generation);
        // Never wait for corruption recovery / disk IO on a command thread.
        // A replacement drops all snapshots; the periodic sweep handles contention.
        if let Ok(state) = self.state.try_read() {
            if let Some(state) = state.as_ref() {
                if let Ok(mut snapshots) = state.searches.lock() {
                    if snapshots
                        .get(&key)
                        .is_some_and(|s| s.generation <= generation)
                    {
                        snapshots.remove(&key);
                    }
                }
            }
        }
    }

    pub fn close_window_searches(&self, window: &str) {
        let prefix = format!("{window}\0");
        if let Ok(mut intents) = self.queries.intents.lock() {
            intents.retain(|key, intent| {
                if key.starts_with(&prefix) {
                    intent.cancellation.cancel();
                    false
                } else {
                    true
                }
            });
        }
        self.prune_searches();
    }

    pub fn prune_searches(&self) {
        if let Ok(mut intents) = self.queries.intents.lock() {
            intents.retain(|_, intent| {
                if intent.touched.elapsed() >= IDLE_TTL {
                    intent.cancellation.cancel();
                    false
                } else {
                    true
                }
            });
        }
        if let Ok(state) = self.state.try_read() {
            if let Some(state) = state.as_ref() {
                if let Ok(mut snapshots) = state.searches.lock() {
                    snapshots.retain(|_, s| !s.is_expired());
                }
            }
        }
    }
}

impl SearchSnapshot {
    fn is_expired(&self) -> bool {
        self.cancellation.check().is_err()
            || self
                .touched
                .lock()
                .map_or(true, |time| time.elapsed() >= IDLE_TTL)
    }
}

fn metadata_text<'a>(session: &'a Value, field: &str) -> &'a str {
    session.get(field).and_then(Value::as_str).unwrap_or("")
}

fn read_eligible_metadata(
    data_dir: &Path,
    tag: Option<&str>,
    workspaces: Option<&[String]>,
) -> Result<HashMap<String, Value>, String> {
    if tag.is_some_and(|t| crate::session_tags::normalize_session_user_tag(t).is_none()) {
        return Err("Invalid Session Tag filter.".to_string());
    }
    let path = data_dir.join("sessions.json");
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(e) => return Err(format!("Failed to read sessions.json for search: {e}")),
    };
    let sessions: Vec<Value> = serde_json::from_str(strip_bom(&content))
        .map_err(|e| format!("Failed to parse sessions.json for search: {e}"))?;
    let scope: Option<HashSet<String>> = workspaces.map(|paths| {
        paths
            .iter()
            .map(|p| crate::cron_task::normalize_path(p))
            .collect()
    });
    let sessions_dir = data_dir.join("sessions");
    Ok(sessions
        .into_iter()
        .filter(|s| {
            crate::session_visibility::is_history_visible_session(s, &sessions_dir)
                && tag.map_or(true, |t| crate::session_tags::session_has_user_tag(s, t))
                && scope.as_ref().map_or(true, |paths| {
                    paths.contains(&crate::cron_task::normalize_path(metadata_text(
                        s, "agentDir",
                    )))
                })
        })
        .filter_map(crate::session_metadata::redact_session_metadata)
        .filter_map(|s| {
            let id = metadata_text(&s, "id").to_string();
            (!id.is_empty()).then_some((id, s))
        })
        .collect())
}

impl SessionIndexState {
    fn prepare_search(
        &self,
        query_text: &str,
        data_dir: &Path,
        tag: Option<&str>,
        workspaces: Option<&[String]>,
        generation: u64,
        cancellation: Arc<Cancellation>,
    ) -> Result<SearchSnapshot, String> {
        cancellation.check()?;
        let metadata = read_eligible_metadata(data_dir, tag, workspaces)?;
        cancellation.check()?;
        let searcher = self.reader.searcher();
        let mut parser =
            QueryParser::for_index(&self.index, vec![self.fields.title, self.fields.content]);
        parser.set_field_boost(self.fields.title, 3.0);
        parser.set_conjunction_by_default();
        let text_query = parser
            .parse_query(query_text)
            .map_err(|e| format!("Query parse error: {e}"))?;
        let mut highlight_terms = HashSet::new();
        text_query.query_terms(&mut |term, _| {
            if term.field() == self.fields.title || term.field() == self.fields.content {
                if let Some(text) = term.value().as_str() {
                    if !text.is_empty() {
                        highlight_terms.insert(text.to_string());
                    }
                }
            }
        });
        let mut highlight_terms: Vec<_> = highlight_terms.into_iter().collect();
        highlight_terms.sort_by_key(|term| (std::cmp::Reverse(term.len()), term.clone()));
        let eligible_terms = metadata
            .keys()
            .map(|id| Term::from_field_text(self.fields.session_id, id));
        let query: Box<dyn Query> = Box::new(BooleanQuery::new(vec![
            (Occur::Must, text_query.box_clone()),
            (Occur::Must, Box::new(TermSetQuery::new(eligible_terms))),
        ]));
        let matches = searcher
            .search(
                &query,
                &SessionCollector {
                    scoring: false,
                    cancellation: cancellation.clone(),
                },
            )
            .map_err(|e| tantivy_error("Session aggregation failed", e))?;
        cancellation.check()?;
        let mut sessions: Vec<_> = metadata
            .into_iter()
            .filter_map(|(id, s)| {
                matches.contains_key(&id).then(|| SearchCandidate {
                    id,
                    last_active_at: metadata_text(&s, "lastActiveAt").to_string(),
                    excluded: AtomicBool::new(false),
                })
            })
            .collect();
        // Parse once per Session, never inside the O(N log N) comparator.
        sessions.sort_by_cached_key(|s| {
            (
                std::cmp::Reverse(
                    chrono::DateTime::parse_from_rfc3339(&s.last_active_at)
                        .ok()
                        .map(|time| time.timestamp_millis()),
                ),
                s.id.clone(),
            )
        });
        cancellation.check()?;
        Ok(SearchSnapshot {
            query_id: uuid::Uuid::new_v4().to_string(),
            generation,
            text_query,
            highlight_terms,
            tag: tag.map(str::to_string),
            workspaces: workspaces.map(<[String]>::to_vec),
            searcher,
            sessions,
            cancellation,
            touched: StdMutex::new(Instant::now()),
        })
    }

    fn read_search_page(
        &self,
        snapshot: &SearchSnapshot,
        data_dir: &Path,
        cursor: usize,
        limit: usize,
    ) -> Result<SessionSearchResult, String> {
        let start = Instant::now();
        snapshot.cancellation.check()?;
        if cursor > snapshot.sessions.len() {
            return Err("Invalid search cursor".to_string());
        }
        // Current visibility can shrink a frozen candidate set, but cannot add
        // new Sessions or replace its ordering dates during paging.
        let current = read_eligible_metadata(
            data_dir,
            snapshot.tag.as_deref(),
            snapshot.workspaces.as_deref(),
        )?;
        let removed_session_ids: Vec<_> = snapshot
            .sessions
            .iter()
            .filter(|s| {
                // A forward-only cursor cannot reinsert a Session it already
                // skipped. Eligibility restoration belongs to the next query.
                if !current.contains_key(&s.id) {
                    s.excluded.store(true, Ordering::Relaxed);
                }
                s.excluded.load(Ordering::Relaxed)
            })
            .map(|s| s.id.clone())
            .collect();
        let mut end = cursor;
        let mut page = Vec::new();
        while end < snapshot.sessions.len() && page.len() < limit {
            let session = &snapshot.sessions[end];
            end += 1;
            if session.excluded.load(Ordering::Relaxed) {
                continue;
            }
            if let Some(metadata) = current.get(&session.id) {
                page.push((session, metadata));
            }
        }
        let terms = page
            .iter()
            .map(|(s, _)| Term::from_field_text(self.fields.session_id, &s.id));
        // Initial admission is already frozen in `sessions`; retaining its
        // archive-wide TermSet here would eagerly scan all eligible postings on
        // every page before intersection. Only text + these page IDs is needed.
        let query = BooleanQuery::new(vec![
            (Occur::Must, snapshot.text_query.box_clone()),
            (Occur::Must, Box::new(TermSetQuery::new(terms))),
        ]);
        let representatives = snapshot
            .searcher
            .search(
                &query,
                &SessionCollector {
                    scoring: true,
                    cancellation: snapshot.cancellation.clone(),
                },
            )
            .map_err(|e| tantivy_error("Session page failed", e))?;
        let mut hits = Vec::with_capacity(page.len());
        for (candidate, session) in page {
            snapshot.cancellation.check()?;
            let id = metadata_text(session, "id");
            let (score, address) = representatives
                .get(id)
                .ok_or_else(|| "Missing representative in search snapshot".to_string())?;
            let doc = snapshot
                .searcher
                .doc::<tantivy::TantivyDocument>(*address)
                .map_err(|e| tantivy_error("Doc retrieval error", e))?;
            let role = get_text_field(&doc, self.fields.role);
            let title = metadata_text(session, "title").to_string();
            let content = get_text_field(&doc, self.fields.content);
            let content_lower = content.to_lowercase();
            let anchor = snapshot
                .highlight_terms
                .iter()
                .find(|term| content_lower.contains(term.as_str()));
            let snippet = if role == "title" {
                None
            } else {
                anchor.and_then(|term| build_snippet(&content, term, 160).0)
            };
            let snippet_highlights = snippet.as_ref().map_or_else(Vec::new, |text| {
                highlight_matches(text, &snapshot.highlight_terms)
            });
            hits.push(SessionSearchHit {
                session_id: id.to_string(),
                title: title.clone(),
                agent_dir: metadata_text(session, "agentDir").to_string(),
                score: *score,
                match_type: if role == "title" { "title" } else { "content" }.to_string(),
                snippet,
                snippet_highlights,
                title_highlights: highlight_matches(&title, &snapshot.highlight_terms),
                matched_role: (role != "title").then_some(role),
                last_active_at: candidate.last_active_at.clone(),
                source: session
                    .get("source")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                turn_count: session
                    .pointer("/stats/turnCount")
                    .and_then(Value::as_u64)
                    .map(|n| n as u32),
                session: session.clone(),
            });
        }
        snapshot.cancellation.check()?;
        Ok(SessionSearchResult {
            query_id: snapshot.query_id.clone(),
            next_cursor: (end < snapshot.sessions.len()).then_some(end),
            total_count: snapshot.sessions.len() - removed_session_ids.len(),
            removed_session_ids,
            hits,
            query_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        })
    }

    #[cfg(test)]
    pub(super) fn search(
        &self,
        query: &str,
        limit: usize,
        data_dir: &Path,
        tag: Option<&str>,
    ) -> Result<SessionSearchResult, String> {
        let snapshot = self.prepare_search(
            query,
            data_dir,
            tag,
            None,
            1,
            Arc::new(Cancellation::default()),
        )?;
        self.read_search_page(&snapshot, data_dir, 0, limit)
    }
}

fn highlight_matches(text: &str, terms: &[String]) -> Vec<[usize; 2]> {
    let mut ranges: Vec<_> = terms
        .iter()
        .flat_map(|term| find_highlights(text, term))
        .collect();
    ranges.sort_unstable();
    let mut merged: Vec<[usize; 2]> = Vec::new();
    for range in ranges {
        if let Some(last) = merged.last_mut() {
            if range[0] <= last[1] {
                last[1] = last[1].max(range[1]);
                continue;
            }
        }
        merged.push(range);
    }
    merged
}

type Representatives = HashMap<String, (Score, DocAddress)>;
struct SessionCollector {
    scoring: bool,
    cancellation: Arc<Cancellation>,
}
struct SessionSegmentCollector {
    ids: StrColumn,
    segment: SegmentOrdinal,
    winners: Vec<Option<(Score, DocId)>>,
    matched: Vec<usize>,
}

impl Collector for SessionCollector {
    type Fruit = Representatives;
    type Child = SessionSegmentCollector;
    fn for_segment(
        &self,
        segment: SegmentOrdinal,
        reader: &SegmentReader,
    ) -> tantivy::Result<Self::Child> {
        let ids = reader.fast_fields().str("session_id")?.ok_or_else(|| {
            TantivyError::InvalidArgument("Missing Session fast field; rebuild index".to_string())
        })?;
        let winners = vec![None; ids.num_terms()];
        Ok(SessionSegmentCollector {
            ids,
            segment,
            winners,
            matched: Vec::new(),
        })
    }
    fn requires_scoring(&self) -> bool {
        self.scoring
    }
    fn collect_segment(
        &self,
        weight: &dyn Weight,
        segment: SegmentOrdinal,
        reader: &SegmentReader,
    ) -> tantivy::Result<<Self::Child as SegmentCollector>::Fruit> {
        let check = || {
            self.cancellation
                .check()
                .map_err(TantivyError::InvalidArgument)
        };
        check()?;
        let mut collector = self.for_segment(segment, reader)?;
        let mut scorer = weight.scorer(reader, 1.0)?;
        let alive = reader.alive_bitset();
        let mut count = 0usize;
        while scorer.doc() != TERMINATED {
            if count & 1023 == 0 {
                check()?;
            }
            let doc = scorer.doc();
            if alive.map_or(true, |a| a.is_alive(doc)) {
                collector.collect(doc, if self.scoring { scorer.score() } else { 0.0 });
            }
            scorer.advance();
            count += 1;
        }
        check()?;
        Ok(collector.harvest())
    }
    fn merge_fruits(
        &self,
        segments: Vec<<Self::Child as SegmentCollector>::Fruit>,
    ) -> tantivy::Result<Self::Fruit> {
        let mut winners: Representatives = HashMap::new();
        for segment in segments {
            self.cancellation
                .check()
                .map_err(TantivyError::InvalidArgument)?;
            for (id, score, address) in segment? {
                winners
                    .entry(id)
                    .and_modify(|old| {
                        if score > old.0 || (score == old.0 && address < old.1) {
                            *old = (score, address);
                        }
                    })
                    .or_insert((score, address));
            }
        }
        Ok(winners)
    }
}

impl SegmentCollector for SessionSegmentCollector {
    type Fruit = tantivy::Result<Vec<(String, Score, DocAddress)>>;
    fn collect(&mut self, doc: DocId, score: Score) {
        for ord in self.ids.term_ords(doc) {
            let ord = ord as usize;
            let winner = &mut self.winners[ord];
            if winner.is_none() {
                self.matched.push(ord);
            }
            if winner.map_or(true, |(best, old_doc)| {
                score > best || (score == best && doc < old_doc)
            }) {
                *winner = Some((score, doc));
            }
        }
    }
    fn harvest(self) -> Self::Fruit {
        self.matched
            .into_iter()
            .map(|ord| {
                let (score, doc) = self.winners[ord].expect("matched ordinal has a winner");
                let mut id = String::new();
                self.ids.ord_to_str(ord as u64, &mut id)?;
                Ok((id, score, DocAddress::new(self.segment, doc)))
            })
            .collect()
    }
}

#[cfg(test)]
#[path = "session_query_tests.rs"]
mod tests;
