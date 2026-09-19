use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
#[cfg(not(test))]
use serde_json::json;
use serde_json::Value;
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

#[cfg(not(test))]
use crate::utils::file_lock::with_file_lock_blocking;
use crate::utils::file_lock::{with_file_lock, FileLockError, FileLockOptions};

use super::oauth::{
    self, account_summary_from_id_token, choose_verification_model, discover_endpoints,
    fetch_models, grant_from_token_response, poll_device_token, request_device_code,
    token_needs_refresh, DevicePollOutcome,
};
use super::store::{
    auth_lock_path, auth_store_path, quarantine_corrupt_store, read_store, write_store_atomic,
    GrokCredentialStore, GrokGrant, ValidatedOauthEndpoints,
};
#[cfg(not(test))]
use super::types::XAI_SUBSCRIPTION_PROVIDER_ID;
use super::types::{
    GrokAccountSummary, GrokAuthError, GrokAuthErrorCode, GrokAuthStatus, GrokDeviceLoginView,
    GrokVerificationResult, ResolveBearerPurpose, ResolveBearerReason, ResolvedBearer,
};

const LOGIN_SESSION_RETENTION_SECONDS: i64 = 15 * 60;

#[derive(Debug, Clone)]
struct DeviceLoginSession {
    session_id: String,
    status: String,
    user_code: Option<String>,
    verification_uri: Option<String>,
    verification_uri_complete: Option<String>,
    device_code: String,
    endpoints: ValidatedOauthEndpoints,
    expires_at: i64,
    poll_interval_seconds: u64,
    account: Option<GrokAccountSummary>,
    error: Option<GrokAuthError>,
    cancel: watch::Sender<bool>,
    credential_version: Option<u64>,
    completed_at: Option<i64>,
}

impl DeviceLoginSession {
    fn view(&self) -> GrokDeviceLoginView {
        GrokDeviceLoginView {
            session_id: self.session_id.clone(),
            status: self.status.clone(),
            user_code: self.user_code.clone(),
            verification_uri: self.verification_uri.clone(),
            verification_uri_complete: self.verification_uri_complete.clone(),
            expires_at: self.expires_at,
            poll_interval_seconds: self.poll_interval_seconds,
            account: self.account.clone(),
            error: self.error.clone(),
        }
    }

    fn is_active(&self) -> bool {
        matches!(self.status.as_str(), "starting" | "waiting" | "validating")
    }
}

pub struct GrokAuthManager {
    store_path: PathBuf,
    login_sessions: Mutex<HashMap<String, DeviceLoginSession>>,
    login_start_gate: Mutex<()>,
    refresh_gate: Mutex<()>,
    grant_commit_gate: Mutex<()>,
    auth_epoch: AtomicU64,
}

impl GrokAuthManager {
    pub fn new() -> Result<Self, GrokAuthError> {
        Ok(Self::with_store_path(auth_store_path()?))
    }

    fn with_store_path(store_path: PathBuf) -> Self {
        Self {
            store_path,
            login_sessions: Mutex::new(HashMap::new()),
            login_start_gate: Mutex::new(()),
            refresh_gate: Mutex::new(()),
            grant_commit_gate: Mutex::new(()),
            auth_epoch: AtomicU64::new(1),
        }
    }

    pub async fn reconcile_projection(&self) {
        match self.load_store_safely().await {
            Ok(_) => {
                if let Err(error) = persist_provider_projection().await {
                    crate::ulog_warn!(
                        "[grok-auth] failed to reconcile provider projection error={}",
                        error
                    );
                }
            }
            Err(error) => crate::ulog_warn!(
                "[grok-auth] failed to reconcile credential state error={}",
                error
            ),
        }
    }

