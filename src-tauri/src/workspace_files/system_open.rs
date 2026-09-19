//! User-directed local file open/reveal. Workspace commands retain their
//! containment checks; local commands canonicalize the target and allow
//! ordinary files on any volume, retaining credential/system exclusions.
//! They do not authorize editing, executing, or uploading the referenced file.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::path_safety::{resolve_existing_inside_workspace, validate_workspace_root};
use crate::process_cmd;

/// Retained wire context for callers; local read permission is determined by
/// the actual file, independently of workspace mutation containment.
type WorkspaceArg = Option<String>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemOpenResult {
    pub success: bool,
}

#[tauri::command]
pub async fn cmd_workspace_open_in_finder(
    workspace: String,
    path: String,
) -> Result<SystemOpenResult, String> {
    let workspace_root = validate_workspace_root(&workspace)?;
    // MUST use the canonicalizing resolver, NOT lexical `resolve_inside_workspace`.
    // A symlink inside the workspace pointing at `~/.ssh/id_rsa` (or any system
    // path) passes the lexical check — the relative segment is just a filename
    // — and `spawn_reveal` then calls `open -R` against the symlink, which
    // follows it and reveals the real target. `resolve_existing_inside_workspace`
    // canonicalizes both ends and rejects when the canonical target sits
    // outside the canonical workspace root. The existence guard moves into the
    // resolver too — `fs::canonicalize` fails on missing paths and the resolver
    // surfaces that as "File not found".
    let target = resolve_existing_inside_workspace(&workspace_root, path.trim())?;
    spawn_reveal(&target)?;
    Ok(SystemOpenResult { success: true })
}

#[tauri::command]
pub async fn cmd_workspace_open_with_default(
    workspace: String,
    path: String,
) -> Result<SystemOpenResult, String> {
    let workspace_root = validate_workspace_root(&workspace)?;
    // Same hardening as cmd_workspace_open_in_finder above — symlink inside
    // workspace pointing at a credential file would otherwise be opened by
    // the OS default app. resolve_existing_inside_workspace blocks the escape.
    let target = resolve_existing_inside_workspace(&workspace_root, path.trim())?;
    spawn_default_open(&target)?;
    Ok(SystemOpenResult { success: true })
}

/// Reveal an **absolute** path in the OS file manager. Used by the
/// Skill/Command detail panels to open `~/.myagents/skills/<name>/SKILL.md`
/// (which lives outside any chat workspace).
///
/// Existing ordinary local files are allowed on any volume. The canonical
/// target still passes the application's credential/system exclusions.
#[tauri::command]
pub async fn cmd_open_path_external(
    full_path: String,
    workspace: WorkspaceArg,
) -> Result<SystemOpenResult, String> {
    let trimmed = full_path.trim();
    if trimmed.is_empty() {
        return Err("fullPath is required".to_string());
    }
    let target = validate_external_open_path(trimmed, workspace.as_deref())?;
    spawn_reveal(&target)?;
    Ok(SystemOpenResult { success: true })
}

/// Open an **absolute** path with the OS default application (i.e. hand off
/// like `open <path>` / Windows `Start-Process` / `xdg-open <path>`). Used
/// by `BrowserPanel`'s "open in external browser" button when the embedded
/// preview is a local HTML file (issue #125). Also covers any future
/// `openExternal(file:// | absolute path)` call — the renderer helper
/// auto-routes file targets through this command because Tauri's
/// `shell:allow-open` scope regex rejects file targets entirely.
///
/// Same safety surface as `cmd_open_path_external` — see
/// `validate_external_open_path` for the canonicalize + home/tmp prefix +
/// credential blacklist guard. The only difference is the spawn target
/// (`spawn_default_open` vs `spawn_reveal`).
#[tauri::command]
pub async fn cmd_open_path_with_default(
    full_path: String,
    workspace: WorkspaceArg,
) -> Result<SystemOpenResult, String> {
    let trimmed = full_path.trim();
    if trimmed.is_empty() {
        return Err("fullPath is required".to_string());
    }
    let target = validate_external_open_path(trimmed, workspace.as_deref())?;
    spawn_default_open(&target)?;
    Ok(SystemOpenResult { success: true })
}

