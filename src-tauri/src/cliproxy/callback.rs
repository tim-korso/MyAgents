//! Temporary browser transport only. The native proxy generates and consumes
//! OAuth state; this receiver never constructs an authorization request.
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

use super::types::{Error, Result};

pub(super) const CALLBACK_PORT: u16 = 51121;
const MAX_REQUEST_BYTES: usize = 16 * 1024;

pub(super) struct Callback {
    pub code: Option<String>,
    pub error: Option<String>,
}

pub(super) struct Receiver {
    v4: TcpListener,
    v6: Option<TcpListener>,
    port: u16,
}

impl Receiver {
    pub async fn bind() -> Result<Self> {
        Self::bind_port(CALLBACK_PORT).await
    }

    async fn bind_port(port: u16) -> Result<Self> {
        let v4 = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
            .await
            .map_err(|_| Error::new("callback_port", "登录回调端口被占用，请关闭占用程序后重试"))?;
        let port = v4.local_addr().map_err(|_| Error::contract())?.port();
        let v6 = match TcpListener::bind((Ipv6Addr::LOCALHOST, port)).await {
            Ok(listener) => Some(listener),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::AddrNotAvailable | std::io::ErrorKind::Unsupported
                ) =>
            {
                None
            }
            Err(_) => {
                return Err(Error::new(
                    "callback_port",
                    "IPv6 登录回调端口不可用，请检查占用程序",
                ))
            }
        };
        Ok(Self { v4, v6, port })
    }

    pub async fn receive(
        self,
        state: &str,
        mut cancelled: watch::Receiver<bool>,
    ) -> Result<Callback> {
        let deadline = tokio::time::sleep(Duration::from_secs(5 * 60));
        tokio::pin!(deadline);
        loop {
            if *cancelled.borrow() {
                return Err(Error::cancelled());
            }
            let accepted = tokio::select! {
                biased;
                _ = cancelled.changed() => return Err(Error::cancelled()),
                _ = &mut deadline => return Err(Error::new("login_timeout", "浏览器授权已超时，请重试")),
                result = self.v4.accept() => result,
                result = async { match &self.v6 {
                    Some(listener) => listener.accept().await,
                    None => std::future::pending().await,
                }} => result,
            };
            let (socket, peer) =
                accepted.map_err(|_| Error::new("callback_listener", "无法接收浏览器授权结果"))?;
            if !peer.ip().is_loopback() {
                continue;
            }
            let result = tokio::select! {
                biased;
                _ = cancelled.changed() => return Err(Error::cancelled()),
                _ = &mut deadline => return Err(Error::new("login_timeout", "浏览器授权已超时，请重试")),
                result = tokio::time::timeout(Duration::from_secs(2), handle(socket, state, self.port)) => result,
            };
            if let Ok(Ok(Some(callback))) = result {
                return Ok(callback);
            }
        }
    }
}

pub(super) fn validate_authorization_url(raw: &str, state: &str) -> Result<()> {
    if raw.len() > 16 * 1024 || state.is_empty() || state.len() > 1024 {
        return Err(Error::contract());
    }
    let url = url::Url::parse(raw).map_err(|_| Error::contract())?;
    if url.scheme() != "https"
        || url.host_str() != Some("accounts.google.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::contract());
    }
    let params = unique_params(url.query().unwrap_or(""))?;
    if params.get("state").map(String::as_str) != Some(state)
        || params.get("redirect_uri").map(String::as_str)
            != Some("http://localhost:51121/oauth-callback")
    {
        return Err(Error::contract());
    }
    Ok(())
}

fn unique_params(query: &str) -> Result<HashMap<String, String>> {
    let mut params = HashMap::new();
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        if params
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err(Error::contract());
        }
    }
    Ok(params)
}