    pub async fn start_device_login(
        self: &Arc<Self>,
    ) -> Result<GrokDeviceLoginView, GrokAuthError> {
        let _start_guard = self.login_start_gate.lock().await;
        let start_epoch = self.auth_epoch.load(Ordering::Acquire);
        self.prune_login_sessions().await;
        if let Some(existing) = self
            .login_sessions
            .lock()
            .await
            .values()
            .find(|session| session.is_active())
            .map(DeviceLoginSession::view)
        {
            return Ok(existing);
        }

        let client = oauth::build_async_client()?;
        let endpoints = discover_endpoints(&client).await?;
        let device = request_device_code(&client).await?;
        let session_id = Uuid::new_v4().to_string();
        let expires_at = Utc::now()
            .timestamp()
            .saturating_add(i64::try_from(device.expires_in).unwrap_or(i64::MAX));
        let poll_interval_seconds = device.interval.clamp(1, 30);
        let (cancel, _cancel_rx) = watch::channel(false);
        let session = DeviceLoginSession {
            session_id: session_id.clone(),
            status: "waiting".to_string(),
            user_code: Some(device.user_code),
            verification_uri: Some(device.verification_uri),
            verification_uri_complete: Some(device.verification_uri_complete),
            device_code: device.device_code,
            endpoints,
            expires_at,
            poll_interval_seconds,
            account: None,
            error: None,
            cancel,
            credential_version: None,
            completed_at: None,
        };
        let view = self
            .register_login_session_if_current(start_epoch, session)
            .await?;

        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            manager.run_device_poller(session_id).await;
        });
        Ok(view)
    }

    async fn register_login_session_if_current(
        &self,
        start_epoch: u64,
        session: DeviceLoginSession,
    ) -> Result<GrokDeviceLoginView, GrokAuthError> {
        let _commit_guard = self.grant_commit_gate.lock().await;
        if self.auth_epoch.load(Ordering::Acquire) != start_epoch {
            return Err(GrokAuthError::new(
                GrokAuthErrorCode::LoginCancelled,
                "Grok 登录已被退出操作取消",
            ));
        }
        let view = session.view();
        self.login_sessions
            .lock()
            .await
            .insert(session.session_id.clone(), session);
        Ok(view)
    }

    pub async fn get_login_status(
        &self,
        session_id: &str,
    ) -> Result<GrokDeviceLoginView, GrokAuthError> {
        self.login_sessions
            .lock()
            .await
            .get(session_id)
            .map(DeviceLoginSession::view)
            .ok_or_else(|| {
                GrokAuthError::new(
                    GrokAuthErrorCode::LoginExpired,
                    "Grok 登录会话不存在或已过期",
                )
            })
    }

    pub async fn cancel_login(&self, session_id: &str) -> Result<(), GrokAuthError> {
        let _commit_guard = self.grant_commit_gate.lock().await;
        let (cancel, grant_lineage) = {
            let mut sessions = self.login_sessions.lock().await;
            let session = sessions.get_mut(session_id).ok_or_else(|| {
                GrokAuthError::new(
                    GrokAuthErrorCode::LoginExpired,
                    "Grok 登录会话不存在或已过期",
                )
            })?;
            let was_active = session.is_active();
            if was_active {
                session.status = "cancelled".to_string();
                session.error = Some(GrokAuthError::new(
                    GrokAuthErrorCode::LoginCancelled,
                    "已取消 Grok 登录",
                ));
                session.completed_at = Some(Utc::now().timestamp());
            }
            (
                session.cancel.clone(),
                (was_active && session.credential_version.is_some())
                    .then(|| session.session_id.clone()),
            )
        };
        cancel.send_replace(true);
        if let Some(lineage) = grant_lineage {
            self.clear_grant_if_lineage(&lineage).await?;
        }
        Ok(())
    }

    pub async fn get_auth_status(&self) -> Result<GrokAuthStatus, GrokAuthError> {
        let state = self.load_store_safely().await?;
        let has_grant = state.grant.is_some() && !state.quarantined;
        let verified = has_grant
            && state.verified_at.is_some()
            && matches!(
                state.verification_state.as_deref(),
                Some("valid" | "rate_limited" | "network_error")
            );
        let effective_state = if state.quarantined {
            "auth_required"
        } else if !has_grant {
            "logged_out"
        } else {
            state.verification_state.as_deref().unwrap_or("logged_in")
        };
        Ok(GrokAuthStatus {
            state: effective_state.to_string(),
            has_grant,
            verified,
            account: state.account,
            verified_at: state.verified_at,
            last_error: state.last_auth_error,
        })
    }

    pub async fn resolve_bearer(
        &self,
        reason: ResolveBearerReason,
        rejected_credential_version: Option<u64>,
        purpose: ResolveBearerPurpose,
    ) -> Result<ResolvedBearer, GrokAuthError> {
        let state = self.load_store_safely().await?;
        let grant = grant_for_purpose(&state, &purpose)?;
        let force_refresh = reason == ResolveBearerReason::AuthRecovery
            && rejected_credential_version == Some(grant.credential_version);
        if reason == ResolveBearerReason::AuthRecovery
            && rejected_credential_version.is_some()
            && rejected_credential_version != Some(grant.credential_version)
        {
            return Ok(to_resolved_bearer(grant));
        }
        if !force_refresh && !token_needs_refresh(grant, Utc::now().timestamp()) {
            return Ok(to_resolved_bearer(grant));
        }

        let _refresh_guard = self.refresh_gate.lock().await;
        let store_path = self.store_path.clone();
        let lock_path = auth_lock_path(&store_path);
        let refresh_purpose = purpose.clone();
        let result = with_file_lock(&lock_path, auth_file_lock_options(), move || {
            let mut fresh = read_store(&store_path).map_err(lock_io_error)?;
            let current = grant_for_purpose(&fresh, &refresh_purpose)
                .map_err(lock_io_error)?
                .clone();
            let version_changed = rejected_credential_version
                .map(|version| version != current.credential_version)
                .unwrap_or(false);
            let force = reason == ResolveBearerReason::AuthRecovery && !version_changed;
            if !force && !token_needs_refresh(&current, Utc::now().timestamp()) {
                return Ok((fresh, current));
            }

            match oauth::refresh_grant_blocking(&current) {
                Ok(mut refreshed) => {
                    let next_version = fresh
                        .next_credential_version
                        .max(current.credential_version.saturating_add(1));
                    refreshed.credential_version = next_version;
                    fresh.next_credential_version = next_version.saturating_add(1);
                    fresh.grant = Some(refreshed.clone());
                    fresh.quarantined = false;
                    fresh.last_auth_error = None;
                    write_store_atomic(&store_path, &fresh).map_err(lock_io_error)?;
                    Ok((fresh, refreshed))
                }
                Err(error) if error.code == GrokAuthErrorCode::AuthRequired => {
                    fresh.grant = None;
                    fresh.quarantined = true;
                    fresh.verification_state = Some("auth_required".to_string());
                    fresh.last_auth_error = Some(error.clone());
                    write_store_atomic(&store_path, &fresh).map_err(lock_io_error)?;
                    Err(lock_io_error(error))
                }
                Err(error) if error.code == GrokAuthErrorCode::EntitlementRequired => {
                    if let Some(grant) = fresh.grant.as_mut() {
                        // Keep the bearer but disable repeated proactive refresh.
                        // A later explicit verification or 401 recovery can retry.
                        grant.expires_at = None;
                        grant.expires_in = None;
                    }
                    fresh.verification_state = Some("entitlement_required".to_string());
                    fresh.last_auth_error = Some(error.clone());
                    write_store_atomic(&store_path, &fresh).map_err(lock_io_error)?;
                    Err(lock_io_error(error))
                }
                Err(error) => Err(lock_io_error(error)),
            }
        })
        .await;

        match result {
            Ok((_, grant)) => {
                persist_provider_projection().await?;
                Ok(to_resolved_bearer(&grant))
            }
            Err(error) => {
                let auth_error = from_file_lock_error(error);
                if self.load_store_safely().await.is_ok() {
                    let _ = persist_provider_projection().await;
                }
                Err(auth_error)
            }
        }
    }

    pub async fn reject_credential_version(
        &self,
        credential_version: u64,
    ) -> Result<(), GrokAuthError> {
        self.quarantine_if_version(
            credential_version,
            GrokAuthError::new(
                GrokAuthErrorCode::AuthRequired,
                "Grok 登录已失效，请重新登录",
            ),
        )
        .await
    }

    pub async fn record_upstream_outcome(
        &self,
        credential_version: u64,
        http_status: u16,
    ) -> Result<(), GrokAuthError> {
        match http_status {
            // A 2xx response header is not a completed SDK/translator result.
            // First-time verification is committed only by
            // finalize_bridge_verification after the one-shot SDK path wins.
            200..=299 => Ok(()),
            403 => {
                self.record_verification_error(
                    GrokAuthError::http(
                        GrokAuthErrorCode::EntitlementRequired,
                        403,
                        "账号已登录，但当前订阅、地区或模型不可用",
                        false,
                    ),
                    Some(credential_version),
                )
                .await
            }
            429 => {
                self.record_verification_error(
                    GrokAuthError::http(
                        GrokAuthErrorCode::RateLimited,
                        429,
                        "Grok 请求过多或当前额度不可用，请稍后再试",
                        true,
                    ),
                    Some(credential_version),
                )
                .await
            }
            500..=599 => {
                self.record_verification_error(
                    GrokAuthError::http(
                        GrokAuthErrorCode::Network,
                        http_status,
                        "Grok 服务暂时不可用",
                        true,
                    ),
                    Some(credential_version),
                )
                .await
            }
            _ => Ok(()),
        }
    }

    pub async fn fetch_models(&self) -> Result<Value, GrokAuthError> {
        match self
            .fetch_models_with_version(ResolveBearerPurpose::Execution)
            .await
        {
            Ok((value, _)) => Ok(value),
            Err((error, credential_version)) => {
                let _ = self
                    .record_verification_error(error.clone(), credential_version)
                    .await;
                Err(error)
            }
        }
    }

    async fn fetch_models_with_version(
        &self,
        purpose: ResolveBearerPurpose,
    ) -> Result<(Value, u64), (GrokAuthError, Option<u64>)> {
        let first = self
            .resolve_bearer(ResolveBearerReason::Request, None, purpose.clone())
            .await
            .map_err(|error| (error, None))?;
        let client =
            oauth::build_async_client().map_err(|error| (error, Some(first.credential_version)))?;
        match fetch_models(&client, &first.access_token).await {
            Ok(value) => Ok((value, first.credential_version)),
            Err(error) if error.code == GrokAuthErrorCode::AuthRequired => {
                let recovered = self
                    .resolve_bearer(
                        ResolveBearerReason::AuthRecovery,
                        Some(first.credential_version),
                        purpose,
                    )
                    .await
                    .map_err(|error| (error, Some(first.credential_version)))?;
                match fetch_models(&client, &recovered.access_token).await {
                    Ok(value) => Ok((value, recovered.credential_version)),
                    Err(second) if second.code == GrokAuthErrorCode::AuthRequired => {
                        self.reject_credential_version(recovered.credential_version)
                            .await
                            .map_err(|error| (error, Some(recovered.credential_version)))?;
                        Err((second, Some(recovered.credential_version)))
                    }
                    Err(second) => Err((second, Some(recovered.credential_version))),
                }
            }
            Err(error) => Err((error, Some(first.credential_version))),
        }
    }

    pub async fn prepare_verification_model(&self) -> Result<(String, String), GrokAuthError> {
        let state = self.load_store_safely().await?;
        let lineage = usable_grant(&state)?.lineage.clone();
        let purpose = ResolveBearerPurpose::Verification {
            expected_lineage: lineage.clone(),
        };
        let model = match self.fetch_models_with_version(purpose).await {
            Ok((catalog, _)) => choose_verification_model(Some(&catalog)),
            Err((error, credential_version))
                if matches!(
                    error.code,
                    GrokAuthErrorCode::AuthRequired | GrokAuthErrorCode::EntitlementRequired
                ) =>
            {
                let _ = self
                    .record_verification_error(error.clone(), credential_version)
                    .await;
                return Err(error);
            }
            Err(_) => choose_verification_model(None),
        };
        Ok((model, lineage))
    }

    pub async fn finalize_bridge_verification(
        &self,
        model: String,
        expected_lineage: String,
        bridge_success: bool,
        failure_message: Option<String>,
    ) -> GrokVerificationResult {
        let starting_state = match self.load_store_safely().await {
            Ok(state)
                if state.grant.as_ref().map(|grant| grant.lineage.as_str())
                    == Some(expected_lineage.as_str()) =>
            {
                state
            }
            Ok(_) => {
                return failed_verification(
                    GrokAuthError::new(
                        GrokAuthErrorCode::LoginUnavailable,
                        "Grok 登录账户已变化，请重新验证",
                    ),
                    Some(model),
                    None,
                )
            }
            Err(error) => return failed_verification(error, Some(model), None),
        };
        if bridge_success {
            if let Err(error) = self
                .record_verification_success_for_lineage(&expected_lineage)
                .await
            {
                return failed_verification(error, Some(model), None);
            }
        }
        if !bridge_success {
            let already_classified = matches!(
                starting_state.verification_state.as_deref(),
                Some("auth_required" | "entitlement_required" | "rate_limited" | "network_error")
            );
            if !already_classified {
                if let Some(version) = starting_state
                    .grant
                    .as_ref()
                    .map(|grant| grant.credential_version)
                {
                    let _ = self
                        .record_verification_error(
                            GrokAuthError::new(
                                GrokAuthErrorCode::InvalidResponse,
                                failure_message
                                    .clone()
                                    .unwrap_or_else(|| "Grok 验证请求失败".to_string()),
                            ),
                            Some(version),
                        )
                        .await;
                }
            }
        }

        let status = self.get_auth_status().await;
        let (store, status) = match (self.load_store_safely().await, status) {
            (Ok(store), Ok(status)) => (store, status),
            (_, Err(error)) | (Err(error), _) => {
                return failed_verification(error, Some(model), None)
            }
        };
        let current_lineage = store.grant.as_ref().map(|grant| grant.lineage.as_str());
        if current_lineage != Some(expected_lineage.as_str()) {
            return failed_verification(
                GrokAuthError::new(
                    GrokAuthErrorCode::LoginUnavailable,
                    "Grok 登录账户已变化，请重新验证",
                ),
                Some(model),
                None,
            );
        }
        let success =
            bridge_success && status.verified && current_lineage == Some(expected_lineage.as_str());
        let error = if success {
            None
        } else {
            status.last_error.clone().or_else(|| {
                Some(GrokAuthError::new(
                    GrokAuthErrorCode::InvalidResponse,
                    failure_message
                        .unwrap_or_else(|| "Grok Responses 请求未完成验证，请重试".to_string()),
                ))
            })
        };
        let mut sessions = self.login_sessions.lock().await;
        if let Some(session) = sessions
            .get_mut(&expected_lineage)
            .filter(|session| session.is_active())
        {
            session.status = if success { "succeeded" } else { "error" }.to_string();
            session.account = status.account.clone();
            session.error = error.clone();
            session.completed_at = Some(Utc::now().timestamp());
        }
        GrokVerificationResult {
            success,
            state: status.state,
            model: Some(model),
            account: status.account,
            error,
        }
    }

    pub async fn logout(&self) -> Result<(), GrokAuthError> {
        let _commit_guard = self.grant_commit_gate.lock().await;
        self.auth_epoch.fetch_add(1, Ordering::AcqRel);
        let cancels: Vec<watch::Sender<bool>> = {
            let mut sessions = self.login_sessions.lock().await;
            sessions
                .values_mut()
                .filter(|session| session.is_active())
                .map(|session| {
                    session.status = "cancelled".to_string();
                    session.completed_at = Some(Utc::now().timestamp());
                    session.cancel.clone()
                })
                .collect()
        };
        for cancel in cancels {
            cancel.send_replace(true);
        }

        let store_path = self.store_path.clone();
        let lock_path = auth_lock_path(&store_path);
        let _state = with_file_lock(&lock_path, auth_file_lock_options(), move || {
            let current = read_store_for_replacement(&store_path)?;
            let next = GrokCredentialStore {
                next_credential_version: current.next_credential_version.saturating_add(1),
                ..GrokCredentialStore::default()
            };
            write_store_atomic(&store_path, &next).map_err(lock_io_error)?;
            Ok(next)
        })
        .await
        .map_err(from_file_lock_error)?;
        persist_provider_projection().await
    }

    async fn run_device_poller(self: Arc<Self>, session_id: String) {
        let (mut cancel, mut interval, expires_at, device_code, endpoints) = {
            let sessions = self.login_sessions.lock().await;
            let Some(session) = sessions.get(&session_id) else {
                return;
            };
            (
                session.cancel.subscribe(),
                session.poll_interval_seconds,
                session.expires_at,
                session.device_code.clone(),
                session.endpoints.clone(),
            )
        };
        let client = match oauth::build_async_client() {
            Ok(client) => client,
            Err(error) => {
                self.finish_login_error(&session_id, error).await;
                return;
            }
        };
        let mut last_transient: Option<GrokAuthError> = None;

        loop {
            if *cancel.borrow() {
                return;
            }
            if Utc::now().timestamp() >= expires_at {
                self.finish_login_error(
                    &session_id,
                    last_transient.unwrap_or_else(|| {
                        GrokAuthError::new(
                            GrokAuthErrorCode::LoginExpired,
                            "Grok 登录验证码已过期，请重新登录",
                        )
                    }),
                )
                .await;
                return;
            }
            tokio::select! {
                biased;
                changed = cancel.changed() => {
                    if changed.is_err() || *cancel.borrow() {
                        return;
                    }
                },
                _ = tokio::time::sleep(Duration::from_secs(interval)) => {}
            }

            let poll_outcome = tokio::select! {
                biased;
                changed = cancel.changed() => {
                    if changed.is_err() || *cancel.borrow() {
                        return;
                    }
                    continue;
                },
                outcome = poll_device_token(&client, &endpoints.token_endpoint, &device_code) => outcome,
            };

            match poll_outcome {
                DevicePollOutcome::Pending => {}
                DevicePollOutcome::SlowDown => interval = interval.saturating_add(1).min(30),
                DevicePollOutcome::Transient(error) => last_transient = Some(error),
                DevicePollOutcome::Denied(error) => {
                    self.finish_login_error(&session_id, error).await;
                    return;
                }
                DevicePollOutcome::Approved(token) => {
                    match self
                        .save_new_grant_for_session(&session_id, token, endpoints.clone())
                        .await
                    {
                        Ok(Some(_)) | Ok(None) => return,
                        Err(error) => {
                            self.finish_login_error(&session_id, error).await;
                            return;
                        }
                    }
                }
            }
        }
    }

    async fn save_new_grant_for_session(
        &self,
        session_id: &str,
        token: oauth::TokenResponse,
        endpoints: ValidatedOauthEndpoints,
    ) -> Result<Option<u64>, GrokAuthError> {
        let _commit_guard = self.grant_commit_gate.lock().await;
        let still_active = self
            .login_sessions
            .lock()
            .await
            .get(session_id)
            .is_some_and(DeviceLoginSession::is_active);
        if !still_active {
            return Ok(None);
        }
        let store_path = self.store_path.clone();
        let lock_path = auth_lock_path(&store_path);
        let lineage = session_id.to_string();
        let state = with_file_lock(&lock_path, auth_file_lock_options(), move || {
            let mut state = read_store_for_replacement(&store_path)?;
            let version = state.next_credential_version.max(1);
            state.next_credential_version = version.saturating_add(1);
            let grant = grant_from_token_response(token, endpoints, version, lineage);
            state.account = account_summary_from_id_token(grant.id_token.as_deref());
            state.grant = Some(grant);
            state.verified_at = None;
            state.verification_state = Some("validating".to_string());
            state.last_auth_error = None;
            state.quarantined = false;
            write_store_atomic(&store_path, &state).map_err(lock_io_error)?;
            Ok(state)
        })
        .await
        .map_err(from_file_lock_error)?;
        let version = state
            .grant
            .as_ref()
            .map(|grant| grant.credential_version)
            .ok_or_else(|| {
                GrokAuthError::new(GrokAuthErrorCode::Internal, "无法保存 Grok 登录凭据")
            })?;
        let accepted = {
            let mut sessions = self.login_sessions.lock().await;
            if let Some(session) = sessions
                .get_mut(session_id)
                .filter(|session| session.is_active())
            {
                session.status = "validating".to_string();
                session.user_code = None;
                session.credential_version = Some(version);
                true
            } else {
                false
            }
        };
        if !accepted {
            self.clear_grant_if_lineage(session_id).await?;
            return Ok(None);
        }
        persist_provider_projection().await?;
        Ok(Some(version))
    }

    async fn record_verification_success_for_lineage(
        &self,
        expected_lineage: &str,
    ) -> Result<Option<GrokAccountSummary>, GrokAuthError> {
        let store_path = self.store_path.clone();
        let lock_path = auth_lock_path(&store_path);
        let expected_lineage = expected_lineage.to_string();
        let (state, updated) = with_file_lock(&lock_path, auth_file_lock_options(), move || {
            let mut state = read_store(&store_path).map_err(lock_io_error)?;
            let grant = usable_grant(&state).map_err(lock_io_error)?;
            if grant.lineage != expected_lineage {
                return Ok((state, false));
            }
            if !matches!(state.verification_state.as_deref(), Some("valid")) {
                state.verified_at = Some(Utc::now().to_rfc3339());
                state.verification_state = Some("valid".to_string());
                state.last_auth_error = None;
                state.quarantined = false;
                write_store_atomic(&store_path, &state).map_err(lock_io_error)?;
            }
            Ok((state, true))
        })
        .await
        .map_err(from_file_lock_error)?;
        if !updated {
            return Err(GrokAuthError::new(
                GrokAuthErrorCode::LoginUnavailable,
                "Grok 登录账户已变化，请重新验证",
            ));
        }
        persist_provider_projection().await?;
        Ok(state.account)
    }

    async fn record_verification_error(
        &self,
        error: GrokAuthError,
        credential_version: Option<u64>,
    ) -> Result<(), GrokAuthError> {
        if error.code == GrokAuthErrorCode::AuthRequired {
            if let Some(version) = credential_version {
                return self.quarantine_if_version(version, error).await;
            }
            return Ok(());
        }
        let Some(credential_version) = credential_version else {
            return Ok(());
        };
        if matches!(
            error.code,
            GrokAuthErrorCode::LoginCancelled | GrokAuthErrorCode::LoginExpired
        ) {
            return Ok(());
        }
        let store_path = self.store_path.clone();
        let lock_path = auth_lock_path(&store_path);
        let verification_state = verification_state_for_error(&error).to_string();
        let _state = with_file_lock(&lock_path, auth_file_lock_options(), move || {
            let mut state = read_store(&store_path).map_err(lock_io_error)?;
            if state.grant.as_ref().map(|grant| grant.credential_version)
                != Some(credential_version)
            {
                return Ok(state);
            }
            state.verification_state = Some(verification_state);
            state.last_auth_error = Some(error);
            write_store_atomic(&store_path, &state).map_err(lock_io_error)?;
            Ok(state)
        })
        .await
        .map_err(from_file_lock_error)?;
        persist_provider_projection().await
    }

    async fn quarantine_if_version(
        &self,
        credential_version: u64,
        error: GrokAuthError,
    ) -> Result<(), GrokAuthError> {
        let store_path = self.store_path.clone();
        let lock_path = auth_lock_path(&store_path);
        let _state = with_file_lock(&lock_path, auth_file_lock_options(), move || {
            let mut state = read_store(&store_path).map_err(lock_io_error)?;
            if state.grant.as_ref().map(|grant| grant.credential_version)
                != Some(credential_version)
            {
                return Ok(state);
            }
            state.grant = None;
            state.quarantined = true;
            state.verification_state = Some("auth_required".to_string());
            state.last_auth_error = Some(error);
            write_store_atomic(&store_path, &state).map_err(lock_io_error)?;
            Ok(state)
        })
        .await
        .map_err(from_file_lock_error)?;
        persist_provider_projection().await
    }

    async fn clear_grant_if_lineage(&self, lineage: &str) -> Result<(), GrokAuthError> {
        let store_path = self.store_path.clone();
        let lock_path = auth_lock_path(&store_path);
        let lineage = lineage.to_string();
        let _state = with_file_lock(&lock_path, auth_file_lock_options(), move || {
            let mut state = read_store(&store_path).map_err(lock_io_error)?;
            if state.grant.as_ref().map(|grant| grant.lineage.as_str()) != Some(lineage.as_str()) {
                return Ok(state);
            }
            state.grant = None;
            state.account = None;
            state.verified_at = None;
            state.verification_state = None;
            state.last_auth_error = None;
            state.quarantined = false;
            state.next_credential_version = state.next_credential_version.saturating_add(1);
            write_store_atomic(&store_path, &state).map_err(lock_io_error)?;
            Ok(state)
        })
        .await
        .map_err(from_file_lock_error)?;
        persist_provider_projection().await
    }

    async fn finish_login_error(&self, session_id: &str, error: GrokAuthError) {
        let mut sessions = self.login_sessions.lock().await;
        if let Some(session) = sessions.get_mut(session_id) {
            if session.status != "cancelled" {
                session.status = if error.code == GrokAuthErrorCode::LoginExpired {
                    "expired".to_string()
                } else {
                    "error".to_string()
                };
                session.error = Some(error);
                session.completed_at = Some(Utc::now().timestamp());
            }
        }
    }

    async fn prune_login_sessions(&self) {
        let now = Utc::now().timestamp();
        self.login_sessions.lock().await.retain(|_, session| {
            session.is_active()
                || session
                    .completed_at
                    .map(|completed| {
                        now.saturating_sub(completed) < LOGIN_SESSION_RETENTION_SECONDS
                    })
                    .unwrap_or(true)
        });
    }

    async fn load_store_safely(&self) -> Result<GrokCredentialStore, GrokAuthError> {
        match read_store(&self.store_path) {
            Ok(state) => Ok(state),
            Err(error) if error.code == GrokAuthErrorCode::StoreCorrupt => {
                let store_path = self.store_path.clone();
                let lock_path = auth_lock_path(&store_path);
                let state =
                    with_file_lock(
                        &lock_path,
                        auth_file_lock_options(),
                        move || match read_store(&store_path) {
                            Ok(state) => Ok(state),
                            Err(fresh_error)
                                if fresh_error.code == GrokAuthErrorCode::StoreCorrupt =>
                            {
                                quarantine_corrupt_store(&store_path);
                                let state = GrokCredentialStore {
                                    quarantined: true,
                                    verification_state: Some("auth_required".to_string()),
                                    last_auth_error: Some(fresh_error),
                                    ..GrokCredentialStore::default()
                                };
                                write_store_atomic(&store_path, &state).map_err(lock_io_error)?;
                                Ok(state)
                            }
                            Err(fresh_error) => Err(lock_io_error(fresh_error)),
                        },
                    )
                    .await
                    .map_err(from_file_lock_error)?;
                persist_provider_projection().await?;
                Ok(state)
            }
            Err(error) => Err(error),
        }
    }
}

