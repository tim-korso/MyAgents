//! Offline tests of the real finite HTTP client and the manager's OAuth wait.
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::watch;

use super::callback::Callback;
use super::client::{AuthStatus, Client};
use super::manager::finish_oauth;

const STATE: &str = "synthetic-state";
const OK: &str = r#"{"status":"ok"}"#;
const WAIT: &str = r#"{"status":"wait"}"#;

enum Response {
    Json(u16, String),
    Lost,
    Truncated,
    Hang,
}
fn response(status: u16, body: &str) -> Response {
    Response::Json(status, body.to_owned())
}

struct Server {
    client: Client,
    requests: Arc<Mutex<Vec<String>>>,
    task: tauri::async_runtime::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Server {
    async fn new(responses: Vec<Response>) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = Client::new(
            listener.local_addr().unwrap().port(),
            "management".into(),
            "model".into(),
        )
        .unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let task = tauri::async_runtime::spawn(async move {
            let mut responses: VecDeque<_> = responses.into();
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 1024];
                loop {
                    let n = socket.read(&mut buffer).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]);
                        let length = header
                            .lines()
                            .find_map(|line| {
                                let (key, value) = line.split_once(':')?;
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                captured
                    .lock()
                    .unwrap()
                    .push(String::from_utf8(bytes).unwrap());
                match responses.pop_front().unwrap_or_else(|| response(200, WAIT)) {
                    Response::Lost => {}
                    Response::Hang => std::future::pending::<()>().await,
                    Response::Truncated => {
                        let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{").await;
                    }
                    Response::Json(status, body) => {
                        let wire = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                        let _ = socket.write_all(wire.as_bytes()).await;
                    }
                }
            }
        });
        Self {
            client,
            requests,
            task,
        }
    }
    fn assert_single_submission(&self) {
        let requests = self.requests.lock().unwrap();
        assert_eq!(
            requests.iter().filter(|r| r.starts_with("POST ")).count(),
            1
        );
        for request in requests.iter().filter(|r| r.starts_with("GET ")) {
            assert!(
                request.starts_with("GET /v0/management/get-auth-status?state=synthetic-state ")
            );
        }
        let submitted = requests[0].split("\r\n\r\n").nth(1).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(submitted).unwrap(),
            serde_json::json!({
                "provider":"antigravity", "state":STATE, "code":"synthetic-code", "error":""
            })
        );
    }
}
fn callback() -> Callback {
    Callback {
        code: Some("synthetic-code".into()),
        error: None,
    }
}
async fn finish(server: &Server) -> super::types::Result<()> {
    let (_tx, rx) = watch::channel(false);
    finish_oauth(
        &server.client,
        STATE,
        callback(),
        Instant::now(),
        Instant::now() + Duration::from_secs(5),
        rx,
        "test-attempt",
    )
    .await
}

#[tokio::test]
async fn native_failures_preserve_stage_without_exposing_native_text() {
    for (native, code) in [
        ("Authentication failed", "oauth_authorization_denied"),
        (
            "Authentication failed: state mismatch",
            "oauth_state_mismatch",
        ),
        (
            "Authentication failed: code not found",
            "oauth_callback_code_missing",
        ),
        ("OAuth flow timed out", "oauth_state_expired"),
        ("unknown or expired state", "oauth_state_expired"),
        ("Failed to exchange token", "oauth_token_exchange_failed"),
        ("Failed to fetch user info", "oauth_user_info_failed"),
        (
            "Failed to save token to file",
            "oauth_credential_save_failed",
        ),
        (
            "Failed to exchange token: secret-canary@example.test token=secret-canary",
            "authorization_failed",
        ),
    ] {
        let body = serde_json::json!({"status":"error","error":native,
            "message":"secret-canary", "error_code":"secret-canary"})
        .to_string();
        let server = Server::new(vec![response(200, OK), response(200, &body)]).await;
        let error = finish(&server).await.unwrap_err();
        assert_eq!(error.code, code);
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains("secret-canary"));
        server.assert_single_submission();
    }
}

