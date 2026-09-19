//! Cross-platform wake-lock to prevent idle sleep during long-running tasks.
//!
//! Cron tasks (especially long-running ones like `/issue-triage`) can stall
//! when the host enters idle sleep: TCP streams to the Anthropic API die,
//! the SDK never detects the dead socket, and the 10-minute watchdog kills
//! the turn. Real incident: 2026-05-19 19:11–19:26, see
//! `~/.myagents/logs/unified-2026-05-19.log`.
//!
//! ## What this prevents
//!
//! Only **idle sleep** — the OS deciding the user is idle and putting the
//! machine to sleep on its own. User-initiated sleep (closing the lid,
//! pressing the power button, choosing Sleep from the menu) is **not**
//! blockable on any of the three platforms without elevated privileges,
//! and we don't try.
//!
//! ## Per-platform behavior
//!
//! | Platform | Mechanism | Limit |
//! |----------|-----------|-------|
//! | macOS    | `IOPMAssertionCreateWithName` with `kIOPMAssertionTypePreventUserIdleSystemSleep` | Lid close still sleeps |
//! | Windows  | `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED \| ES_AWAYMODE_REQUIRED)` | Power Plan lid setting wins |
//! | Linux    | `systemd-inhibit --what=idle:sleep --mode=block <holder>` child | Requires systemd-logind; otherwise no-op |
//! | other    | No-op | — |
//!
//! ## Usage
//!
//! ```rust,ignore
//! use crate::wake_lock::WakeLock;
//!
//! async fn run_cron(task: &CronTask) {
//!     let _lock = WakeLock::acquire(&format!("cron task {}", task.id)).ok();
//!     // _lock is dropped at end of scope, releasing the assertion.
//!     do_work().await;
//! }
//! ```
//!
//! `.ok()` is intentional — wake-lock failure should never abort the caller.
//! A non-acquired lock is functionally identical to "just running without
//! wake-lock", which is what we had before this module.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux::PlatformImpl;
#[cfg(target_os = "macos")]
use macos::PlatformImpl;
#[cfg(target_os = "windows")]
use windows::PlatformImpl;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod noop {
    pub struct PlatformImpl;
    impl PlatformImpl {
        pub fn acquire(_reason: &str) -> Result<Self, String> {
            Ok(Self)
        }
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
use noop::PlatformImpl;

/// RAII handle to a system-level "stay awake" assertion.
///
/// Hold an instance for as long as the wake-lock should be active. Drop
/// releases it automatically. Cloning is not supported — multiple
/// concurrent holders should each call [`acquire`](Self::acquire).
pub struct WakeLock {
    // Underscore-prefixed because the value's role is its Drop side effect,
    // not anything the caller reads. Suppresses the unused-field warning
    // on platforms whose impl is zero-sized.
    #[allow(dead_code)]
    _inner: PlatformImpl,
}

impl WakeLock {
    /// Acquire a wake-lock. `reason` is a human-readable string surfaced
    /// to the OS (visible in `pmset -g assertions` on macOS, etc.).
    pub fn acquire(reason: &str) -> Result<Self, String> {
        let inner = PlatformImpl::acquire(reason)?;
        Ok(Self { _inner: inner })
    }
}

// ─── PRD 0.2.35 · Global "always-on" force wake-lock ───────────────────────
//
// In addition to the smart-mode wake-lock (sidecar.rs polls session state,
// cron_task.rs holds per-task), the user can flip a single config switch
// (`AppConfig.forceWakeLock`) that acquires a **process-lifetime** lock —
// no idle-sleep regardless of whether the AI is busy. Surfaces: the Settings
// toggle and the tray CheckMenuItem; both share `cmd_set_force_wake_lock` so
// disk / OS lock / tray check / emit happen atomically (PRD D2 / §3.3).
//
// Failure to acquire is non-fatal: persist the intent, log the reason, the
// next start may succeed (PRD §7 open Q · adopted resolution).

use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::utils::bom::strip_bom;
use crate::{ulog_debug, ulog_info, ulog_warn};

/// Process-wide handle to the user-facing force wake-lock. `None` =智能模式
/// (default); `Some(_)` = a `PreventUserIdleSystemSleep` assertion is held
/// for the lifetime of the process or until the user flips the switch off.
/// Registered via `app.manage(ForceWakeLockState::default())`.
pub struct ForceWakeLockState(pub Mutex<Option<WakeLock>>);

impl Default for ForceWakeLockState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// Partial config view (mirrors `PartialAppConfig` in `tray.rs`). We only need
/// one field; deserializing the full schema would couple wake_lock to
/// renderer-side type evolution.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PartialForceWakeLockConfig {
    force_wake_lock: Option<bool>,
}

/// Read `forceWakeLock` from `config.json` at `config_path`. Pure
/// (path-injected) so tests don't need to override the user data dir.
/// Defaults to `false` when the field is absent / file unreadable /
/// root is not a JSON object — every "I don't know" outcome biases
/// toward the safer (don't-hold-a-lock) default.
fn read_force_wake_lock_from(config_path: &std::path::Path) -> bool {
    let content = match std::fs::read_to_string(config_path) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let cfg: PartialForceWakeLockConfig = match serde_json::from_str(strip_bom(&content)) {
        Ok(c) => c,
        Err(_) => return false,
    };
    cfg.force_wake_lock.unwrap_or(false)
}

/// Read `~/.myagents/config.json` for `forceWakeLock`. Defaults to `false`
/// when the field is absent / file unreadable / JSON malformed. **Disk-first,
/// never cached** — both startup boot and the tray initial-state lookup go
/// through this single function. Mirrors `tray::should_minimize_to_tray()`.
pub fn should_force_wake_lock() -> bool {
    if let Some(dir) = crate::app_dirs::myagents_data_dir() {
        let v = read_force_wake_lock_from(&dir.join("config.json"));
        ulog_debug!("[force-wake-lock] disk: forceWakeLock={}", v);
        return v;
    }
    ulog_debug!("[force-wake-lock] disk: data dir unresolved, default false");
    false
}

/// Mutate `guard` (already locked) to match `enabled`. Idempotent. Failure
/// to acquire is logged and swallowed — see module comment.
///
/// Takes a `&mut Option<WakeLock>` instead of the state so the caller controls
/// the lock scope; this lets `apply_force_wake_lock` hold one guard across
/// all four mirror updates and stay atomic under concurrent invocations
/// (codex review BLOCKING #2, 2026-06-13). Releasing between steps would let
/// two callers interleave to leave state/disk/tray/UI disagreeing.
fn toggle_lock_inner(guard: &mut Option<WakeLock>, enabled: bool) {
    match (enabled, guard.is_some()) {
        (true, false) => match WakeLock::acquire("MyAgents force wake-lock") {
            Ok(lock) => {
                *guard = Some(lock);
                ulog_info!("[force-wake-lock] acquired (user opted in)");
            }
            Err(e) => {
                // PRD §7: keep user intent on disk, surface failure in logs.
                // No watchdog — next process start will try again from disk.
                ulog_warn!(
                    "[force-wake-lock] acquire failed: {} — UI shows on but no protection held",
                    e
                );
            }
        },
        (false, true) => {
            *guard = None; // Drop releases the OS assertion
            ulog_info!("[force-wake-lock] released (user opted out)");
        }
        _ => {}
    }
}

/// Persist `forceWakeLock` to `config.json` under `with_config_lock` (red-line:
/// the only sanctioned reader/modifier/writer for this file). Tolerates the
/// rare case where `config.json` exists but is not a JSON object root.
fn persist_to_disk(value: bool) -> Result<(), String> {
    let dir = crate::app_dirs::myagents_data_dir()
        .ok_or_else(|| "[force-wake-lock] cannot resolve data dir".to_string())?;
    let config_path = dir.join("config.json");
    crate::config_io::with_config_lock(&config_path, false, |cfg| {
        // If root isn't an object (e.g. empty file or corrupted), reset to {}.
        if !cfg.is_object() {
            *cfg = serde_json::json!({});
        }
        let obj = cfg
            .as_object_mut()
            .expect("just normalized to object above");
        obj.insert("forceWakeLock".to_string(), serde_json::Value::Bool(value));
        Ok(())
    })
    .map(|_| ())
}

/// Apply a new value: switch the OS lock, persist to disk, sync tray check,
/// emit `force-wake-lock-changed`. Single source of truth for both
/// `cmd_set_force_wake_lock` (settings page) and the tray on_menu_event branch
/// (D2). Sync — call from `spawn_blocking` if you're already in async land.
///
/// **Atomicity (codex review BLOCKING #2)**: holds `ForceWakeLockState` mutex
/// across ALL four mirror updates. Without this, two concurrent on/off
/// callers can interleave to leave OS-state / disk / tray / UI disagreeing
/// (e.g. disk=`true`, OS lock=`None`). `with_config_lock` only serializes the
/// disk write, not the cross-mirror sequence. We accept the cost of
/// per-toggle serialization because user toggles are inherently low-rate.
///
/// Each side-effect logs and swallows its own failure; we never abort the
/// chain. Reason: the user's *intent* is the durable thing; any one of the
/// four mirrors falling out of sync is recoverable next round (PRD §7).
pub fn apply_force_wake_lock(app: &AppHandle, value: bool) {
    let state = match app.try_state::<ForceWakeLockState>() {
        Some(s) => s,
        None => {
            // Should never happen post-setup — but if it does, persisting +
            // emitting still gives us a hope of correctness next start.
            ulog_warn!("[force-wake-lock] ForceWakeLockState not registered; OS toggle skipped");
            if let Err(e) = persist_to_disk(value) {
                ulog_warn!("[force-wake-lock] persist failed: {e}");
            }
            if let Err(e) = app.emit("force-wake-lock-changed", value) {
                ulog_warn!("[force-wake-lock] emit failed: {e}");
            }
            return;
        }
    };

    // ─── Acquire the serialization lock; hold across all four steps. ─────
    // PoisonError: previous panic during a toggle leaves the OS lock indeterminate,
    // but Option<WakeLock> recovery is fine — we'd rather press on than refuse
    // forever. Drop of any half-acquired WakeLock already happened via unwind.
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());

    // 1) OS lock — primary effect.
    toggle_lock_inner(&mut guard, value);

    // 2) Persist user intent (disk-first; `with_config_lock` reads → mutates → atomic rename).
    if let Err(e) = persist_to_disk(value) {
        ulog_warn!("[force-wake-lock] persist failed: {e}");
    }

    // 3) Sync tray CheckMenuItem. `set_checked` internally marshals to main
    //    thread via `run_item_main_thread!` (Tauri 2.11), so it's safe to call
    //    from any thread — confirmed by reading tauri::menu::check.rs:134.
    if let Some(handles) = app.try_state::<crate::tray::TrayMenuHandles>() {
        if let Err(e) = handles.force_wake_lock.set_checked(value) {
            ulog_warn!("[force-wake-lock] tray set_checked failed: {e}");
        }
    }

    // 4) Notify renderer. ConfigProvider subscribes; Settings.tsx UI follows.
    if let Err(e) = app.emit("force-wake-lock-changed", value) {
        ulog_warn!("[force-wake-lock] emit failed: {e}");
    }

    ulog_debug!("[force-wake-lock] state synchronized to {}", value);
    // guard drops here, releasing the serialization mutex
}