fn usable_grant(state: &GrokCredentialStore) -> Result<&GrokGrant, GrokAuthError> {
    if state.quarantined {
        return Err(state.last_auth_error.clone().unwrap_or_else(|| {
            GrokAuthError::new(
                GrokAuthErrorCode::AuthRequired,
                "Grok 登录已失效，请重新登录",
            )
        }));
    }
    let grant = state.grant.as_ref().ok_or_else(|| {
        GrokAuthError::new(GrokAuthErrorCode::AuthRequired, "请先登录 Grok 订阅账户")
    })?;
    if grant.access_token.trim().is_empty() || grant.refresh_token.trim().is_empty() {
        return Err(GrokAuthError::new(
            GrokAuthErrorCode::AuthRequired,
            "Grok 登录凭据不完整，请重新登录",
        ));
    }
    Ok(grant)
}

fn grant_for_purpose<'a>(
    state: &'a GrokCredentialStore,
    purpose: &ResolveBearerPurpose,
) -> Result<&'a GrokGrant, GrokAuthError> {
    let grant = usable_grant(state)?;
    match purpose {
        ResolveBearerPurpose::Execution => {
            let verified = state.verified_at.is_some()
                && matches!(
                    state.verification_state.as_deref(),
                    Some("valid" | "rate_limited" | "network_error")
                );
            if !verified {
                return Err(GrokAuthError::new(
                    GrokAuthErrorCode::LoginUnavailable,
                    "Grok 订阅账户尚未通过模型验证",
                ));
            }
        }
        ResolveBearerPurpose::Verification { expected_lineage } => {
            if grant.lineage != *expected_lineage {
                return Err(GrokAuthError::new(
                    GrokAuthErrorCode::LoginUnavailable,
                    "Grok 登录账户已变化，请重新验证",
                ));
            }
        }
    }
    Ok(grant)
}

