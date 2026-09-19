//! A deliberately finite native API client. OAuth state and credential contents
//! belong to CLIProxy; no token document or generic management API is exposed.
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use super::types::{Error, Result};

#[derive(Clone)]
pub(super) struct Client {
    http: reqwest::Client,
    base_url: String,
    management_key: String,
    model_key: String,
}

#[derive(Deserialize)]
pub(super) struct AuthUrl {
    pub url: String,
    pub state: String,
}

/// HTTP metadata is safe to log; native bodies, OAuth state and URLs are not.
pub(super) struct OAuthReply<T> {
    pub http_status: Option<u16>,
    pub outcome: Result<T>,
}

#[derive(Debug)]
pub(super) enum CallbackOutcome {
    Accepted,
    /// The code may already have been consumed. Query its state, never replay it.
    Unconfirmed(Error),
}

#[derive(Debug, PartialEq)]
pub(super) enum AuthStatus {
    Waiting,
    Complete,
}

#[derive(Clone, Deserialize)]
pub(super) struct Account {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub email: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

impl Client {
    pub fn new(port: u16, management_key: String, model_key: String) -> Result<Self> {
        let http = crate::local_http::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error::new("local_http", "无法创建组件连接"))?;
        Ok(Self {
            http,
            base_url: format!("http://127.0.0.1:{port}"),
            management_key,
            model_key,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
    pub fn model_key(&self) -> &str {
        &self.model_key
    }

    async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        query: &[(&str, &str)],
    ) -> Result<reqwest::Response> {
        let mut url = reqwest::Url::parse(&format!("{}{path}", self.base_url))
            .map_err(|_| Error::contract())?;
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query.iter().copied());
        }
        let mut request = self.http.request(method, url);
        if path.starts_with("/v0/management/") {
            request = request.bearer_auth(&self.management_key);
        } else if path == "/v1/models" {
            request = request.bearer_auth(&self.model_key);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        // Do not include reqwest errors, response text or request URLs: OAuth
        // query strings and native diagnostics can contain account secrets.
        request
            .send()
            .await
            .map_err(|_| Error::new("transport_outcome_unknown", "组件请求结果尚未确认"))
    }

    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        query: &[(&str, &str)],
    ) -> Result<Value> {
        bounded_json(self.send(method, path, body, query).await?).await
    }

