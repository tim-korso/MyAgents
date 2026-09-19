//! Download a workspace file as raw bytes for the preview-image flow.
//!
//! Returns base64 + mime + filename so the renderer can reconstruct a Blob and
//! object URL. We deliberately do NOT stream — the only caller is
//! DirectoryPanel's image-preview modal, which renders a single image at a
//! time, and we cap at 25MB (picture from a photo library is usually < 10MB
//! anyway). Larger payloads should not be loaded into the preview modal at
//! all and the caller should prompt the user to "Open with default app".

use std::fs;
use std::io::Read;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;

use super::path_safety::{resolve_existing_inside_workspace, validate_workspace_root};
use super::system_open::validate_external_open_path;

// Cap for binary download → rich-document preview (pdf/docx/xlsx/pptx) and the
// image-preview modal. Raised 25MB → 50MB so larger decks / books / scanned PDFs
// preview inline. base64 over the Tauri invoke channel inflates ~33%, so a 50MB
// file is ~67MB on the wire — acceptable for a one-shot preview load; the bounded
// read below still caps actual allocation.
const MAX_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub name: String,
    pub mime_type: String,
    /// Base64-encoded body — frontend reconstructs Blob via `atob`.
    pub data: String,
}

#[tauri::command]
pub async fn cmd_workspace_download_file(
    workspace: String,
    path: String,
) -> Result<DownloadResult, String> {
    if path.trim().is_empty() {
        return Err("Missing path".to_string());
    }
    let workspace_root = validate_workspace_root(&workspace)?;
    // Phase D.5: canonicalize-and-prefix-check blocks symlink escape via
    // `evil_link → /etc/...`. download.rs returns raw bytes; without this
    // a malicious repo could exfiltrate arbitrary files via the preview UI.
    let resolved = resolve_existing_inside_workspace(&workspace_root, &path)?;

    download_file_resolved(&resolved, &path)
}

/// Download an absolute local file as base64 for preview surfaces. Same cap as
/// workspace downloads; path validation follows `cmd_open_path_with_default`.
#[tauri::command]
pub async fn cmd_download_local_file(
    full_path: String,
    workspace: Option<String>,
) -> Result<DownloadResult, String> {
    let trimmed = full_path.trim();
    if trimmed.is_empty() {
        return Err("Missing path".to_string());
    }
    let resolved = validate_external_open_path(trimmed, workspace.as_deref())?;
    download_file_resolved(&resolved, trimmed)
}

/// Like `cmd_workspace_download_file` but returns RAW BYTES via
/// `tauri::ipc::Response` instead of base64. For the rich-document viewers
/// (pdf/docx/xlsx/pptx), where bytes feed straight into the parser: avoids the
/// ~33% base64 inflation over IPC AND the main-thread `atob` + byte-loop decode in
/// the renderer — both of which bite at the 50MB cap. The base64 variant stays for
/// the image-preview modal (which needs a `data:` URL). Same path-safety,
/// size cap, bounded read, and error strings as `cmd_workspace_download_file` so
/// the renderer's "too large" handling is identical.
#[tauri::command]
pub async fn cmd_workspace_download_bytes(
    workspace: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if path.trim().is_empty() {
        return Err("Missing path".to_string());
    }
    let workspace_root = validate_workspace_root(&workspace)?;
    let resolved = resolve_existing_inside_workspace(&workspace_root, &path)?;
    download_bytes_resolved(&resolved)
}

/// Download an absolute local file as raw bytes for rich-document preview.
#[tauri::command]
pub async fn cmd_download_local_bytes(
    full_path: String,
    workspace: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    let trimmed = full_path.trim();
    if trimmed.is_empty() {
        return Err("Missing path".to_string());
    }
    let resolved = validate_external_open_path(trimmed, workspace.as_deref())?;
    download_bytes_resolved(&resolved)
}