fn to_resolved_bearer(grant: &GrokGrant) -> ResolvedBearer {
    ResolvedBearer {
        access_token: grant.access_token.clone(),
        credential_version: grant.credential_version,
    }
}

fn auth_file_lock_options() -> FileLockOptions {
    FileLockOptions {
        // Refresh holds this lock across a provider request with a 30s HTTP
        // deadline. Waiters must be able to observe the rotated token instead
        // of failing while the legitimate owner is still in flight.
        timeout: Duration::from_secs(45),
        stale: Duration::from_secs(90),
        poll: Duration::from_millis(50),
    }
}

fn read_store_for_replacement(
    path: &std::path::Path,
) -> Result<GrokCredentialStore, FileLockError> {
    match read_store(path) {
        Ok(state) => Ok(state),
        Err(error) if error.code == GrokAuthErrorCode::StoreCorrupt => {
            quarantine_corrupt_store(path);
            Ok(GrokCredentialStore::default())
        }
        Err(error) => Err(lock_io_error(error)),
    }
}

fn lock_io_error(error: GrokAuthError) -> FileLockError {
    FileLockError::Io(std::io::Error::other(
        serde_json::to_string(&error).unwrap_or(error.message),
    ))
}

fn from_file_lock_error(error: FileLockError) -> GrokAuthError {
    match error {
        FileLockError::Busy { .. } => GrokAuthError::new(
            GrokAuthErrorCode::StoreBusy,
            "Grok 登录凭据正在更新，请稍后重试",
        ),
        FileLockError::Io(error) => serde_json::from_str::<GrokAuthError>(&error.to_string())
            .unwrap_or_else(|_| {
                GrokAuthError::new(GrokAuthErrorCode::Internal, "无法更新 Grok 登录凭据")
            }),
    }
}

