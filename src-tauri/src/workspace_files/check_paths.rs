//! Batched file facts for rendered links. Workspace references that resolve
//! to ordinary external symlinks return a canonical local target. Existence,
//! read/policy errors and missing paths are distinct; mutation stays behind
//! the existing workspace path boundary.

use std::collections::HashMap;

use serde::Serialize;

use super::path_safety::{resolve_existing_inside_workspace, validate_workspace_root};
use super::system_open::validate_external_open_path;

/// Hard cap on inputs — matches sidecar `/agent/check-paths` (200) so a typo
/// in renderer code can't fan out an unbounded `stat()` storm.
const MAX_BATCH_SIZE: usize = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    pub exists: bool,
    /// "file" | "dir" — defaults to "file" for not-found / invalid entries
    /// to mirror the sidecar's fallback shape.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckPathsResult {
    /// Map preserves the input order of distinct paths via insertion order
    /// (HashMap is fine here — the renderer keys lookups by path string).
    pub results: HashMap<String, PathInfo>,
}

#[tauri::command]
pub async fn cmd_workspace_check_paths(
    workspace: String,
    paths: Vec<String>,
) -> Result<CheckPathsResult, String> {
    if paths.len() > MAX_BATCH_SIZE {
        return Err(format!("Too many paths (max {}).", MAX_BATCH_SIZE));
    }
    let workspace_root = validate_workspace_root(&workspace)?;

    let mut results: HashMap<String, PathInfo> = HashMap::with_capacity(paths.len());
    for raw in paths {
        let info = check_one(&workspace_root, &raw);
        results.insert(raw, info);
    }
    Ok(CheckPathsResult { results })
}

/// Batch existence check for absolute local paths.
///
/// This is the workspace-free sibling of `cmd_workspace_check_paths`, used by
/// chat-rendered file affordances when a Markdown link or inline path points to
/// a real local file outside the active workspace. It deliberately reuses the
/// same safety surface as `cmd_open_path_external` / `cmd_open_path_with_default`:
/// existing absolute path, canonicalized, under home/tmp/optional workspace, and
/// outside credential/system blacklists.
#[tauri::command]
pub async fn cmd_check_local_paths(
    paths: Vec<String>,
    workspace: Option<String>,
) -> Result<CheckPathsResult, String> {
    if paths.len() > MAX_BATCH_SIZE {
        return Err(format!("Too many paths (max {}).", MAX_BATCH_SIZE));
    }

    let mut results: HashMap<String, PathInfo> = HashMap::with_capacity(paths.len());
    for raw in paths {
        let info = check_one_local(&raw, workspace.as_deref());
        results.insert(raw, info);
    }
    Ok(CheckPathsResult { results })
}

fn unavailable(error: Option<String>) -> PathInfo {
    PathInfo {
        exists: false,
        kind: "file".into(),
        resolved_path: None,
        error,
    }
}

fn inspect_path(path: &std::path::Path, local: bool) -> PathInfo {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() || metadata.is_dir() => {
            if metadata.is_file() {
                if let Err(error) = std::fs::File::open(path) {
                    return unavailable(Some(error.to_string()));
                }
            }
            PathInfo {
                exists: true,
                kind: if metadata.is_dir() { "dir" } else { "file" }.into(),
                resolved_path: local.then(|| {
                    crate::sidecar::normalize_external_path(path.to_path_buf())
                        .to_string_lossy()
                        .into_owned()
                }),
                error: None,
            }
        }
        Ok(_) => unavailable(Some("Not a regular file or directory".into())),
        Err(error) => {
            unavailable((error.kind() != std::io::ErrorKind::NotFound).then(|| error.to_string()))
        }
    }
}

fn check_one(workspace_root: &std::path::Path, raw: &str) -> PathInfo {
    if raw.trim().is_empty() {
        return unavailable(None);
    }
    if let Ok(path) = resolve_existing_inside_workspace(workspace_root, raw.trim()) {
        return inspect_path(&path, false);
    }
    // A real symlink outside the workspace is a local read target. Its
    // canonical path goes back to the renderer so menus cannot mutate it via
    // workspace-relative commands. This fallback ONLY returns a local read
    // capability, never a workspace-relative write target. Local policy must
    // inspect the canonical target itself (the workspace lexical guard also
    // rejects legitimate links to the OS temporary directory).
    if std::path::Path::new(raw.trim()).is_absolute() {
        return unavailable(Some("Path must be relative to workspace root".into()));
    }
    check_one_local(&workspace_root.join(raw.trim()).to_string_lossy(), None)
}