fn parse_request(raw: &[u8], expected_state: &str, port: u16) -> Result<Callback> {
    let text = std::str::from_utf8(raw).map_err(|_| Error::contract())?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next().ok_or_else(Error::contract)?;
    let parts: Vec<_> = request_line.split(' ').collect();
    if parts.len() != 3
        || parts[0] != "GET"
        || !matches!(parts[2], "HTTP/1.1" | "HTTP/1.0")
        || !parts[1].starts_with("/oauth-callback?")
    {
        return Err(Error::contract());
    }
    let mut host = None;
    for line in lines.take_while(|line| !line.is_empty()) {
        let (key, value) = line.split_once(':').ok_or_else(Error::contract)?;
        if key.eq_ignore_ascii_case("host") {
            if host.replace(value.trim().to_ascii_lowercase()).is_some() {
                return Err(Error::contract());
            }
        }
        if key.eq_ignore_ascii_case("transfer-encoding")
            || (key.eq_ignore_ascii_case("content-length") && value.trim() != "0")
        {
            return Err(Error::contract());
        }
    }
    let host = host.ok_or_else(Error::contract)?;
    if ![
        format!("localhost:{port}"),
        format!("127.0.0.1:{port}"),
        format!("[::1]:{port}"),
    ]
    .contains(&host)
    {
        return Err(Error::contract());
    }
    let query = parts[1]
        .strip_prefix("/oauth-callback?")
        .ok_or_else(Error::contract)?;
    if query.contains('#') {
        return Err(Error::contract());
    }
    let mut params = unique_params(query)?;
    if params.remove("state").as_deref() != Some(expected_state) {
        return Err(Error::contract());
    }
    let code = params.remove("code").filter(|s| !s.is_empty());
    let error = params.remove("error").filter(|s| !s.is_empty());
    if code.is_some() == error.is_some() {
        return Err(Error::contract());
    }
    Ok(Callback { code, error })
}

async fn handle(
    mut socket: TcpStream,
    state: &str,
    port: u16,
) -> std::io::Result<Option<Callback>> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 1024];
    loop {
        let n = socket.read(&mut chunk).await?;
        if n == 0 || bytes.len() + n > MAX_REQUEST_BYTES {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk[..n]);
        if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let callback = parse_request(&bytes, state, port).ok();
    let status = if callback.is_some() {
        "200 OK"
    } else {
        "400 Bad Request"
    };
    let body = if callback.is_some() {
        "授权结果已收到，请返回 MyAgents。"
    } else {
        "此授权回调无效，请返回 MyAgents。"
    };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
    // Receiving a valid callback is the boundary. A browser that disconnects
    // while receiving this informational page must not lose its OAuth result.
    let _ = socket.write_all(response.as_bytes()).await;
    Ok(callback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_rejects_wrong_origin_state_ambiguous_params_and_bodies() {
        let valid = "GET /oauth-callback?state=abc&code=secret&scope=x HTTP/1.1\r\nHost: localhost:51121\r\n\r\n";
        assert_eq!(
            parse_request(valid.as_bytes(), "abc", CALLBACK_PORT)
                .unwrap()
                .code
                .as_deref(),
            Some("secret")
        );
        for invalid in [
            valid.replace("state=abc", "state=other"),
            valid.replace("scope=x", "state=abc"),
            valid.replace("localhost:51121", "evil.example:51121"),
            valid.replace("GET ", "POST "),
            valid.replace("scope=x", "error=denied"),
            valid.replace("\r\n\r\n", "\r\nContent-Length: 1\r\n\r\nx"),
        ] {
            assert!(parse_request(invalid.as_bytes(), "abc", CALLBACK_PORT).is_err());
        }
    }

    #[test]
    fn authorization_url_preserves_native_state_and_fixed_redirect() {
        let valid = "https://accounts.google.com/o/oauth2/v2/auth?state=abc&redirect_uri=http%3A%2F%2Flocalhost%3A51121%2Foauth-callback";
        assert!(validate_authorization_url(valid, "abc").is_ok());
        for invalid in [
            valid.replace("https:", "http:"),
            valid.replace("accounts.google.com", "accounts.google.com.evil.test"),
            valid.replace("51121", "51122"),
            format!("{valid}&state=abc"),
        ] {
            assert!(validate_authorization_url(&invalid, "abc").is_err());
        }
    }

    #[tokio::test]
    async fn loopback_receiver_releases_both_listeners_on_cancel() {
        let receiver = Receiver::bind_port(0).await.unwrap();
        let port = receiver.port;
        let (cancel, rx) = watch::channel(false);
        cancel.send(true).unwrap();
        assert_eq!(
            receiver.receive("state", rx).await.err().unwrap().code,
            "cancelled"
        );
        assert!(Receiver::bind_port(port).await.is_ok());
    }
}