#[tokio::test]
async fn ambiguous_callback_responses_resolve_success_without_replaying_code() {
    for callback_response in [
        Response::Lost,
        Response::Truncated,
        response(200, "not-json secret-canary"),
        response(409, r#"{"error":"oauth flow is already completed"}"#),
        response(500, r#"{"error":"secret-canary"}"#),
    ] {
        let server = Server::new(vec![callback_response, response(200, OK)]).await;
        finish(&server).await.unwrap();
        server.assert_single_submission();
    }
}

#[tokio::test]
async fn definite_callback_rejection_stops_without_polling() {
    for (status, body, code) in [
        (
            400,
            r#"{"error":"provider does not match state"}"#,
            "oauth_state_mismatch",
        ),
        (
            404,
            r#"{"error":"unknown or expired state"}"#,
            "oauth_state_expired",
        ),
        (401, "secret-canary", "oauth_management_unauthorized"),
        (400, r#"{"error":"secret-canary"}"#, "oauth_management_http"),
    ] {
        let server = Server::new(vec![response(status, body)]).await;
        let error = finish(&server).await.unwrap_err();
        assert_eq!(error.code, code);
        assert!(!error.message.contains("secret-canary"));
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn transient_status_failure_can_recover_but_contract_failures_end() {
    for transient in [
        Response::Lost,
        Response::Truncated,
        response(503, "unavailable"),
    ] {
        let server = Server::new(vec![response(200, OK), transient, response(200, OK)]).await;
        finish(&server).await.unwrap();
        server.assert_single_submission();
    }
    for (status, body, code) in [
        (403, "secret-canary", "oauth_management_unauthorized"),
        (200, "not-json", "oauth_status_invalid_response"),
        (
            200,
            r#"{"status":"secret-canary"}"#,
            "oauth_status_invalid_response",
        ),
    ] {
        let server = Server::new(vec![response(200, OK), response(status, body)]).await;
        assert_eq!(finish(&server).await.unwrap_err().code, code);
        assert_eq!(server.requests.lock().unwrap().len(), 2);
    }
}

#[tokio::test]
async fn cancellation_and_deadline_cover_in_flight_callback_and_status() {
    for prefix in [false, true] {
        let mut responses = Vec::new();
        if prefix {
            responses.push(response(200, OK));
        }
        responses.push(Response::Hang);
        let server = Server::new(responses).await;
        let (tx, rx) = watch::channel(false);
        let future = finish_oauth(
            &server.client,
            STATE,
            callback(),
            Instant::now(),
            Instant::now() + Duration::from_secs(5),
            rx,
            "test",
        );
        let cancel = async {
            while server.requests.lock().unwrap().len() < if prefix { 2 } else { 1 } {
                tokio::task::yield_now().await;
            }
            tx.send(true).unwrap();
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(future, cancel)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap_err().code, "cancelled");
    }
    let server = Server::new(vec![Response::Hang]).await;
    let (_tx, rx) = watch::channel(false);
    let result = finish_oauth(
        &server.client,
        STATE,
        callback(),
        Instant::now(),
        Instant::now() + Duration::from_millis(80),
        rx,
        "test",
    )
    .await;
    assert_eq!(result.unwrap_err().code, "login_timeout");
}

#[tokio::test]
async fn oauth_response_is_bounded_and_http_status_is_preserved() {
    let server = Server::new(vec![response(200, &"x".repeat(16 * 1024 + 1))]).await;
    let reply = server.client.auth_status(STATE).await;
    assert_eq!(reply.http_status, Some(200));
    assert_eq!(
        reply.outcome.unwrap_err().code,
        "oauth_status_invalid_response"
    );
    let server = Server::new(vec![response(200, WAIT), response(200, OK)]).await;
    assert_eq!(
        server.client.auth_status(STATE).await.outcome.unwrap(),
        AuthStatus::Waiting
    );
    assert_eq!(
        server.client.auth_status(STATE).await.outcome.unwrap(),
        AuthStatus::Complete
    );
}

#[tokio::test]
async fn cancelled_or_expired_attempt_does_not_submit_and_conflict_preserves_native_failure() {
    let server = Server::new(vec![]).await;
    let (tx, rx) = watch::channel(true);
    assert_eq!(
        finish_oauth(
            &server.client,
            STATE,
            callback(),
            Instant::now(),
            Instant::now() + Duration::from_secs(5),
            rx.clone(),
            "test"
        )
        .await
        .unwrap_err()
        .code,
        "cancelled"
    );
    tx.send(false).unwrap();
    assert_eq!(
        finish_oauth(
            &server.client,
            STATE,
            callback(),
            Instant::now(),
            Instant::now(),
            rx,
            "test"
        )
        .await
        .unwrap_err()
        .code,
        "login_timeout"
    );
    assert!(server.requests.lock().unwrap().is_empty());
    let server = Server::new(vec![
        response(409, r#"{"error":"oauth flow is not pending"}"#),
        response(
            200,
            r#"{"status":"error","error":"Failed to exchange token"}"#,
        ),
    ])
    .await;
    assert_eq!(
        finish(&server).await.unwrap_err().code,
        "oauth_token_exchange_failed"
    );
    server.assert_single_submission();
}
