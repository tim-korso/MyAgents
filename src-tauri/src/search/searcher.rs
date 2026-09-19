//! Search result types for frontend consumption.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchRequest {
    pub consumer_id: String,
    pub generation: u64,
    pub query: String,
    pub tag: Option<String>,
    pub workspaces: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchPageRequest {
    pub consumer_id: String,
    pub generation: u64,
    pub query_id: String,
    pub cursor: usize,
}

/// Session search response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResult {
    pub query_id: String,
    pub next_cursor: Option<usize>,
    pub removed_session_ids: Vec<String>,
    pub hits: Vec<SessionSearchHit>,
    pub total_count: usize,
    pub query_time_ms: f64,
}

/// A single session search hit.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchHit {
    pub session_id: String,
    pub title: String,
    pub agent_dir: String,
    pub score: f32,
    /// "title" or "content"
    pub match_type: String,
    /// Context snippet for content matches (trimmed with "..." ellipsis)
    pub snippet: Option<String>,
    /// Highlight positions within the snippet: [[start, end], ...]
    pub snippet_highlights: Vec<[usize; 2]>,
    /// Highlight positions within the title: [[start, end], ...]
    pub title_highlights: Vec<[usize; 2]>,
    /// "user" or "assistant" for content matches, None for title matches
    pub matched_role: Option<String>,
    pub last_active_at: String,
    pub source: Option<String>,
    pub turn_count: Option<u32>,
    /// Redacted metadata from the same snapshot that decided the row's order.
    pub session: serde_json::Value,
}

/// File search response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub folder_hits: Vec<FolderSearchHit>,
    pub hits: Vec<FileSearchHit>,
    pub total_folders: usize,
    pub total_files: usize,
    pub query_time_ms: f64,
}

/// A single folder search hit.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderSearchHit {
    /// Workspace-relative path using `/` separators on every platform.
    pub path: String,
    pub name: String,
}

/// A single file search hit (with matching lines).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchHit {
    pub path: String,
    pub name: String,
    pub match_count: usize,
    pub matches: Vec<FileMatchLine>,
}

/// A matching line within a file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatchLine {
    pub line_number: usize,
    pub line_content: String,
    /// Highlight positions within line_content: [[start, end], ...]
    pub highlights: Vec<[usize; 2]>,
}
