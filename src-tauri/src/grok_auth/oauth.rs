use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use reqwest::{redirect::Policy, StatusCode, Url};
use serde::Deserialize;
use serde_json::Value;

use super::store::{GrokGrant, ValidatedOauthEndpoints};
use super::types::{
    GrokAccountSummary, GrokAuthError, GrokAuthErrorCode, XAI_DEVICE_CODE_URL, XAI_OAUTH_CLIENT_ID,
    XAI_OAUTH_SCOPE, XAI_OIDC_DISCOVERY_URL, XAI_PRIMARY_MODEL, XAI_SUBSCRIPTION_PROVIDER_ID,
};

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const GROK_OAUTH_USER_AGENT: &str = concat!("MyAgents/", env!("CARGO_PKG_VERSION"), " Grok OAuth");

#[derive(Debug, Deserialize)]
struct DiscoveryDocument {
    #[serde(default)]
    issuer: Option<String>,
    authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RefreshTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OauthErrorBody {
    #[serde(default)]
    error: Option<String>,
}

pub fn build_async_client() -> Result<reqwest::Client, GrokAuthError> {
    let builder = async_oauth_client_builder();
    crate::proxy_config::build_client_with_proxy_for_provider(builder, XAI_SUBSCRIPTION_PROVIDER_ID)
        .map_err(|_| {
            GrokAuthError::new(
                GrokAuthErrorCode::Network,
                "无法创建 Grok 网络客户端，请检查代理配置",
            )
        })
}

fn async_oauth_client_builder() -> reqwest::ClientBuilder {
    #[allow(clippy::disallowed_methods)]
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .redirect(Policy::none())
        .user_agent(GROK_OAUTH_USER_AGENT)
}

pub fn build_blocking_client() -> Result<reqwest::blocking::Client, GrokAuthError> {
    #[allow(clippy::disallowed_methods)]
    let builder = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .redirect(Policy::none())
        .user_agent(GROK_OAUTH_USER_AGENT);
    crate::proxy_config::build_blocking_client_with_proxy_for_provider(
        builder,
        XAI_SUBSCRIPTION_PROVIDER_ID,
    )
    .map_err(|_| {
        GrokAuthError::new(
            GrokAuthErrorCode::Network,
            "无法创建 Grok 网络客户端，请检查代理配置",
        )
    })
}

pub fn validate_xai_https_endpoint(endpoint: &str) -> Result<Url, GrokAuthError> {
    let parsed = Url::parse(endpoint).map_err(|_| {
        GrokAuthError::new(
            GrokAuthErrorCode::InvalidResponse,
            "Grok 登录服务返回了无效地址",
        )
    })?;
    if parsed.scheme() != "https" {
        return Err(GrokAuthError::new(
            GrokAuthErrorCode::InvalidResponse,
            "Grok 登录服务返回了不安全地址",
        ));
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if host != "x.ai" && !host.ends_with(".x.ai") {
        return Err(GrokAuthError::new(
            GrokAuthErrorCode::InvalidResponse,
            "Grok 登录服务返回了非 x.ai 地址",
        ));
    }
    Ok(parsed)
}

pub async fn discover_endpoints(
    client: &reqwest::Client,
) -> Result<ValidatedOauthEndpoints, GrokAuthError> {
    let response = client
        .get(XAI_OIDC_DISCOVERY_URL)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(http_error(response.status(), "Grok 登录服务暂时不可用"));
    }
    let document: DiscoveryDocument = response.json().await.map_err(|_| {
        GrokAuthError::new(
            GrokAuthErrorCode::InvalidResponse,
            "Grok 登录服务返回了无效配置",
        )
    })?;
    if let Some(issuer) = document.issuer.as_deref() {
        validate_xai_https_endpoint(issuer)?;
    }
    validate_xai_https_endpoint(&document.authorization_endpoint)?;
    validate_xai_https_endpoint(&document.token_endpoint)?;
    Ok(ValidatedOauthEndpoints {
        authorization_endpoint: document.authorization_endpoint,
        token_endpoint: document.token_endpoint,
    })
}

pub async fn request_device_code(
    client: &reqwest::Client,
) -> Result<DeviceCodeResponse, GrokAuthError> {
    let response = client
        .post(XAI_DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", XAI_OAUTH_CLIENT_ID),
            ("scope", XAI_OAUTH_SCOPE),
        ])
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(http_error(
            response.status(),
            "Grok 登录服务当前不接受此客户端，请更新 MyAgents 或稍后再试",
        ));
    }
    let result: DeviceCodeResponse = response.json().await.map_err(|_| {
        GrokAuthError::new(
            GrokAuthErrorCode::InvalidResponse,
            "Grok 登录服务返回了无效登录信息",
        )
    })?;
    if result.device_code.trim().is_empty()
        || result.user_code.trim().is_empty()
        || result.verification_uri.trim().is_empty()
        || result.verification_uri_complete.trim().is_empty()
        || result.expires_in == 0
    {
        return Err(GrokAuthError::new(
            GrokAuthErrorCode::InvalidResponse,
            "Grok 登录服务返回了不完整登录信息",
        ));
    }
    validate_xai_https_endpoint(&result.verification_uri)?;
    validate_xai_https_endpoint(&result.verification_uri_complete)?;
    Ok(result)
}