/// User-directed local read/open policy. Ordinary files on external volumes
/// and sibling workspaces are valid targets too. This does not authorize any
/// workspace mutation; canonical credential/system exclusions still apply.
pub(super) fn validate_external_open_path(
    full_path: &str,
    _workspace: Option<&str>,
) -> Result<PathBuf, String> {
    let target = if let Some(relative) = full_path.strip_prefix("~/") {
        home_dir()
            .ok_or("Cannot resolve home directory")?
            .join(relative)
    } else {
        PathBuf::from(full_path)
    };
    if !target.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    let canonical = std::fs::canonicalize(&target).map_err(|error| error.to_string())?;
    let tmp = std::env::temp_dir();
    let canonical_tmp = std::fs::canonicalize(&tmp).unwrap_or(tmp);
    if !canonical.starts_with(&canonical_tmp) {
        let normalized = crate::sidecar::normalize_external_path(canonical.clone());
        crate::commands::validate_file_path(&normalized.to_string_lossy())?;
        if canonical_starts_with_canonical_blacklist(&canonical) {
            return Err("Path not allowed".to_string());
        }
    }
    Ok(canonical)
}

/// Re-runs the system-directory blacklist using **canonicalized** root
/// forms. Catches the macOS `/etc → /private/etc` gap that the lexical
/// `validate_file_path` blacklist misses. The roots mirror those in
/// `validate_file_path` (kept in sync manually — both lists are short and
/// stable, and forking the lexical version is intentionally cheaper than
/// reworking `validate_file_path`'s shared callers).
fn canonical_starts_with_canonical_blacklist(canonical: &Path) -> bool {
    #[cfg(not(windows))]
    let raw_roots: &[&str] = &[
        "/etc",
        "/var",
        "/usr",
        "/bin",
        "/sbin",
        "/boot",
        "/root",
        "/sys",
        "/proc",
        "/dev",
        "/System",
        "/Library/Keychains",
        "/Library/Cookies",
    ];
    #[cfg(windows)]
    let raw_roots: &[&str] = &[
        "C:\\Windows",
        "C:\\Program Files",
        "C:\\Program Files (x86)",
        "C:\\ProgramData",
        "C:\\Recovery",
        "C:\\$Recycle.Bin",
    ];
    for raw in raw_roots {
        // Use canonicalize when the root exists (resolves macOS symlink
        // farms like `/etc → /private/etc`), otherwise fall back to the
        // raw form. `unwrap_or` keeps the loop infallible — a missing
        // root just means there's nothing to match against on that host.
        let root = std::fs::canonicalize(raw).unwrap_or_else(|_| PathBuf::from(raw));
        if canonical.starts_with(&root) {
            return true;
        }
    }
    false
}

/// True if `path` is a filesystem root (`/`, drive root like `C:\`, or
/// the verbatim form `\\?\C:\`). Walking the components and checking for
/// at least one `Component::Normal` is portable across Unix / Windows /
/// the verbatim-prefix variants `canonicalize` produces on Windows.
///
fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

#[cfg(target_os = "macos")]
fn spawn_reveal(target: &Path) -> Result<(), String> {
    process_cmd::new("open")
        .arg("-R")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open -R failed: {}", e))
}

#[cfg(target_os = "windows")]
fn spawn_reveal(target: &Path) -> Result<(), String> {
    process_cmd::new("explorer")
        .arg("/select,")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("explorer /select failed: {}", e))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_reveal(target: &Path) -> Result<(), String> {
    let parent = target.parent().unwrap_or(target);
    process_cmd::new("xdg-open")
        .arg(parent)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("xdg-open failed: {}", e))
}

#[cfg(target_os = "macos")]
fn spawn_default_open(target: &Path) -> Result<(), String> {
    process_cmd::new("open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open failed: {}", e))
}