fn verification_state_for_error(error: &GrokAuthError) -> &'static str {
    match error.code {
        GrokAuthErrorCode::AuthRequired | GrokAuthErrorCode::StoreCorrupt => "auth_required",
        GrokAuthErrorCode::EntitlementRequired => "entitlement_required",
        GrokAuthErrorCode::RateLimited => "rate_limited",
        GrokAuthErrorCode::Network => "network_error",
        _ => "verification_error",
    }
}

fn failed_verification(
    error: GrokAuthError,
    model: Option<String>,
    account: Option<GrokAccountSummary>,
) -> GrokVerificationResult {
    GrokVerificationResult {
        success: false,
        state: verification_state_for_error(&error).to_string(),
        model,
        account,
        error: Some(error),
    }
}

#[cfg(not(test))]
async fn persist_provider_projection() -> Result<(), GrokAuthError> {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = crate::app_dirs::myagents_data_dir().ok_or_else(|| {
            GrokAuthError::new(
                GrokAuthErrorCode::Internal,
                "Cannot determine MyAgents data directory",
            )
        })?;
        let config_path = data_dir.join("config.json");
        let store_path = data_dir.join("credentials").join("grok-oauth.json");
        let lock_path = auth_lock_path(&store_path);
        with_file_lock_blocking(&lock_path, auth_file_lock_options(), move || {
            // Lock order is always auth store → config. Holding the canonical
            // owner lock while publishing prevents a stale projection without
            // bounded retry/caching indirection.
            let projected = read_store(&store_path).map_err(lock_io_error)?;
            crate::config_io::with_config_lock(&config_path, false, move |config| {
                apply_provider_projection(config, &projected)
            })
            .map_err(|error| {
                FileLockError::Io(std::io::Error::new(std::io::ErrorKind::Other, error))
            })?;
            Ok(())
        })
        .map_err(from_file_lock_error)?;
        if let Some(app) = crate::logger::get_app_handle() {
            use tauri::Emitter;
            let _ = app.emit("agent:config-changed", serde_json::json!({}));
        }
        Ok(())
    })
    .await
    .map_err(|_| GrokAuthError::new(GrokAuthErrorCode::Internal, "同步 Grok 供应商状态失败"))?
}