pub enum DevicePollOutcome {
    Pending,
    SlowDown,
    Approved(TokenResponse),
    Denied(GrokAuthError),
    Transient(GrokAuthError),
}

pub async fn poll_device_token(
    client: &reqwest::Client,
    token_endpoint: &str,
    device_code: &str,
) -> DevicePollOutcome {
    if let Err(error) = validate_xai_https_endpoint(token_endpoint) {
        return DevicePollOutcome::Denied(error);
    }
    let response = match client
        .post(token_endpoint)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", XAI_OAUTH_CLIENT_ID),
            ("device_code", device_code),
        ])
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return DevicePollOutcome::Transient(network_error(error)),
    };

    if response.status().is_success() {
        let token = match response.json::<TokenResponse>().await {
            Ok(token)
                if !token.access_token.trim().is_empty()
                    && !token.refresh_token.trim().is_empty() =>
            {
                token
            }
            _ => {
                return DevicePollOutcome::Denied(GrokAuthError::new(
                    GrokAuthErrorCode::InvalidResponse,
                    "Grok 登录成功响应缺少可续期凭据",
                ))
            }
        };
        return DevicePollOutcome::Approved(token);
    }

    let status = response.status();
    let body = response
        .json::<OauthErrorBody>()
        .await
        .unwrap_or(OauthErrorBody { error: None });
    match body.error.as_deref() {
        Some("authorization_pending") => DevicePollOutcome::Pending,
        Some("slow_down") => DevicePollOutcome::SlowDown,
        Some("access_denied") => DevicePollOutcome::Denied(GrokAuthError::new(
            GrokAuthErrorCode::LoginDenied,
            "你已拒绝 Grok 登录授权",
        )),
        Some("expired_token") => DevicePollOutcome::Denied(GrokAuthError::new(
            GrokAuthErrorCode::LoginExpired,
            "Grok 登录验证码已过期，请重新登录",
        )),
        _ if status.is_server_error() => {
            DevicePollOutcome::Transient(http_error(status, "Grok 登录服务暂时不可用"))
        }
        _ => DevicePollOutcome::Denied(GrokAuthError::http(
            GrokAuthErrorCode::LoginUnavailable,
            status.as_u16(),
            "Grok 登录服务当前不接受此客户端，请更新 MyAgents 或稍后再试",
            false,
        )),
    }
}