fn download_file_resolved(
    resolved: &std::path::Path,
    display_path: &str,
) -> Result<DownloadResult, String> {
    let bytes = read_bounded_bytes(resolved)?;
    let name = std::path::Path::new(display_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| display_path.to_string());
    let ext = std::path::Path::new(display_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    Ok(DownloadResult {
        name,
        mime_type: sniff_mime(&ext),
        data: BASE64.encode(&bytes),
    })
}

fn download_bytes_resolved(resolved: &std::path::Path) -> Result<tauri::ipc::Response, String> {
    let bytes = read_bounded_bytes(resolved)?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn read_bounded_bytes(resolved: &std::path::Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(resolved).map_err(|_| "File not found".to_string())?;
    if !metadata.is_file() {
        return Err("Not a regular file".to_string());
    }
    if metadata.len() > MAX_DOWNLOAD_BYTES {
        return Err(format!(
            "File too large to preview (max {} MB)",
            MAX_DOWNLOAD_BYTES / 1024 / 1024
        ));
    }
    // Bounded read (TOCTOU): cap at MAX+1; if we hit it the size check raced.
    let mut file = fs::File::open(resolved).map_err(|e| format!("Open failed: {}", e))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(MAX_DOWNLOAD_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Read failed: {}", e))?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(format!(
            "File too large to preview (max {} MB)",
            MAX_DOWNLOAD_BYTES / 1024 / 1024
        ));
    }
    Ok(bytes)
}

/// Tiny MIME sniffer covering image / common preview cases. Sidecar's
/// `sniffMime` is similarly hand-rolled (`src/server/utils/file-response.ts`);
/// for download-to-preview we only ever return images (DirectoryPanel preview
/// modal), so the table is intentionally short. Fall back to octet-stream so
/// the renderer never gets `undefined`.
fn sniff_mime(ext: &str) -> String {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_files::test_support::make_test_workspace;

    #[tokio::test]
    async fn downloads_file_as_b64() {
        let ws = make_test_workspace("download_ok");
        fs::write(ws.join("pic.png"), b"\x89PNG\r\n").unwrap();
        let res =
            cmd_workspace_download_file(ws.to_string_lossy().to_string(), "pic.png".to_string())
                .await
                .unwrap();
        assert_eq!(res.name, "pic.png");
        assert_eq!(res.mime_type, "image/png");
        assert!(!res.data.is_empty());
        let decoded = BASE64.decode(&res.data).unwrap();
        assert_eq!(decoded, b"\x89PNG\r\n");
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn downloads_local_file_as_b64() {
        let ws = make_test_workspace("download_local_ok");
        let p = ws.join("pic.png");
        fs::write(&p, b"\x89PNG\r\n").unwrap();

        let res = cmd_download_local_file(p.to_string_lossy().to_string(), None)
            .await
            .unwrap();

        assert_eq!(res.name, "pic.png");
        assert_eq!(res.mime_type, "image/png");
        let decoded = BASE64.decode(&res.data).unwrap();
        assert_eq!(decoded, b"\x89PNG\r\n");
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn rejects_oversize() {
        // Cross-review fix: the previous version of this test wrote 16 bytes
        // and only verified happy-path mime detection — the cap branch was
        // never exercised. Now we write MAX_DOWNLOAD_BYTES + 1 and assert
        // the size-check error propagates.
        let ws = make_test_workspace("download_oversize");
        let p = ws.join("huge.bin");
        let buf = vec![0u8; (MAX_DOWNLOAD_BYTES + 1) as usize];
        fs::write(&p, &buf).unwrap();
        let res =
            cmd_workspace_download_file(ws.to_string_lossy().to_string(), "huge.bin".to_string())
                .await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("too large"));
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn rejects_missing() {
        let ws = make_test_workspace("download_missing");
        let res =
            cmd_workspace_download_file(ws.to_string_lossy().to_string(), "nope.png".to_string())
                .await;
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn rejects_traversal() {
        let ws = make_test_workspace("download_traversal");
        let res = cmd_workspace_download_file(
            ws.to_string_lossy().to_string(),
            "../etc/hosts".to_string(),
        )
        .await;
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&ws);
    }

    // Phase D.5 regression: download returns raw bytes. A symlink inside the
    // workspace pointing to an out-of-workspace file must not be downloadable
    // through this command — the canonicalize check in
    // `resolve_existing_inside_workspace` blocks the lexical-resolve bypass.
    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlink_escape() {
        use std::os::unix::fs::symlink;
        let ws = make_test_workspace("download_symlink_escape");
        let outside = std::env::temp_dir().join(format!("download_outside_{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        let secret = outside.join("secret.png");
        fs::write(&secret, b"\x89PNG\rTOP-SECRET-BYTES").unwrap();
        symlink(&secret, ws.join("evil_link.png")).unwrap();

        let res = cmd_workspace_download_file(
            ws.to_string_lossy().to_string(),
            "evil_link.png".to_string(),
        )
        .await;
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&ws);
        let _ = fs::remove_dir_all(&outside);
    }
}