#[cfg(not(test))]
fn apply_provider_projection(
    config: &mut Value,
    state: &GrokCredentialStore,
) -> Result<(), String> {
    if !config.is_object() {
        *config = json!({});
    }
    let root = config
        .as_object_mut()
        .ok_or_else(|| "config root is not an object".to_string())?;
    let provider_status = root
        .entry("providerVerifyStatus".to_string())
        .or_insert_with(|| json!({}));
    if !provider_status.is_object() {
        *provider_status = json!({});
    }
    let statuses = provider_status
        .as_object_mut()
        .ok_or_else(|| "providerVerifyStatus is not an object".to_string())?;

    let has_grant = state.grant.is_some() && !state.quarantined;
    let preserves_valid = has_grant
        && state.verified_at.is_some()
        && matches!(
            state.verification_state.as_deref(),
            Some("valid" | "rate_limited" | "network_error")
        );
    if preserves_valid {
        statuses.insert(
            XAI_SUBSCRIPTION_PROVIDER_ID.to_string(),
            json!({
                "status": "valid",
                "verifiedAt": state.verified_at.clone().unwrap_or_else(|| Utc::now().to_rfc3339()),
                "accountEmail": state.account.as_ref().and_then(|account| account.email.clone()),
                "invalidReason": state.verification_state.as_deref().and_then(|value| match value {
                    "rate_limited" => Some("rate_limited"),
                    "network_error" => Some("network"),
                    _ => None,
                }),
                "error": state.last_auth_error.as_ref().map(|error| error.message.clone()),
            }),
        );
    } else if has_grant {
        let reason = match state.verification_state.as_deref() {
            Some("entitlement_required") => "entitlement_required",
            Some("rate_limited") => "rate_limited",
            Some("network_error") => "network",
            _ => "unknown",
        };
        statuses.insert(
            XAI_SUBSCRIPTION_PROVIDER_ID.to_string(),
            json!({
                "status": "invalid",
                "verifiedAt": Utc::now().to_rfc3339(),
                "accountEmail": state.account.as_ref().and_then(|account| account.email.clone()),
                "invalidReason": reason,
                "error": state.last_auth_error.as_ref().map(|error| error.message.clone()),
            }),
        );
    } else {
        statuses.remove(XAI_SUBSCRIPTION_PROVIDER_ID);
    }
    Ok(())
}