pub fn grant_from_token_response(
    response: TokenResponse,
    endpoints: ValidatedOauthEndpoints,
    credential_version: u64,
    lineage: String,
) -> GrokGrant {
    let issued_at = Utc::now().timestamp();
    GrokGrant {
        lineage,
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        id_token: response.id_token,
        token_type: response.token_type.unwrap_or_else(|| "Bearer".to_string()),
        issued_at,
        expires_at: response
            .expires_in
            .and_then(|seconds| i64::try_from(seconds).ok())
            .map(|seconds| issued_at.saturating_add(seconds)),
        expires_in: response.expires_in,
        credential_version,
        last_refresh_at: None,
        endpoints,
    }
}

pub fn refresh_grant_blocking(grant: &GrokGrant) -> Result<GrokGrant, GrokAuthError> {
    validate_xai_https_endpoint(&grant.endpoints.token_endpoint)?;
    let client = build_blocking_client()?;
    let response = client
        .post(&grant.endpoints.token_endpoint)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", XAI_OAUTH_CLIENT_ID),
            ("refresh_token", grant.refresh_token.as_str()),
        ])
        .send()
        .map_err(|error| {
            GrokAuthError::new(
                GrokAuthErrorCode::Network,
                format!("Grok 登录刷新网络失败：{}", safe_network_kind(&error)),
            )
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .json::<OauthErrorBody>()
            .unwrap_or(OauthErrorBody { error: None });
        return Err(classify_refresh_failure(status, body.error.as_deref()));
    }

    let refreshed: RefreshTokenResponse = response.json().map_err(|_| {
        GrokAuthError::new(
            GrokAuthErrorCode::AuthRequired,
            "Grok 登录刷新响应无效，请重新登录",
        )
    })?;
    if refreshed.access_token.trim().is_empty() {
        return Err(GrokAuthError::new(
            GrokAuthErrorCode::AuthRequired,
            "Grok 登录刷新缺少 access token，请重新登录",
        ));
    }
    let issued_at = Utc::now().timestamp();
    Ok(GrokGrant {
        lineage: grant.lineage.clone(),
        access_token: refreshed.access_token,
        refresh_token: refreshed
            .refresh_token
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| grant.refresh_token.clone()),
        id_token: refreshed.id_token.or_else(|| grant.id_token.clone()),
        token_type: refreshed
            .token_type
            .unwrap_or_else(|| grant.token_type.clone()),
        issued_at,
        expires_at: refreshed
            .expires_in
            .and_then(|seconds| i64::try_from(seconds).ok())
            .map(|seconds| issued_at.saturating_add(seconds)),
        expires_in: refreshed.expires_in,
        credential_version: grant.credential_version.saturating_add(1),
        last_refresh_at: Some(Utc::now().to_rfc3339()),
        endpoints: grant.endpoints.clone(),
    })
}

fn classify_refresh_failure(status: StatusCode, oauth_error: Option<&str>) -> GrokAuthError {
    let terminal = matches!(oauth_error, Some("invalid_grant" | "invalid_token"))
        || status == StatusCode::UNAUTHORIZED;
    let entitlement = status == StatusCode::FORBIDDEN;
    GrokAuthError::http(
        if terminal {
            GrokAuthErrorCode::AuthRequired
        } else if entitlement {
            GrokAuthErrorCode::EntitlementRequired
        } else if status == StatusCode::TOO_MANY_REQUESTS {
            GrokAuthErrorCode::RateLimited
        } else {
            GrokAuthErrorCode::Network
        },
        status.as_u16(),
        if terminal {
            "Grok 登录已失效，请重新登录"
        } else if entitlement {
            "账号已登录，但当前订阅、地区或 OAuth 权限不可用"
        } else if status == StatusCode::TOO_MANY_REQUESTS {
            "Grok 登录刷新请求过多，请稍后再试"
        } else {
            "Grok 登录服务暂时不可用"
        },
        !terminal && !entitlement,
    )
}