    async fn oauth_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        query: &[(&str, &str)],
    ) -> OAuthReply<Value> {
        match self.send(method, path, body, query).await {
            Ok(response) => OAuthReply {
                http_status: Some(response.status().as_u16()),
                outcome: bounded_body(response, 16 * 1024).await,
            },
            Err(error) => OAuthReply {
                http_status: None,
                outcome: Err(error),
            },
        }
    }

    pub async fn health(&self) -> Result<()> {
        self.request(reqwest::Method::GET, "/healthz", None, &[])
            .await?;
        Ok(())
    }

    /// This GET creates a native OAuth session. The caller must never retry it
    /// on transport failure: only tearing down this candidate ends ambiguity.
    pub async fn auth_url(&self) -> OAuthReply<AuthUrl> {
        let reply = self
            .oauth_request(
                reqwest::Method::GET,
                "/v0/management/antigravity-auth-url",
                None,
                &[],
            )
            .await;
        OAuthReply {
            http_status: reply.http_status,
            outcome: check_oauth_http(reply.http_status, false).and_then(|()| {
                serde_json::from_value(reply.outcome?).map_err(|_| Error::contract())
            }),
        }
    }

    pub async fn callback(
        &self,
        state: &str,
        code: Option<&str>,
        error: Option<&str>,
    ) -> OAuthReply<CallbackOutcome> {
        let reply = self.oauth_request(reqwest::Method::POST, "/v0/management/oauth-callback", Some(json!({
            "provider": "antigravity", "state": state, "code": code.unwrap_or(""), "error": error.unwrap_or("")
        })), &[]).await;
        OAuthReply {
            http_status: reply.http_status,
            outcome: classify_callback(reply),
        }
    }

    pub async fn auth_status(&self, state: &str) -> OAuthReply<AuthStatus> {
        if state.is_empty() {
            return OAuthReply {
                http_status: None,
                outcome: Err(Error::contract()),
            };
        }
        let reply = self
            .oauth_request(
                reqwest::Method::GET,
                "/v0/management/get-auth-status",
                None,
                &[("state", state)],
            )
            .await;
        OAuthReply {
            http_status: reply.http_status,
            outcome: check_oauth_http(reply.http_status, true).and_then(|()| {
                let value = reply.outcome.map_err(|error| {
                    if error.code == "component_contract" {
                        Error::new(
                            "oauth_status_invalid_response",
                            "组件授权状态响应无效，请重新连接",
                        )
                    } else {
                        error
                    }
                })?;
                match value.get("status").and_then(Value::as_str) {
                    Some("wait") => Ok(AuthStatus::Waiting),
                    Some("ok") => Ok(AuthStatus::Complete),
                    Some("error") => Err(native_oauth_error(&value)),
                    _ => Err(Error::new(
                        "oauth_status_invalid_response",
                        "无法识别组件授权状态，请重新连接",
                    )),
                }
            }),
        }
    }

    pub async fn cancel_oauth(&self, state: &str) -> Result<()> {
        if state.is_empty() {
            return Err(Error::contract());
        }
        self.request(
            reqwest::Method::DELETE,
            "/v0/management/oauth-session",
            None,
            &[("state", state)],
        )
        .await?;
        Ok(())
    }

    pub async fn account(&self) -> Result<Option<Account>> {
        let value = self
            .request(reqwest::Method::GET, "/v0/management/auth-files", None, &[])
            .await?;
        let files = value
            .get("files")
            .and_then(Value::as_array)
            .ok_or_else(Error::contract)?;
        match files.as_slice() {
            [] => Ok(None),
            [file] => {
                let account: Account =
                    serde_json::from_value(file.clone()).map_err(|_| Error::contract())?;
                if account.kind != "antigravity" || account.name.is_empty() {
                    return Err(Error::contract());
                }
                Ok(Some(account))
            }
            _ => Err(Error::new(
                "unexpected_credentials",
                "组件账号目录不符合单账号要求",
            )),
        }
    }

    pub async fn registered_models(&self, name: &str) -> Result<Vec<Value>> {
        let value = self
            .request(
                reqwest::Method::GET,
                "/v0/management/auth-files/models",
                None,
                &[("name", name)],
            )
            .await?;
        value
            .get("models")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(Error::contract)
    }

    pub async fn definitions(&self) -> Result<Vec<Value>> {
        let value = self
            .request(
                reqwest::Method::GET,
                "/v0/management/model-definitions/antigravity",
                None,
                &[],
            )
            .await?;
        value
            .get("models")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(Error::contract)
    }

    pub async fn routed_models(&self) -> Result<Vec<String>> {
        // No Anthropic-Version, claude-cli UA or client_version: this endpoint
        // must select its ordinary OpenAI-shaped model-list envelope.
        let value = self
            .request(reqwest::Method::GET, "/v1/models", None, &[])
            .await?;
        let models = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(Error::contract)?;
        models
            .iter()
            .map(|m| {
                m.get("id")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .ok_or_else(Error::contract)
            })
            .collect()
    }
}

