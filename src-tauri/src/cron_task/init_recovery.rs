use super::*;

/// Startup convergence order: migrate the read-only legacy store first, then
/// rebuild the only live timer set from TaskStore.
pub async fn initialize_cron_manager(handle: AppHandle) {
    // Hidden memory maintenance tasks invoke versioned system skills by exact
    // name. Land that snapshot before rebuilding any running task timers. The
    // renderer may request the same convergence, but both callers join the
    // single Rust-owned system-skill transaction.
    if let Err(error) = crate::commands::sync_system_skills_for_startup(handle.clone()).await {
        // Scheduler recovery still proceeds for unrelated user tasks. Every
        // memory-maintenance turn also verifies the exact official workspace
        // exposure at Runtime dispatch, so packaging/disk failure cannot fall
        // back to model improvisation.
        ulog_error!(
            "[system-skills] startup sync failed before task recovery: {}",
            error
        );
    }

    if let Err(error) = crate::legacy_upgrade::migrate_legacy_crons_on_startup().await {
        ulog_error!("[legacy-cron] startup migration failed: {}", error);
    }

    crate::task_scheduler::get_task_scheduler()
        .initialize(handle.clone())
        .await;
    if let Err(error) =
        crate::memory_auto_update::reconcile_memory_auto_update_tasks_from_disk().await
    {
        ulog_warn!(
            "[memory-auto-update] startup disk-first reconcile failed: {}",
            error
        );
    }
    let _ = handle.emit("cron:manager-ready", serde_json::json!({}));
    ulog_info!("[task-scheduler] startup recovery complete");
}