fn check_one_local(raw: &str, workspace: Option<&str>) -> PathInfo {
    if raw.trim().is_empty() {
        return unavailable(None);
    }
    match validate_external_open_path(raw.trim(), workspace) {
        Ok(path) => inspect_path(&path, true),
        Err(error) => {
            // Preserve permission/policy failures; only a genuine OS NotFound
            // becomes a missing-file result. No diagnostic is inferred from
            // translated platform error text.
            let target = if let Some(relative) = raw.trim().strip_prefix("~/") {
                #[cfg(windows)]
                let home = std::env::var_os("USERPROFILE");
                #[cfg(not(windows))]
                let home = std::env::var_os("HOME");
                home.map(std::path::PathBuf::from).map(|p| p.join(relative))
            } else {
                Some(std::path::PathBuf::from(raw.trim()))
            };
            let missing = target
                .and_then(|p| std::fs::metadata(p).err())
                .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound);
            unavailable((!missing).then_some(error))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_files::test_support::make_test_workspace;
    use std::fs;

    #[tokio::test]
    async fn returns_correct_kinds() {
        let ws = make_test_workspace("check_paths_kinds");
        fs::write(ws.join("a.txt"), "x").unwrap();
        fs::create_dir_all(ws.join("b")).unwrap();
        let res = cmd_workspace_check_paths(
            ws.to_string_lossy().to_string(),
            vec!["a.txt".to_string(), "b".to_string(), "missing".to_string()],
        )
        .await
        .unwrap();
        assert_eq!(res.results.get("a.txt").unwrap().exists, true);
        assert_eq!(res.results.get("a.txt").unwrap().kind, "file");
        assert_eq!(res.results.get("b").unwrap().exists, true);
        assert_eq!(res.results.get("b").unwrap().kind, "dir");
        assert_eq!(res.results.get("missing").unwrap().exists, false);
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn traversal_collapses_to_not_found() {
        let ws = make_test_workspace("check_paths_traversal");
        let res = cmd_workspace_check_paths(
            ws.to_string_lossy().to_string(),
            vec!["../etc/hosts".to_string(), "/etc/passwd".to_string()],
        )
        .await
        .unwrap();
        // Both invalid → exists:false, no error surfaced (mirrors sidecar).
        assert_eq!(res.results.get("../etc/hosts").unwrap().exists, false);
        assert_eq!(res.results.get("/etc/passwd").unwrap().exists, false);
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn empty_batch_is_ok() {
        let ws = make_test_workspace("check_paths_empty");
        let res = cmd_workspace_check_paths(ws.to_string_lossy().to_string(), vec![])
            .await
            .unwrap();
        assert!(res.results.is_empty());
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn rejects_oversized_batch() {
        let ws = make_test_workspace("check_paths_too_many");
        let paths: Vec<String> = (0..MAX_BATCH_SIZE + 1).map(|i| format!("p{}", i)).collect();
        let res = cmd_workspace_check_paths(ws.to_string_lossy().to_string(), paths).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("max"));
        let _ = fs::remove_dir_all(&ws);
    }

    // Empty / whitespace-only path → exists:false (matches sidecar "skip" path
    // for `if (typeof p !== 'string' || !p)`).
    #[tokio::test]
    async fn empty_string_path_is_not_found() {
        let ws = make_test_workspace("check_paths_empty_str");
        let res = cmd_workspace_check_paths(
            ws.to_string_lossy().to_string(),
            vec!["".to_string(), "  ".to_string()],
        )
        .await
        .unwrap();
        assert_eq!(res.results.get("").unwrap().exists, false);
        assert_eq!(res.results.get("  ").unwrap().exists, false);
        let _ = fs::remove_dir_all(&ws);
    }

    // Cross-review round 2 (Codex MED-3): a workspace-internal symlink
    // pointing to /etc/... must report exists:false here, otherwise the
    // renderer's inline-code chip is clickable but the click → read_preview
    // rejects with "Path escapes workspace via symlink". Aligns with read
    // command behavior.
    #[cfg(unix)]
    #[tokio::test]
    async fn returns_local_read_target_for_ordinary_external_symlink() {
        use std::os::unix::fs::symlink;
        let ws = make_test_workspace("check_paths_symlink_escape");
        let outside = std::env::temp_dir().join(format!("check_outside_{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        let target = outside.join("secret.txt");
        fs::write(&target, "secret").unwrap();
        symlink(&target, ws.join("evil_link.txt")).unwrap();

        let res = cmd_workspace_check_paths(
            ws.to_string_lossy().to_string(),
            vec!["evil_link.txt".to_string()],
        )
        .await
        .unwrap();
        let info = res.results.get("evil_link.txt").unwrap();
        assert!(info.exists);
        assert_eq!(
            info.resolved_path.as_deref(),
            Some(
                crate::sidecar::normalize_external_path(fs::canonicalize(&target).unwrap())
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert!(
            resolve_existing_inside_workspace(&ws, "evil_link.txt").is_err(),
            "workspace writes/reads do not gain external mutation authority"
        );
        let _ = fs::remove_dir_all(&ws);
        let _ = fs::remove_dir_all(&outside);
    }

    // The renderer uses the input path string as a cache key, so even though
    // paths internally normalize, the response MUST echo the keys verbatim.
    #[tokio::test]
    async fn response_keys_echo_input() {
        let ws = make_test_workspace("check_paths_echo");
        fs::write(ws.join("a.txt"), "").unwrap();
        let res =
            cmd_workspace_check_paths(ws.to_string_lossy().to_string(), vec!["a.txt".to_string()])
                .await
                .unwrap();
        assert!(res.results.contains_key("a.txt"));
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn local_check_accepts_existing_home_or_tmp_file() {
        let ws = make_test_workspace("check_local_ok");
        let file = ws.join("outside_workspace_shape.txt");
        fs::write(&file, "x").unwrap();
        let raw = file.to_string_lossy().to_string();

        let res = cmd_check_local_paths(vec![raw.clone()], None)
            .await
            .unwrap();

        assert_eq!(res.results.get(&raw).unwrap().exists, true);
        assert_eq!(res.results.get(&raw).unwrap().kind, "file");
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn local_check_rejects_missing_or_relative() {
        let res = cmd_check_local_paths(
            vec![
                "relative.txt".to_string(),
                "/definitely/missing/file.txt".to_string(),
            ],
            None,
        )
        .await
        .unwrap();

        assert_eq!(res.results.get("relative.txt").unwrap().exists, false);
        assert_eq!(
            res.results
                .get("/definitely/missing/file.txt")
                .unwrap()
                .exists,
            false,
        );
    }
}
