//! App-owned CLIProxy component and Antigravity account lifecycle.
//! Required reading before changes: specs/tech_docs/managed_cliproxy.md.
mod callback;
mod client;
mod component;
#[cfg(test)]
mod credentialed;
mod manager;
mod manifest;
mod models;
mod operations;
#[cfg(test)]
mod oauth_tests;
mod process;
mod store;
pub mod types;

use manager::CliProxyManager;
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use types::{Error, Result};

// Construction failure is a completed result, not an indefinitely pending boot.
static MANAGER: OnceLock<Result<Arc<CliProxyManager>>> = OnceLock::new();

pub(crate) fn initialize(app: tauri::AppHandle, had_prior_instance: bool) {
    if manifest::platform().is_none() {
        return;
    }
    if MANAGER.set(CliProxyManager::new(app)).is_err() {
        return;
    }
    let manager = match manager() {
        Ok(manager) => Arc::clone(manager),
        Err(error) => {
            crate::ulog_warn!("[cliproxy] initialize failed code={} reason={}", error.code, error.message);
            return;
        }
    };
    tauri::async_runtime::spawn(async move {
        if let Err(error) = manager.initialize_serialized(had_prior_instance).await {
            manager.set_error(error).await;
        } else if let Err(error) = manager.prewarm().await {
            manager.set_error(error).await;
        }
        loop {
            let _ = manager.check_updates(false).await;
            if !manager
                .wait_for_next_update(Duration::from_secs(15 * 60))
                .await
            {
                break;
            }
        }
    });
}

fn manager() -> Result<&'static Arc<CliProxyManager>> {
    initialized_manager(&MANAGER)
}

fn initialized_manager(slot: &OnceLock<Result<Arc<CliProxyManager>>>) -> Result<&Arc<CliProxyManager>> {
    slot
        .get()
        .ok_or_else(|| Error::new("initializing", "模型组件尚未初始化"))
        .and_then(|result| result.as_ref().map_err(Clone::clone))
}

pub(crate) async fn acquire_binding(
    request: types::BindingRequest,
    generation: u64,
) -> Result<types::Binding> {
    manager()?.acquire(request, generation).await
}
pub(crate) async fn check_binding(request: types::LeaseRequest, generation: u64) -> Result<()> {
    manager()?.check_lease(&request, generation).await
}
pub(crate) async fn release_binding(request: types::LeaseRequest, generation: u64) -> Result<()> {
    manager()?.release(&request, generation).await
}
pub(crate) async fn reconcile_sidecar_deaths() {
    if let Some(Ok(manager)) = MANAGER.get() {
        manager.reconcile_dead_leases().await;
    }
}
pub(crate) fn reconcile_proxy() {
    if let Some(Ok(manager)) = MANAGER.get() {
        manager.schedule_proxy_reconcile();
    }
}
pub(crate) async fn shutdown() -> Result<()> {
    if let Some(Ok(manager)) = MANAGER.get() {
        manager.shutdown().await?;
    }
    Ok(())
}

pub(crate) async fn quiesce_for_update() -> Result<()> {
    if let Some(Ok(manager)) = MANAGER.get() {
        manager.quiesce_for_update().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn cmd_cliproxy_status() -> Result<Value> {
    Ok(manager()?.status().await)
}
#[tauri::command]
pub async fn cmd_cliproxy_connect() -> Result<Value> {
    manager()?.connect().await
}
#[tauri::command]
pub async fn cmd_cliproxy_cancel(attempt_id: String) -> Result<Value> {
    manager()?.cancel(&attempt_id).await
}
#[tauri::command]
pub async fn cmd_cliproxy_disconnect() -> Result<Value> {
    manager()?.disconnect().await
}
#[tauri::command]
pub async fn cmd_cliproxy_retry_cleanup() -> Result<Value> {
    manager()?.retry_cleanup().await
}
#[tauri::command]
pub async fn cmd_cliproxy_models(account_generation: String) -> Result<Vec<Value>> {
    manager()?.refresh(&account_generation).await
}
#[tauri::command]
pub async fn cmd_cliproxy_check_update() -> Result<Value> {
    manager()?.check_updates(true).await?;
    Ok(manager()?.status().await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn construction_failure_is_not_reported_as_pending_initialization() {
        let slot = OnceLock::new();
        assert!(slot.set(Err(Error::new("state_format", "Invalid component state"))).is_ok());
        let error = initialized_manager(&slot).err().unwrap();
        assert_eq!(error.code, "state_format");
        assert_eq!(error.message, "Invalid component state");
    }
}