// Exact values from the pinned upstream contract. Field-name allowlists or
// truncation alone cannot make arbitrary upstream strings safe to expose.
fn native_oauth_error(value: &Value) -> Error {
    let (code, message) = match value.get("error").and_then(Value::as_str) {
        Some("Authentication failed") => (
            "oauth_authorization_denied",
            "Google 授权未完成，请重新连接",
        ),
        Some(
            "Authentication failed: state mismatch"
            | "invalid state"
            | "provider does not match state",
        ) => (
            "oauth_state_mismatch",
            "登录回调与本次授权不匹配，请重新连接",
        ),
        Some("Authentication failed: code not found" | "code or error is required") => (
            "oauth_callback_code_missing",
            "组件未能读取登录授权码，请重新连接",
        ),
        Some("OAuth flow timed out" | "unknown or expired state") => {
            ("oauth_state_expired", "组件授权已超时或失效，请重新连接")
        }
        Some("Failed to exchange token") => (
            "oauth_token_exchange_failed",
            "获取 Google 登录凭据失败，请重新连接；若重复出现，请检查 Antigravity 的网络和代理设置",
        ),
        Some("Failed to fetch user info") => (
            "oauth_user_info_failed",
            "获取 Google 账号信息失败，请检查网络后重新连接",
        ),
        Some("Failed to save token to file") => (
            "oauth_credential_save_failed",
            "组件保存登录凭据失败，请检查本机存储权限与空间",
        ),
        Some("failed to persist oauth callback") => (
            "oauth_callback_save_failed",
            "组件保存登录回调失败，请检查本机存储权限与空间",
        ),
        _ => ("authorization_failed", "组件报告授权失败，请重新连接"),
    };
    Error::new(code, message)
}

fn check_oauth_http(status: Option<u16>, polling: bool) -> Result<()> {
    match status {
        // Preserve the transport error from the response outcome.
        None | Some(200..=299) => Ok(()),
        Some(401 | 403) => Err(Error::new(
            "oauth_management_unauthorized",
            "无法访问组件授权接口，请重新连接",
        )),
        Some(status) => Err(Error::new(
            if polling && (status >= 500 || matches!(status, 408 | 429)) {
                "oauth_status_unavailable"
            } else {
                "oauth_management_http"
            },
            format!("组件授权接口返回 HTTP {status}，请重新连接"),
        )),
    }
}

fn classify_callback(reply: OAuthReply<Value>) -> Result<CallbackOutcome> {
    match reply.http_status {
        // A response can be lost after the native writer accepts the code.
        None | Some(408 | 429 | 500..=599) => {
            let detail = reply
                .outcome
                .as_ref()
                .ok()
                .map(native_oauth_error)
                .filter(|error| error.code != "authorization_failed")
                .unwrap_or_else(|| {
                    Error::new(
                        "oauth_callback_unconfirmed",
                        "登录回调结果尚未确认，正在查询授权状态",
                    )
                });
            Ok(CallbackOutcome::Unconfirmed(detail))
        }
        Some(409) => {
            // Includes already-completed as well as a concurrently failed state.
            // Its exact native state, not this transport conflict, is authoritative.
            Ok(CallbackOutcome::Unconfirmed(Error::new(
                "oauth_callback_conflict",
                "正在确认组件已有的授权结果",
            )))
        }
        Some(200..=299) => match reply.outcome {
            Ok(value) if value.get("status").and_then(Value::as_str) == Some("ok") => {
                Ok(CallbackOutcome::Accepted)
            }
            _ => Ok(CallbackOutcome::Unconfirmed(Error::new(
                "oauth_callback_invalid_response",
                "登录回调响应无法识别，正在查询授权状态",
            ))),
        },
        Some(401 | 403) => Err(Error::new(
            "oauth_management_unauthorized",
            "无法访问组件授权接口，请重新连接",
        )),
        status => {
            if let Ok(value) = &reply.outcome {
                let error = native_oauth_error(value);
                if error.code != "authorization_failed" {
                    return Err(error);
                }
            }
            check_oauth_http(status, false)?;
            Err(Error::new(
                "oauth_callback_rejected",
                "组件拒绝登录回调，请重新连接",
            ))
        }
    }
}

/// Bounded local JSON responses; never propagate native bodies or URLs.
pub(super) async fn bounded_json(response: reqwest::Response) -> Result<Value> {
    if !response.status().is_success() {
        return Err(Error::new(
            "component_contract",
            format!("组件接口返回 HTTP {}", response.status().as_u16()),
        ));
    }
    bounded_body(response, 1024 * 1024).await
}

async fn bounded_body(mut response: reqwest::Response, limit: usize) -> Result<Value> {
    if response.content_length().unwrap_or(0) > limit as u64 {
        return Err(Error::contract());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        Error::new(
            "transport_outcome_unknown",
            "组件响应传输中断，结果尚未确认",
        )
    })? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(Error::contract());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| Error::contract())
}