#[cfg(test)]
async fn persist_provider_projection() -> Result<(), GrokAuthError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoints() -> ValidatedOauthEndpoints {
        ValidatedOauthEndpoints {
            authorization_endpoint: "https://auth.x.ai/oauth2/authorize".to_string(),
            token_endpoint: "https://auth.x.ai/oauth2/token".to_string(),
        }
    }

    fn token_response() -> oauth::TokenResponse {
        oauth::TokenResponse {
            access_token: "access-token".to_string(),
            refresh_token: "refresh-token".to_string(),
            id_token: None,
            token_type: Some("Bearer".to_string()),
            expires_in: Some(3600),
        }
    }

    fn waiting_session(session_id: &str) -> DeviceLoginSession {
        let (cancel, _rx) = watch::channel(false);
        DeviceLoginSession {
            session_id: session_id.to_string(),
            status: "waiting".to_string(),
            user_code: Some("CODE".to_string()),
            verification_uri: Some("https://auth.x.ai/device".to_string()),
            verification_uri_complete: Some("https://auth.x.ai/device?code=CODE".to_string()),
            device_code: "device-secret".to_string(),
            endpoints: endpoints(),
            expires_at: Utc::now().timestamp() + 600,
            poll_interval_seconds: 1,
            account: None,
            error: None,
            cancel,
            credential_version: None,
            completed_at: None,
        }
    }

    #[tokio::test]
    async fn cancellation_signal_is_retained_before_poller_subscribes() {
        let session = waiting_session("retained-cancel");
        session.cancel.send_replace(true);
        let receiver = session.cancel.subscribe();
        assert!(*receiver.borrow());
    }

    #[tokio::test]
    async fn cancelled_login_cannot_commit_an_approved_token() {
        let temp = tempfile::tempdir().unwrap();
        let store_path = temp.path().join("credentials").join("grok-oauth.json");
        let manager = Arc::new(GrokAuthManager::with_store_path(store_path.clone()));
        let session_id = "cancel-before-commit";
        manager
            .login_sessions
            .lock()
            .await
            .insert(session_id.to_string(), waiting_session(session_id));

        manager.cancel_login(session_id).await.unwrap();
        let committed = manager
            .save_new_grant_for_session(session_id, token_response(), endpoints())
            .await
            .unwrap();

        assert_eq!(committed, None);
        assert!(read_store(&store_path).unwrap().grant.is_none());
    }

    #[tokio::test]
    async fn logout_wins_over_a_late_approved_token_commit() {
        let temp = tempfile::tempdir().unwrap();
        let store_path = temp.path().join("credentials").join("grok-oauth.json");
        let manager = Arc::new(GrokAuthManager::with_store_path(store_path.clone()));
        let session_id = "logout-late-approval";
        manager
            .login_sessions
            .lock()
            .await
            .insert(session_id.to_string(), waiting_session(session_id));

        manager.logout().await.unwrap();
        let committed = manager
            .save_new_grant_for_session(session_id, token_response(), endpoints())
            .await
            .unwrap();

        assert_eq!(committed, None);
        assert!(read_store(&store_path).unwrap().grant.is_none());
    }

    #[tokio::test]
    async fn cancel_after_completion_does_not_delete_the_grant() {
        let temp = tempfile::tempdir().unwrap();
        let store_path = temp.path().join("credentials").join("grok-oauth.json");
        let manager = Arc::new(GrokAuthManager::with_store_path(store_path.clone()));
        let session_id = "completed-login";
        manager
            .login_sessions
            .lock()
            .await
            .insert(session_id.to_string(), waiting_session(session_id));
        manager
            .save_new_grant_for_session(session_id, token_response(), endpoints())
            .await
            .unwrap();
        manager
            .login_sessions
            .lock()
            .await
            .get_mut(session_id)
            .unwrap()
            .status = "succeeded".to_string();

        manager.cancel_login(session_id).await.unwrap();

        assert!(read_store(&store_path).unwrap().grant.is_some());
    }

    #[tokio::test]
    async fn cancel_clears_the_same_login_after_credential_rotation() {
        let temp = tempfile::tempdir().unwrap();
        let store_path = temp.path().join("credentials").join("grok-oauth.json");
        let manager = Arc::new(GrokAuthManager::with_store_path(store_path.clone()));
        let session_id = "rotated-login";
        manager
            .login_sessions
            .lock()
            .await
            .insert(session_id.to_string(), waiting_session(session_id));
        manager
            .save_new_grant_for_session(session_id, token_response(), endpoints())
            .await
            .unwrap();
        let mut rotated = read_store(&store_path).unwrap();
        let grant = rotated.grant.as_mut().unwrap();
        grant.credential_version += 1;
        grant.access_token = "rotated-access".to_string();
        grant.refresh_token = "rotated-refresh".to_string();
        write_store_atomic(&store_path, &rotated).unwrap();

        manager.cancel_login(session_id).await.unwrap();

        assert!(read_store(&store_path).unwrap().grant.is_none());
    }

    #[tokio::test]
    async fn logout_epoch_rejects_a_login_started_before_logout() {
        let temp = tempfile::tempdir().unwrap();
        let store_path = temp.path().join("credentials").join("grok-oauth.json");
        let manager = Arc::new(GrokAuthManager::with_store_path(store_path));
        let stale_epoch = manager.auth_epoch.load(Ordering::Acquire);

        manager.logout().await.unwrap();
        let result = manager
            .register_login_session_if_current(stale_epoch, waiting_session("stale-start"))
            .await;

        assert_eq!(result.unwrap_err().code, GrokAuthErrorCode::LoginCancelled);
        assert!(manager.login_sessions.lock().await.is_empty());
    }

    #[tokio::test]
    async fn sdk_success_is_explicit_and_error_outcomes_are_version_bound() {
        let temp = tempfile::tempdir().unwrap();
        let store_path = temp.path().join("credentials").join("grok-oauth.json");
        let manager = Arc::new(GrokAuthManager::with_store_path(store_path.clone()));
        let session_id = "outcome-login";
        manager
            .login_sessions
            .lock()
            .await
            .insert(session_id.to_string(), waiting_session(session_id));
        let version = manager
            .save_new_grant_for_session(session_id, token_response(), endpoints())
            .await
            .unwrap()
            .unwrap();

        manager.record_upstream_outcome(version, 200).await.unwrap();
        assert!(!manager.get_auth_status().await.unwrap().verified);

        manager
            .record_verification_success_for_lineage(session_id)
            .await
            .unwrap();
        assert!(manager.get_auth_status().await.unwrap().verified);

        manager.record_upstream_outcome(version, 403).await.unwrap();
        let status = manager.get_auth_status().await.unwrap();
        assert_eq!(status.state, "entitlement_required");
        assert!(status.has_grant);

        manager
            .record_upstream_outcome(version + 1, 403)
            .await
            .unwrap();
        assert_eq!(
            manager.get_auth_status().await.unwrap().state,
            "entitlement_required"
        );
    }

    #[tokio::test]
    async fn stale_failed_verification_does_not_poison_a_new_login_lineage() {
        let temp = tempfile::tempdir().unwrap();
        let store_path = temp.path().join("credentials").join("grok-oauth.json");
        let manager = Arc::new(GrokAuthManager::with_store_path(store_path.clone()));
        for session_id in ["old-login", "new-login"] {
            manager
                .login_sessions
                .lock()
                .await
                .insert(session_id.to_string(), waiting_session(session_id));
            manager
                .save_new_grant_for_session(session_id, token_response(), endpoints())
                .await
                .unwrap();
        }

        let result = manager
            .finalize_bridge_verification(
                "grok-4.5".to_string(),
                "old-login".to_string(),
                false,
                Some("stale failure".to_string()),
            )
            .await;

        assert!(!result.success);
        let store = read_store(&store_path).unwrap();
        assert_eq!(store.grant.as_ref().unwrap().lineage, "new-login");
        assert_eq!(store.verification_state.as_deref(), Some("validating"));
        assert_eq!(
            manager
                .login_sessions
                .lock()
                .await
                .get("new-login")
                .unwrap()
                .status,
            "validating"
        );
    }

    #[tokio::test]
    async fn execution_bearer_is_gated_until_sdk_verification_succeeds() {
        let temp = tempfile::tempdir().unwrap();
        let store_path = temp.path().join("credentials").join("grok-oauth.json");
        let manager = Arc::new(GrokAuthManager::with_store_path(store_path));
        let session_id = "purpose-login";
        manager
            .login_sessions
            .lock()
            .await
            .insert(session_id.to_string(), waiting_session(session_id));
        manager
            .save_new_grant_for_session(session_id, token_response(), endpoints())
            .await
            .unwrap();

        assert!(manager
            .resolve_bearer(
                ResolveBearerReason::Request,
                None,
                ResolveBearerPurpose::Execution,
            )
            .await
            .is_err());
        assert!(manager
            .resolve_bearer(
                ResolveBearerReason::Request,
                None,
                ResolveBearerPurpose::Verification {
                    expected_lineage: session_id.to_string(),
                },
            )
            .await
            .is_ok());

        manager
            .record_verification_success_for_lineage(session_id)
            .await
            .unwrap();
        assert!(manager
            .resolve_bearer(
                ResolveBearerReason::Request,
                None,
                ResolveBearerPurpose::Execution,
            )
            .await
            .is_ok());
    }

    #[test]
    fn auth_lock_wait_covers_refresh_http_deadline() {
        let options = auth_file_lock_options();
        assert!(options.timeout > Duration::from_secs(30));
        assert!(options.stale > options.timeout);
    }
}