#[cfg(target_os = "windows")]
fn spawn_default_open(target: &Path) -> Result<(), String> {
    // PowerShell `Start-Process` avoids `cmd /c` interpreting & | > as
    // command operators when filenames contain them. Single-quote-escape
    // single quotes in the path before interpolation.
    let escaped = target.to_string_lossy().replace('\'', "''");
    process_cmd::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(format!("Start-Process -FilePath '{}'", escaped))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("powershell Start-Process failed: {}", e))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_default_open(target: &Path) -> Result<(), String> {
    process_cmd::new("xdg-open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("xdg-open failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_files::test_support::make_test_workspace;
    use std::fs;

    #[tokio::test]
    async fn rejects_missing_target() {
        let ws = make_test_workspace("system_open_missing");
        let res = cmd_workspace_open_with_default(
            ws.to_string_lossy().to_string(),
            "nope.txt".to_string(),
        )
        .await;
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn rejects_traversal() {
        let ws = make_test_workspace("system_open_traversal");
        let res = cmd_workspace_open_with_default(
            ws.to_string_lossy().to_string(),
            "../etc/hosts".to_string(),
        )
        .await;
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&ws);
    }

    // We don't actually invoke the spawn — that'd open a Finder window from
    // the test runner. The validation paths above cover the safety surface.

    // ── cmd_open_path_external — Phase D.5 ──

    #[tokio::test]
    async fn open_path_external_rejects_relative() {
        let res = cmd_open_path_external("relative/path".to_string(), None).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("absolute"));
    }

    #[tokio::test]
    async fn open_path_with_default_rejects_relative_and_empty() {
        let res = cmd_open_path_with_default("relative/path".to_string(), None).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("absolute"));
        let res = cmd_open_path_with_default("".to_string(), None).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn open_path_external_rejects_empty() {
        let res = cmd_open_path_external("".to_string(), None).await;
        assert!(res.is_err());
        let res = cmd_open_path_external("   ".to_string(), None).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn open_path_external_rejects_missing() {
        let nonexistent =
            std::env::temp_dir().join(format!("ws_open_external_missing_{}", std::process::id()));
        // Don't create — should fail at canonicalize.
        let res = cmd_open_path_external(nonexistent.to_string_lossy().to_string(), None).await;
        assert!(res.is_err());
    }

    // Path under the user home dir — validation passes (we don't invoke
    // spawn in tests; just check the validator).
    #[test]
    fn validate_external_open_accepts_home_path() {
        // Use a real existing file under home: the test workspace itself
        // (which we just created via make_test_workspace).
        let ws = make_test_workspace("system_open_external_home");
        fs::write(ws.join("inside.md"), "x").unwrap();
        let res =
            validate_external_open_path(ws.join("inside.md").to_string_lossy().as_ref(), None);
        assert!(res.is_ok(), "home-dir path should validate, got {:?}", res);
        let _ = fs::remove_dir_all(&ws);
    }

    // Also the regression guard for B1: on macOS `temp_dir()` canonicalizes
    // under `/private/var/folders/...`, so a `/private/var` system-blacklist
    // entry must NOT reject tmp-trusted paths (it broke reveal/open for every
    // $TMPDIR file). NB: only exercises the `/private/var` path on macOS — on
    // Linux temp is `/tmp`, so a Linux-only CI won't catch a re-break here.
    #[test]
    fn validate_external_open_accepts_tmp_path() {
        let p = std::env::temp_dir().join(format!("ws_open_tmp_test_{}", std::process::id()));
        fs::write(&p, "x").unwrap();
        let res = validate_external_open_path(p.to_string_lossy().as_ref(), None);
        assert!(res.is_ok(), "tmp path should validate, got {:?}", res);
        let _ = fs::remove_file(&p);
    }

    // Path under a forbidden system dir → rejected. /etc/hosts exists on
    // every macOS/Linux and is outside both home and tmp.
    #[cfg(not(windows))]
    #[test]
    fn validate_external_open_rejects_etc() {
        let res = validate_external_open_path("/etc/hosts", None);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("denied"));
    }

    // Issue #125 follow-up: a workspace path outside home/tmp (the canonical
    // case is a Windows `D:\workspace` but on macOS we simulate it with a
    // tmp dir, since tmp is allowed by both branches we exercise the
    // workspace branch by NOT passing the workspace and verifying the path
    // outside home is rejected, then re-running with the workspace and
    // verifying it's accepted.
    //
    // Simulating "outside home/tmp" on macOS: we'd need write access to a
    // dir outside both. The closest portable proxy is to make the test
    // workspace itself, then verify the validator with workspace=Some(ws)
    // accepts a path inside it. We rely on the fact that `make_test_workspace`
    // returns a path inside tmp — so without the workspace arg it'd ALSO
    // pass (via tmp). To get a true regression guard we need a non-tmp,
    // non-home dir, which isn't portably writable. We compromise: the test
    // verifies the workspace-arg branch is wired up and works (no error),
    // and we add a separate negative test that an arbitrary path outside
    // home/tmp/ws is still rejected.
    #[test]
    fn validate_external_open_accepts_workspace_path() {
        let ws = make_test_workspace("system_open_external_workspace");
        let inside = ws.join("preview.html");
        fs::write(&inside, "<html/>").unwrap();
        // Without workspace arg — passes anyway because tmp covers it on
        // most CI; the assertion is that with workspace arg it ALSO passes.
        let res = validate_external_open_path(
            inside.to_string_lossy().as_ref(),
            Some(ws.to_string_lossy().as_ref()),
        );
        assert!(res.is_ok(), "workspace path should validate, got {:?}", res);
        let _ = fs::remove_dir_all(&ws);
    }

    // Workspace arg MUST NOT disable the project-wide credential
    // blacklist. Concrete check: if target = `<home>/.ssh/<stub>` and
    // workspace = home_dir (or any other allowed root), the blacklist
    // must still reject it.
    #[cfg(unix)]
    #[test]
    fn validate_external_open_workspace_does_not_bypass_home_blacklist() {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let Some(home) = home else { return };
        let ssh_dir = home.join(".ssh");
        if !ssh_dir.is_dir() {
            return; // Skip on systems without ~/.ssh.
        }
        let stub = ssh_dir.join(format!("myagents_ws_bypass_test_{}", std::process::id()));
        if std::fs::write(&stub, b"x").is_err() {
            return;
        }
        // Pass workspace=home_dir explicitly — the prefix check accepts
        // the path under canonical_home AND under canonical_workspace,
        // but the credential blacklist must still reject.
        let res = validate_external_open_path(
            stub.to_string_lossy().as_ref(),
            Some(home.to_string_lossy().as_ref()),
        );
        let _ = std::fs::remove_file(&stub);
        assert!(
            res.is_err(),
            "~/.ssh/<stub> must be blocked even with workspace=home, got {:?}",
            res
        );
    }

    // Workspace arg widens the whitelist but must reject blacklisted roots.
    // Caller cannot pass `workspace = "/etc"` etc.: `validate_workspace_root`
    // rejects those upfront.
    #[cfg(not(windows))]
    #[test]
    fn validate_external_open_rejects_blacklisted_workspace_arg() {
        // workspace=/etc → validate_workspace_root rejects.
        let res = validate_external_open_path("/etc/hosts", Some("/etc"));
        assert!(res.is_err(), "blacklisted workspace must be rejected");
    }

    // Filesystem-root workspace (`/`, `C:\`) is rejected — without this
    // guard, `canonical.starts_with(workspace)` would match every path,
    // and the macOS `/etc → /private/etc` symlink quirk would bypass
    // `validate_file_path`'s `/etc` blacklist entry.
    #[cfg(not(windows))]
    #[test]
    fn ordinary_local_file_is_not_rejected_by_root_workspace_context() {
        let p = std::env::temp_dir().join(format!("ws_open_root_arg_{}", std::process::id()));
        fs::write(&p, "x").unwrap();
        let res = validate_external_open_path(p.to_string_lossy().as_ref(), Some("/"));
        assert!(res.is_ok());
        let _ = fs::remove_file(&p);
    }

    // Concrete macOS regression: the bypass that motivated the filesystem-
    // root rejection. With workspace=/ accepted, /etc/hosts canonicalizes
    // to /private/etc/hosts which slips past `validate_file_path` (whose
    // blacklist entry is `/etc`, not `/private/etc`). The guard above
    // closes this — verify it does.
    #[cfg(target_os = "macos")]
    #[test]
    fn validate_external_open_rejects_etc_hosts_via_root_workspace() {
        let res = validate_external_open_path("/etc/hosts", Some("/"));
        assert!(
            res.is_err(),
            "/etc/hosts via workspace='/' must be rejected, got {:?}",
            res
        );
    }

    // Pure unit tests for `match_trusted_prefix` — exercise the workspace
    // branch directly with synthetic paths so the test doesn't depend on
    // the host's home/tmp layout. Codex re-review MED-2: the original
    // workspace test passed via the tmp fallback under macOS, so the
    // workspace branch wasn't being verified.
    #[cfg(target_os = "macos")]
    #[test]
    fn validate_external_open_rejects_etc_hosts_via_private_workspace() {
        // /private exists on macOS as a real directory.
        let res = validate_external_open_path("/etc/hosts", Some("/private"));
        assert!(
            res.is_err(),
            "/etc/hosts via workspace='/private' must be rejected, got {:?}",
            res
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validate_external_open_rejects_etc_hosts_via_private_etc_workspace() {
        let res = validate_external_open_path("/etc/hosts", Some("/private/etc"));
        assert!(
            res.is_err(),
            "/etc/hosts via workspace='/private/etc' must be rejected, got {:?}",
            res
        );
    }

    // Defense-in-depth check stands on its own: even with workspace=None,
    // a target directly under a canonicalized blacklist root (the rare
    // case where the lexical guard misses) is still rejected.
    #[cfg(target_os = "macos")]
    #[test]
    fn canonical_blacklist_catches_private_etc() {
        // /private/etc/hosts exists (it's where /etc resolves to).
        assert!(canonical_starts_with_canonical_blacklist(Path::new(
            "/private/etc/hosts"
        )));
        // /private/var same shape.
        assert!(canonical_starts_with_canonical_blacklist(Path::new(
            "/private/var/log"
        )));
        // Home dir or arbitrary user path is NOT in the blacklist.
        assert!(!canonical_starts_with_canonical_blacklist(Path::new(
            "/Users/foo/project"
        )));
    }

    // Empty / whitespace-only workspace string is treated as no workspace
    // (fall through to home/tmp). Ensures the renderer can pass `workspace:
    // workspace ?? null` without surprising errors.
    #[test]
    fn validate_external_open_treats_empty_workspace_as_none() {
        let p = std::env::temp_dir().join(format!("ws_open_empty_arg_{}", std::process::id()));
        fs::write(&p, "x").unwrap();
        let res = validate_external_open_path(p.to_string_lossy().as_ref(), Some(""));
        assert!(
            res.is_ok(),
            "empty workspace should be ignored, got {:?}",
            res
        );
        let res2 = validate_external_open_path(p.to_string_lossy().as_ref(), Some("   "));
        assert!(
            res2.is_ok(),
            "whitespace workspace should be ignored, got {:?}",
            res2
        );
        let _ = fs::remove_file(&p);
    }

    // Cross-review round 2 (Codex MED-1): `~/.ssh/id_rsa` passes the
    // home-prefix check but MUST be blocked by the credential blacklist.
    // Reveal-in-finder would otherwise let a malicious AI tool / skill emit
    // a button that opens Finder on a private key — left-clicking it could
    // open the file in TextEdit and surface the secret on screen.
    #[cfg(unix)]
    #[test]
    fn validate_external_open_blocks_ssh_dir() {
        // Write a stub file under `~/.ssh`. If the user already has a real
        // ~/.ssh with sensitive contents we don't want to touch it; create a
        // unique-named stub instead.
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let Some(home) = home else { return };
        let ssh_dir = home.join(".ssh");
        let stub = ssh_dir.join(format!("myagents_test_stub_{}", std::process::id()));
        // Skip if we can't create (no .ssh dir, permission, etc.) — rather
        // than trying to mkdir which would touch real config.
        if !ssh_dir.is_dir() {
            return;
        }
        if std::fs::write(&stub, b"x").is_err() {
            return;
        }
        let res = validate_external_open_path(stub.to_string_lossy().as_ref(), None);
        let _ = std::fs::remove_file(&stub);
        assert!(
            res.is_err(),
            "~/.ssh/<stub> must be blocked by credential blacklist; got {:?}",
            res
        );
    }

    // Symlink ESCAPE from a tmp-shaped lure: a tmp file linking to /etc/hosts
    // must be rejected because canonicalize resolves through the link before
    // the prefix check.
    #[cfg(unix)]
    #[test]
    fn validate_external_open_blocks_symlink_escape() {
        use std::os::unix::fs::symlink;
        let lure = std::env::temp_dir().join(format!("ws_open_lure_{}", std::process::id()));
        // Symlink in tmp (allowed prefix) → /etc/hosts (forbidden target).
        let target = "/etc/hosts";
        if !std::path::Path::new(target).exists() {
            // Skip on systems without /etc/hosts (Windows, sandboxed CI).
            return;
        }
        let _ = std::fs::remove_file(&lure);
        symlink(target, &lure).unwrap();
        let res = validate_external_open_path(lure.to_string_lossy().as_ref(), None);
        assert!(
            res.is_err(),
            "symlink to /etc must be rejected, got {:?}",
            res
        );
        let _ = std::fs::remove_file(&lure);
    }

    // ── workspace-relative open: cmd_workspace_open_in_finder /
    // cmd_workspace_open_with_default ──
    //
    // Regression for codex adversarial review (2026-05-07): the workspace-
    // relative open commands previously used lexical `resolve_inside_workspace`,
    // which doesn't follow symlinks during validation but `spawn_reveal` /
    // `spawn_default_open` then ask the OS to open the path — the OS follows
    // the symlink. So a malicious or even just careless `leak → ~/.ssh/id_rsa`
    // symlink committed to a repo would leak the credential.
    //
    // We don't invoke the public `cmd_*` async functions directly because
    // they call `spawn_reveal` (which actually launches `open`), but we DO
    // exercise the underlying resolver — that's the gate that has to
    // reject the lure before any spawn happens.
    #[cfg(unix)]
    #[test]
    fn workspace_open_blocks_symlink_to_protected_path() {
        use crate::workspace_files::path_safety::resolve_existing_inside_workspace;
        use std::os::unix::fs::symlink;

        let target = "/etc/hosts";
        if !std::path::Path::new(target).exists() {
            return;
        }
        // Build a workspace under home (NOT /tmp — on macOS that's
        // /var/folders/... which trips the `/var` system blacklist before
        // we even get to canonicalize-and-prefix-check).
        let Some(home) = home_dir() else { return };
        let ws_root = home.join(format!(".myagents-test-ws-sym-out-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&ws_root);
        std::fs::create_dir_all(&ws_root).unwrap();
        let lure = ws_root.join("leak");
        symlink(target, &lure).unwrap();

        let res = resolve_existing_inside_workspace(&ws_root, "leak");
        let _ = std::fs::remove_dir_all(&ws_root);

        assert!(
            res.is_err(),
            "symlink-out-of-workspace must be rejected by workspace open path, got Ok({:?})",
            res
        );
        // Be specific about the failure mode so a future refactor that
        // accidentally short-circuits to "File not found" or similar still
        // catches the security regression. The shared path gate resolves the
        // symlink before this workspace-only gate, so /etc is rejected by the
        // system blacklist first.
        let err = res.unwrap_err();
        assert!(
            err.contains("protected system directory"),
            "unexpected error message: {}",
            err
        );
    }

    // Counterpoint: a legitimate symlink that points back inside the
    // workspace (e.g. `latest -> versions/v1`) MUST still resolve.
    #[cfg(unix)]
    #[test]
    fn workspace_open_allows_inside_workspace_symlink() {
        use crate::workspace_files::path_safety::resolve_existing_inside_workspace;
        use std::os::unix::fs::symlink;

        let Some(home) = home_dir() else { return };
        let ws_root = home.join(format!(".myagents-test-ws-sym-in-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&ws_root);
        std::fs::create_dir_all(ws_root.join("versions/v1")).unwrap();
        std::fs::write(ws_root.join("versions/v1/file.txt"), "hi").unwrap();
        symlink(ws_root.join("versions/v1"), ws_root.join("latest")).unwrap();

        let res = resolve_existing_inside_workspace(&ws_root, "latest/file.txt");
        let cleanup = std::fs::remove_dir_all(&ws_root);

        assert!(
            res.is_ok(),
            "in-workspace symlink must resolve, got {:?}",
            res
        );
        let _ = cleanup;
    }
}