pub fn token_needs_refresh(grant: &GrokGrant, now: i64) -> bool {
    let Some(expires_at) = grant.expires_at else {
        return false;
    };
    let lifetime = grant
        .expires_in
        .and_then(|value| i64::try_from(value).ok())
        .unwrap_or_else(|| expires_at.saturating_sub(grant.issued_at))
        .max(1);
    let proportional = (lifetime / 10).max(30);
    let refresh_window = if lifetime <= 45 * 60 {
        proportional.min(120)
    } else {
        proportional.min(3600)
    };
    expires_at.saturating_sub(now) <= refresh_window
}

pub fn account_summary_from_id_token(id_token: Option<&str>) -> Option<GrokAccountSummary> {
    let payload = id_token?.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let claims: Value = serde_json::from_slice(&decoded).ok()?;
    let string_claim = |name: &str| {
        claims
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let summary = GrokAccountSummary {
        email: string_claim("email"),
        display_name: string_claim("name").or_else(|| string_claim("preferred_username")),
    };
    (summary.email.is_some() || summary.display_name.is_some()).then_some(summary)
}

pub async fn fetch_models(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<Value, GrokAuthError> {
    let response = client
        .get(super::types::XAI_MODELS_URL)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status();
    if !status.is_success() {
        return Err(classify_inference_status(status));
    }
    response.json().await.map_err(|_| {
        GrokAuthError::new(
            GrokAuthErrorCode::InvalidResponse,
            "Grok 模型列表返回了无效数据",
        )
    })
}

pub fn choose_verification_model(models: Option<&Value>) -> String {
    let ids: Vec<&str> = models
        .and_then(|value| value.get("data"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default();
    if ids.is_empty() || ids.contains(&XAI_PRIMARY_MODEL) {
        return XAI_PRIMARY_MODEL.to_string();
    }
    const PRESET: &[&str] = &[
        "grok-4.5",
        "grok-build-0.1",
        "grok-composer-2.5-fast",
        "grok-4.3",
        "grok-4.20-0309-reasoning",
        "grok-4.20-0309-non-reasoning",
        "grok-4.20-multi-agent-0309",
    ];
    PRESET
        .iter()
        .find(|candidate| ids.contains(candidate))
        .map(|value| (*value).to_string())
        .unwrap_or_else(|| XAI_PRIMARY_MODEL.to_string())
}

pub fn classify_inference_status(status: StatusCode) -> GrokAuthError {
    match status.as_u16() {
        401 => GrokAuthError::http(
            GrokAuthErrorCode::AuthRequired,
            401,
            "Grok 登录已失效，请重新登录",
            false,
        ),
        403 => GrokAuthError::http(
            GrokAuthErrorCode::EntitlementRequired,
            403,
            "账号已登录，但当前订阅、地区或模型不可用",
            false,
        ),
        429 => GrokAuthError::http(
            GrokAuthErrorCode::RateLimited,
            429,
            "Grok 请求过多或当前额度不可用，请稍后再试",
            true,
        ),
        value if value >= 500 => GrokAuthError::http(
            GrokAuthErrorCode::Network,
            value,
            "Grok 服务暂时不可用",
            true,
        ),
        value => GrokAuthError::http(
            GrokAuthErrorCode::InvalidResponse,
            value,
            "Grok 服务拒绝了验证请求",
            false,
        ),
    }
}

fn network_error(error: reqwest::Error) -> GrokAuthError {
    GrokAuthError::new(
        GrokAuthErrorCode::Network,
        format!("Grok 网络连接失败：{}", safe_network_kind(&error)),
    )
}

fn safe_network_kind(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "请求超时"
    } else if error.is_connect() {
        "无法连接服务"
    } else {
        "网络错误"
    }
}

fn http_error(status: StatusCode, message: &str) -> GrokAuthError {
    GrokAuthError::http(
        if status == StatusCode::TOO_MANY_REQUESTS {
            GrokAuthErrorCode::RateLimited
        } else {
            GrokAuthErrorCode::LoginUnavailable
        },
        status.as_u16(),
        message,
        status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grok_auth::store::ValidatedOauthEndpoints;
    use serde_json::json;

    fn grant(expires_in: u64, expires_at: i64) -> GrokGrant {
        GrokGrant {
            lineage: "test-lineage".into(),
            access_token: "access".into(),
            refresh_token: "refresh".into(),
            id_token: None,
            token_type: "Bearer".into(),
            issued_at: expires_at - expires_in as i64,
            expires_at: Some(expires_at),
            expires_in: Some(expires_in),
            credential_version: 1,
            last_refresh_at: None,
            endpoints: ValidatedOauthEndpoints {
                authorization_endpoint: "https://auth.x.ai/oauth2/authorize".into(),
                token_endpoint: "https://auth.x.ai/oauth2/token".into(),
            },
        }
    }

    #[test]
    fn endpoint_pinning_accepts_only_https_xai_origins() {
        assert!(validate_xai_https_endpoint("https://auth.x.ai/oauth2/token").is_ok());
        assert!(validate_xai_https_endpoint("https://x.ai/token").is_ok());
        assert!(validate_xai_https_endpoint("http://auth.x.ai/token").is_err());
        assert!(validate_xai_https_endpoint("https://auth.x.ai.evil.example/token").is_err());
        assert!(validate_xai_https_endpoint("https://example.com/token").is_err());
    }

    #[test]
    fn refresh_window_scales_with_token_lifetime() {
        assert!(!token_needs_refresh(&grant(900, 10_000), 9_850));
        assert!(token_needs_refresh(&grant(900, 10_000), 9_920));
        assert!(!token_needs_refresh(&grant(36_000, 100_000), 96_300));
        assert!(token_needs_refresh(&grant(36_000, 100_000), 96_500));
    }

    #[test]
    fn verification_model_prefers_primary_then_known_preset() {
        assert_eq!(choose_verification_model(None), "grok-4.6");
        let primary = json!({"data": [{"id": "grok-4.5"}, {"id": "grok-4.6"}]});
        assert_eq!(choose_verification_model(Some(&primary)), "grok-4.6");
        let previous = json!({"data": [{"id": "grok-4.5"}, {"id": "grok-build-0.1"}]});
        assert_eq!(choose_verification_model(Some(&previous)), "grok-4.5");
        let fallback = json!({"data": [{"id": "grok-4.3"}]});
        assert_eq!(choose_verification_model(Some(&fallback)), "grok-4.3");
    }

    #[test]
    fn refresh_failure_only_quarantines_explicit_terminal_errors() {
        assert_eq!(
            classify_refresh_failure(StatusCode::BAD_REQUEST, Some("invalid_grant")).code,
            GrokAuthErrorCode::AuthRequired
        );
        assert_eq!(
            classify_refresh_failure(StatusCode::BAD_REQUEST, Some("temporarily_unavailable")).code,
            GrokAuthErrorCode::Network
        );
        assert_eq!(
            classify_refresh_failure(StatusCode::FORBIDDEN, None).code,
            GrokAuthErrorCode::EntitlementRequired
        );
        assert_eq!(
            classify_refresh_failure(StatusCode::TOO_MANY_REQUESTS, None).code,
            GrokAuthErrorCode::RateLimited
        );
    }

    #[tokio::test]
    async fn oauth_client_never_follows_redirects() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tauri::async_runtime::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 2048];
            let _ = socket.read(&mut request).await.unwrap();
            let response = format!(
                "HTTP/1.1 307 Temporary Redirect\r\nLocation: http://{address}/leak\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            socket.write_all(response.as_bytes()).await.unwrap();
            tokio::time::timeout(Duration::from_millis(250), listener.accept())
                .await
                .is_ok()
        });

        let client = async_oauth_client_builder().build().unwrap();
        let response = client
            .post(format!("http://{address}/token"))
            .body("refresh_token=must-not-be-forwarded")
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        assert!(
            !server.await.unwrap(),
            "redirect target received a second request"
        );
    }
}
