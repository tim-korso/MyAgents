//! Explicit, ignored native-account smoke. This is not an application bypass:
//! it runs the unmodified upstream binary in a temporary test-owned directory.
use super::{callback, process::Instance};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::{path::Path, process::Stdio, time::Duration};

#[tokio::test]
#[ignore = "Requires an explicitly selected source-verified native CLIProxy executable; no account or browser"]
async fn native_process_management_contract() {
    let executable = std::env::var("MYAGENTS_CLIPROXY_SMOKE_EXECUTABLE")
        .expect("Set the verified native executable path");
    let scratch = tempfile::tempdir().unwrap();
    let (_cancel, cancelled) = tokio::sync::watch::channel(false);
    let instance = Instance::spawn(
        Path::new(&executable),
        &scratch.path().join("auth"),
        &scratch.path().join("run"),
        &uuid::Uuid::new_v4().to_string(),
        "native-process-contract",
    )
    .unwrap();
    let result = async {
        instance.wait_ready(cancelled).await?;
        assert!(instance.ready());
        assert!(instance.client.account().await?.is_none());
        assert!(instance.client.routed_models().await?.is_empty());
        assert!(!instance.client.definitions().await?.is_empty());
        Ok::<_, super::types::Error>(())
    }
    .await;
    instance.stop().await.unwrap();
    assert!(!instance.alive());
    assert_eq!(
        std::fs::read_dir(scratch.path().join("run"))
            .unwrap()
            .count(),
        0
    );
    result.unwrap();
}

#[tokio::test]
#[ignore = "Opens the system browser and requires an explicitly selected real Google account"]
async fn native_account_sdk_tool_and_history_contract() {
    let executable = std::env::var("MYAGENTS_CLIPROXY_SMOKE_EXECUTABLE")
        .expect("Set MYAGENTS_CLIPROXY_SMOKE_EXECUTABLE to the source-verified upstream binary");
    let scratch = tempfile::tempdir().unwrap();
    let callback = callback::Receiver::bind().await.unwrap();
    let (_cancel, cancelled) = tokio::sync::watch::channel(false);
    let instance = Instance::start(
        Path::new(&executable),
        &scratch.path().join("auth"),
        &scratch.path().join("run"),
        &uuid::Uuid::new_v4().to_string(),
        "credentialed-native-harness",
        cancelled.clone(),
    )
    .await
    .unwrap();
    let result = async {
        let authorization = instance.client.auth_url().await.outcome?;
        callback::validate_authorization_url(&authorization.url, &authorization.state)?;
        crate::browser::open_external(&authorization.url).map_err(|_| super::types::Error::new("browser", "Browser could not open"))?;
        eprintln!("CLIProxy account smoke: finish Google authorization in your browser (5 minutes).");
        let returned = callback.receive(&authorization.state, cancelled.clone()).await?;
        super::manager::finish_oauth(&instance.client, &authorization.state, returned, std::time::Instant::now(),
            std::time::Instant::now() + Duration::from_secs(60),
            cancelled.clone(), "credentialed-smoke").await?;
        let account = instance.client.account().await?.ok_or_else(super::types::Error::contract)?;
        let registered = instance.client.registered_models(&account.name).await?;
        let routed = instance.client.routed_models().await?;
        let requested = std::env::var("MYAGENTS_CLIPROXY_SMOKE_MODEL").ok();
        let model = routed.iter().find(|id| requested.as_ref().is_none_or(|requested| requested == *id)
            && registered.iter().any(|m| m["id"].as_str() == Some(id.as_str())))
            .ok_or_else(|| super::types::Error::new("models", "No matching account model"))?;
        let mut command = crate::process_cmd::new("node");
        command.arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/verify-cliproxy-sdk.mjs"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = crate::process_cmd::spawn_tree(&mut command).map_err(|_| super::types::Error::contract())?;
        let payload = serde_json::to_vec(&serde_json::json!({ "baseUrl": instance.client.base_url(), "apiKey": instance.client.model_key(),
            "model": model, "thinking": std::env::var("MYAGENTS_CLIPROXY_SMOKE_THINKING").as_deref() == Ok("1") })).unwrap();
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(&payload).map_err(|_| super::types::Error::contract())?;
        drop(stdin);
        let stdout = child.stdout.take().unwrap();
        let child = Arc::new(Mutex::new(child));
        let reading = tauri::async_runtime::spawn_blocking(move || {
            let mut bytes = Vec::new(); stdout.take(16 * 1024 + 1).read_to_end(&mut bytes).map(|_| bytes)
        });
        let read = tokio::time::timeout(Duration::from_secs(200), reading).await;
        let retained = Arc::clone(&child);
        tauri::async_runtime::spawn_blocking(move || crate::process_cmd::settle_tree(&retained, Duration::from_secs(1))).await
            .map_err(|_| super::types::Error::contract())?.map_err(|_| super::types::Error::contract())?;
        let bytes = read.map_err(|_| super::types::Error::new("sdk_timeout", "SDK test did not finish"))?
            .map_err(|_| super::types::Error::contract())?.map_err(|_| super::types::Error::contract())?;
        if bytes.len() > 16 * 1024 { return Err(super::types::Error::contract()); }
        let report: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| super::types::Error::contract())?;
        if report["success"] != true { return Err(super::types::Error::new("sdk", "SDK tool/history contract failed")); }
        eprintln!("CLIProxy SDK evidence: {}", report);
        Ok::<_, super::types::Error>(())
    }.await;
    instance.stop().await.unwrap();
    result.unwrap();
}