/// Boot-time initialize: read disk, acquire OS lock if needed. Does **not**
/// write disk or emit — we're hydrating from the truth, not changing it. The
/// tray's initial `checked` state is set independently by `setup_tray` reading
/// the same `should_force_wake_lock()`, so both surfaces stay coherent.
pub fn init_from_disk(app: &AppHandle) {
    let value = should_force_wake_lock();
    if value {
        if let Some(state) = app.try_state::<ForceWakeLockState>() {
            let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
            toggle_lock_inner(&mut guard, true);
        }
    }
    ulog_info!("[force-wake-lock] boot hydration: value={}", value);
}

/// Tauri command. Called by Settings.tsx (via ConfigProvider's `updateConfig`
/// specialization for `forceWakeLock`) and — indirectly — by the tray
/// CheckMenuItem (which calls `apply_force_wake_lock` directly without going
/// through invoke, since on_menu_event already runs in-process).
#[tauri::command]
pub async fn cmd_set_force_wake_lock(app: AppHandle, value: bool) -> Result<(), String> {
    // with_config_lock holds an OS file lock + does sync fs::rename; even
    // though our writes are small, route through spawn_blocking so the async
    // runtime's worker doesn't stall on a contended config write.
    tauri::async_runtime::spawn_blocking(move || apply_force_wake_lock(&app, value))
        .await
        .map_err(|e| format!("[force-wake-lock] task join: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test: acquire + drop should not crash on any supported
    /// platform. Does not assert the OS-level effect (that requires
    /// `pmset -g assertions` on macOS, `powercfg /requests` on Windows,
    /// `systemd-inhibit --list` on Linux — out of scope for cargo test).
    #[test]
    fn acquire_and_release_smoke() {
        let lock = WakeLock::acquire("cargo test smoke")
            .expect("acquire should succeed on a healthy platform");
        // Drop point: explicit so the test name reads top-to-bottom.
        drop(lock);
    }

    /// Holding two locks concurrently must not interfere — each gets its
    /// own assertion / inhibit handle and releases independently.
    #[test]
    fn multiple_concurrent_locks() {
        let a = WakeLock::acquire("smoke A").expect("A");
        let b = WakeLock::acquire("smoke B").expect("B");
        drop(a);
        drop(b);
    }

    // ─── PRD 0.2.35 · should_force_wake_lock disk-read covenant ─────────────
    //
    // The public `should_force_wake_lock()` reads `~/.myagents/config.json`,
    // which can't be redirected per-test. We exercise the inner
    // `read_force_wake_lock_from(path)` against tempfiles to lock down the
    // three cases the PRD specifies + the BOM / corruption tolerances every
    // disk-first config reader must honor.

    use std::io::Write;

    fn write_tmp(name: &str, body: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "myagents_force_wl_test_{}_{}.json",
            std::process::id(),
            name
        ));
        let mut f = std::fs::File::create(&path).expect("tmp create");
        f.write_all(body).expect("tmp write");
        path
    }

    #[test]
    fn force_wake_lock_true_when_field_is_true() {
        let p = write_tmp("true", b"{\"forceWakeLock\":true,\"theme\":\"system\"}");
        assert!(read_force_wake_lock_from(&p));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn force_wake_lock_false_when_field_is_false() {
        let p = write_tmp("false", b"{\"forceWakeLock\":false}");
        assert!(!read_force_wake_lock_from(&p));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn force_wake_lock_default_false_when_field_missing() {
        // Field absent — default `false` (PRD: bias toward safer "don't hold
        // a lock" when intent is undeclared).
        let p = write_tmp("missing", b"{\"theme\":\"dark\"}");
        assert!(!read_force_wake_lock_from(&p));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn force_wake_lock_default_false_when_file_missing() {
        // Path doesn't exist (first-launch on a fresh machine).
        let p = std::env::temp_dir().join(format!(
            "myagents_force_wl_test_nonexistent_{}.json",
            std::process::id()
        ));
        if p.exists() {
            std::fs::remove_file(&p).ok();
        }
        assert!(!read_force_wake_lock_from(&p));
    }

    #[test]
    fn force_wake_lock_default_false_when_malformed_json() {
        // A corrupted config.json must NOT crash startup. The migration /
        // self-heal path elsewhere will rewrite the file; we default to off.
        let p = write_tmp("malformed", b"{not valid json");
        assert!(!read_force_wake_lock_from(&p));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn force_wake_lock_tolerates_utf8_bom() {
        // Same BOM tolerance as config_io::read_config_json — Windows editors
        // prepend U+FEFF on save and we must not regress to "field missing".
        let p = write_tmp("bom", b"\xEF\xBB\xBF{\"forceWakeLock\":true}");
        assert!(read_force_wake_lock_from(&p));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn force_wake_lock_default_false_when_root_is_array() {
        // Valid JSON but non-object root (`[]`, `null`) — serde rejects the
        // struct deserialize, we fall back to `false` (codex review
        // NON-BLOCKING #2).
        let p = write_tmp("arr", b"[]");
        assert!(!read_force_wake_lock_from(&p));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn force_wake_lock_default_false_when_root_is_null() {
        let p = write_tmp("null", b"null");
        assert!(!read_force_wake_lock_from(&p));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn force_wake_lock_default_false_when_field_wrong_type() {
        // Externally-edited config can put "true" (string) instead of true.
        // Strict type ⇒ reject ⇒ default false. Safer than coercing.
        let p = write_tmp("wrongtype", b"{\"forceWakeLock\":\"true\"}");
        assert!(!read_force_wake_lock_from(&p));
        std::fs::remove_file(&p).ok();
    }
}
