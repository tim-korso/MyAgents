//! Read / write `<workspace>/CLAUDE.md` (Phase D.5 / E1 migration).
//!
//! Mirrors sidecar `/api/claude-md` GET/POST. Used by SystemPromptsPanel in
//! Settings to view / edit a workspace's CLAUDE.md (project-level system
//! prompt addendum). Path is fixed per workspace — `<workspace>/CLAUDE.md` —
//! so there's no path-traversal surface on the input side.
//!
//! - Read returns `{ exists, path, content }` (mirrors sidecar shape so the
//!   Settings UI is a 1:1 swap). "not exists" is NOT an error — the editor
//!   just opens empty.
//! - Write creates the file if missing (CLAUDE.md is often "created on
//!   first edit" — no separate "create" affordance in UI).
//! - Bounded read (1MB cap) + atomic write — both routed through
//!   `path_safety` helpers, so symlink-escape and TOCTOU defenses match
//!   `read_preview` / `save_file` exactly.
//!
//! Trade-off: no file lock around write. Multi-tab Settings edit produces
//! last-writer-wins. Workspace-level config + single-user app makes the race
//! window tiny; if it bites, swap to `with_file_lock_blocking`.

use std::fs;

use serde::Serialize;

use super::path_safety::{
    atomic_write_file, resolve_existing_inside_workspace, resolve_inside_workspace,
    validate_workspace_root,
};

const CLAUDE_MD_FILENAME: &str = "CLAUDE.md";

