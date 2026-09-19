//! Bounded download primitives. Resource owners validate URLs and signatures;
//! this module owns byte limits, deadlines, hashing and file completion only.
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::time::Duration;

#[derive(Debug)]
pub(crate) enum DownloadError {
    Http(u16),
    Transport(String),
    SizeLimit,
    Storage(String),
}
impl std::fmt::Display for DownloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(status) => write!(f, "[resource-download] HTTP {status}"),
            Self::Transport(message) | Self::Storage(message) => f.write_str(message),
            Self::SizeLimit => f.write_str("[resource-download] Artifact exceeded max size"),
        }
    }
}

pub(crate) async fn fetch_limited_bytes(
    client: &reqwest::Client,
    url: &str,
    max_bytes: u64,
    label: &str,
) -> Result<Vec<u8>, DownloadError> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| DownloadError::Transport(format!("[resource-download] Failed to fetch {}: {}", label, e)))?;
    if !response.status().is_success() {
        return Err(DownloadError::Http(response.status().as_u16()));
    }
    if response.content_length().unwrap_or(0) > max_bytes {
        return Err(DownloadError::SizeLimit);
    }
    let mut out = Vec::new();
    let mut total = 0u64;
    loop {
        let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| DownloadError::Transport(format!("[resource-download] Failed to read {}: {}", label, e)))?
        else {
            break;
        };
        total += chunk.len() as u64;
        if total > max_bytes {
            return Err(DownloadError::SizeLimit);
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

pub(crate) async fn download_to_file_with_hash(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    max_bytes: u64,
    progress_total_bytes: Option<u64>,
    attempt_timeout: Duration,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<(u64, String), DownloadError> {
    tokio::time::timeout(attempt_timeout, async {
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|e| {
                DownloadError::Transport(format!(
                    "[resource-download] Failed to download artifact: {}",
                    e
                ))
            })?
            .error_for_status()
            .map_err(|e| {
                DownloadError::Transport(format!(
                    "[resource-download] Failed to download artifact: {}",
                    e
                ))
            })?;
        if response.content_length().unwrap_or(0) > max_bytes {
            return Err(DownloadError::SizeLimit);
        }
        let total_for_progress = progress_total_bytes.or_else(|| response.content_length());
        on_progress(0, total_for_progress);
        let mut file = File::create(path).map_err(|e| {
            DownloadError::Storage(format!(
                "[resource-download] Failed to create artifact file: {}",
                e
            ))
        })?;
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|e| {
            DownloadError::Transport(format!(
                "[resource-download] Failed to read artifact: {}",
                e
            ))
        })? {
            total += chunk.len() as u64;
            if total > max_bytes {
                return Err(DownloadError::SizeLimit);
            }
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| {
                DownloadError::Storage(format!(
                    "[resource-download] Failed to write artifact: {}",
                    e
                ))
            })?;
            on_progress(total, total_for_progress);
        }
        file.sync_all().map_err(|e| {
            DownloadError::Storage(format!("[resource-download] Failed to sync artifact: {e}"))
        })?;
        Ok((total, format!("{:x}", hasher.finalize())))
    })
    .await
    .map_err(|_| {
        DownloadError::Transport(format!(
            "[resource-download] Artifact download attempt exceeded {} seconds",
            attempt_timeout.as_secs()
        ))
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn bounded_fetch_retains_http_status_for_resource_owner_diagnostics() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tauri::async_runtime::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            assert!(stream.read(&mut request).await.unwrap() > 0);
            stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let result = fetch_limited_bytes(&crate::local_http::json_client(Duration::from_secs(2)),
            &format!("http://{address}/manifest"), 1024, "test manifest").await;
        assert!(matches!(result, Err(DownloadError::Http(404))));
        server.await.unwrap();
    }
}