/// Hard cap on CLAUDE.md size — both read and write — so a malformed /
/// truncated-to-4GB file can't OOM the Tauri runtime. 1MB is well above any
/// practical CLAUDE.md.
const MAX_CONTENT_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadClaudeMdResult {
    pub exists: bool,
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub async fn cmd_workspace_read_claude_md(workspace: String) -> Result<ReadClaudeMdResult, String> {
    let workspace_root = validate_workspace_root(&workspace)?;
    let path_str = workspace_root
        .join(CLAUDE_MD_FILENAME)
        .to_string_lossy()
        .to_string();

    // resolve_existing_inside_workspace canonicalizes the path AND verifies
    // it's inside the canonical workspace root. Three outcomes:
    // - Ok(canonical) → file exists, path is safe to read
    // - Err("File not found") → return exists:false (UI shows empty editor)
    // - Err(other) → propagate (e.g. "Path escapes workspace root via symlink"
    //   for a malicious CLAUDE.md → outside-workspace symlink)
    let resolved = match resolve_existing_inside_workspace(&workspace_root, CLAUDE_MD_FILENAME) {
        Ok(p) => p,
        Err(e) if e == "File not found" => {
            return Ok(ReadClaudeMdResult {
                exists: false,
                path: path_str,
                content: String::new(),
            });
        }
        Err(e) => return Err(e),
    };

    // Bounded read — symmetric with the 1MB write cap. Defends against
    // attacker-controlled CLAUDE.md ballooning to 4GB → OOM in renderer
    // (Codex round-3 CRIT-3). Uses `metadata().len()` first to short-circuit
    // huge files cheaply, then `take(MAX+1)` as TOCTOU defense in case the
    // file grows between metadata() and read.
    let metadata = fs::metadata(&resolved).map_err(|_| "File not found".to_string())?;
    if metadata.len() > MAX_CONTENT_BYTES {
        return Err("CLAUDE.md too large to read".to_string());
    }
    use std::io::Read;
    let mut file = fs::File::open(&resolved).map_err(|e| format!("Open failed: {}", e))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(MAX_CONTENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Read failed: {}", e))?;
    if bytes.len() as u64 > MAX_CONTENT_BYTES {
        return Err("CLAUDE.md too large to read".to_string());
    }
    let content =
        String::from_utf8(bytes).map_err(|e| format!("CLAUDE.md is not valid UTF-8: {}", e))?;

    Ok(ReadClaudeMdResult {
        exists: true,
        path: path_str,
        content,
    })
}

/// Write — creates if missing. Returns `()` (success signaled by `Result::Ok`).
#[tauri::command]
pub async fn cmd_workspace_write_claude_md(
    workspace: String,
    content: String,
) -> Result<(), String> {
    if content.len() as u64 > MAX_CONTENT_BYTES {
        return Err("Content too large".to_string());
    }
    let workspace_root = validate_workspace_root(&workspace)?;

    // If CLAUDE.md exists as a symlink-out-of-workspace, refuse to write
    // (would corrupt the outside target). For non-existent / regular-file /
    // safe-symlink cases, fall through to the atomic write.
    //
    // Reuse `resolve_existing_inside_workspace`: if it succeeds, the file
    // exists AND is safely inside the workspace; if it returns
    // "File not found", the file doesn't exist (we're about to create it,
    // which is fine — the path is fixed `<root>/CLAUDE.md`, no escape risk);
    // any other error means the existing file/link escapes — propagate.
    match resolve_existing_inside_workspace(&workspace_root, CLAUDE_MD_FILENAME) {
        Ok(_) => { /* exists and inside workspace — safe to overwrite */ }
        Err(e) if e == "File not found" => { /* doesn't exist — will create */ }
        Err(e) => return Err(e),
    }

    let target = resolve_inside_workspace(&workspace_root, CLAUDE_MD_FILENAME)?;
    atomic_write_file(&target, content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_files::test_support::make_test_workspace;

    #[tokio::test]
    async fn read_returns_exists_false_when_missing() {
        let ws = make_test_workspace("claude_md_read_missing");
        let res = cmd_workspace_read_claude_md(ws.to_string_lossy().to_string())
            .await
            .unwrap();
        assert!(!res.exists);
        assert_eq!(res.content, "");
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn read_returns_content() {
        let ws = make_test_workspace("claude_md_read_content");
        fs::write(ws.join("CLAUDE.md"), "# project rules\nbe nice").unwrap();
        let res = cmd_workspace_read_claude_md(ws.to_string_lossy().to_string())
            .await
            .unwrap();
        assert!(res.exists);
        assert!(res.content.contains("be nice"));
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn read_rejects_oversize() {
        let ws = make_test_workspace("claude_md_read_oversize");
        let big = "a".repeat((MAX_CONTENT_BYTES + 1) as usize);
        fs::write(ws.join("CLAUDE.md"), &big).unwrap();
        let res = cmd_workspace_read_claude_md(ws.to_string_lossy().to_string()).await;
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn write_creates_when_missing() {
        let ws = make_test_workspace("claude_md_write_create");
        cmd_workspace_write_claude_md(ws.to_string_lossy().to_string(), "# new\n".to_string())
            .await
            .unwrap();
        assert!(ws.join("CLAUDE.md").is_file());
        assert_eq!(fs::read_to_string(ws.join("CLAUDE.md")).unwrap(), "# new\n");
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn write_overwrites_existing() {
        let ws = make_test_workspace("claude_md_write_overwrite");
        fs::write(ws.join("CLAUDE.md"), "old").unwrap();
        cmd_workspace_write_claude_md(ws.to_string_lossy().to_string(), "new".to_string())
            .await
            .unwrap();
        assert_eq!(fs::read_to_string(ws.join("CLAUDE.md")).unwrap(), "new");
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn write_rejects_oversize() {
        let ws = make_test_workspace("claude_md_write_oversize");
        let big = "a".repeat((MAX_CONTENT_BYTES + 1) as usize);
        let res = cmd_workspace_write_claude_md(ws.to_string_lossy().to_string(), big).await;
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&ws);
    }

    // Symlink-escape parity with read_preview / save_file.
    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlink_escape_on_read() {
        use std::os::unix::fs::symlink;
        let ws = make_test_workspace("claude_md_symlink_read");
        let outside =
            std::env::temp_dir().join(format!("claude_md_outside_{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        let secret = outside.join("secret.md");
        fs::write(&secret, "TOP-SECRET").unwrap();
        symlink(&secret, ws.join("CLAUDE.md")).unwrap();

        let res = cmd_workspace_read_claude_md(ws.to_string_lossy().to_string()).await;
        assert!(res.is_err());
        assert!(!format!("{:?}", res).contains("TOP-SECRET"));
        let _ = fs::remove_dir_all(&ws);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlink_escape_on_write() {
        use std::os::unix::fs::symlink;
        let ws = make_test_workspace("claude_md_symlink_write");
        let outside =
            std::env::temp_dir().join(format!("claude_md_outside_w_{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        let secret = outside.join("secret.md");
        fs::write(&secret, "OUTSIDE").unwrap();
        symlink(&secret, ws.join("CLAUDE.md")).unwrap();

        let res = cmd_workspace_write_claude_md(
            ws.to_string_lossy().to_string(),
            "OVERWRITE".to_string(),
        )
        .await;
        assert!(res.is_err());
        // The outside file is untouched.
        assert_eq!(fs::read_to_string(&secret).unwrap(), "OUTSIDE");
        let _ = fs::remove_dir_all(&ws);
        let _ = fs::remove_dir_all(&outside);
    }
}
