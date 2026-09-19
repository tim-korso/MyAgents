//! One retained child tree is the only writer for one registered auth directory.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::json;
use tokio::sync::watch;
use uuid::Uuid;

use super::client::Client;
use super::store::{private_dir, write_atomic};
use super::types::{Error, Result};

pub(super) struct Instance {
    pub generation: String,
    pub account_generation: String,
    pub component_identity: String,
    pub client: Client,
    pub born_at: Instant,
    pub proxy_environment: (Option<String>, BTreeMap<String, String>),
    ready: std::sync::atomic::AtomicBool,
    child: Arc<Mutex<crate::process_cmd::ChildTree>>,
    run_dir: PathBuf,
}

pub(super) fn proxy_environment() -> (Option<String>, BTreeMap<String, String>) {
    let mut command = crate::process_cmd::new("cliproxy-proxy-projection");
    command.env_clear();
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
    ] {
        if let Ok(value) = std::env::var(key) {
            command.env(key, value);
        }
    }
    // Rust owns the immutable inherited baseline; it never receives the
    // Sidecar's general overlay. Only this Provider selects app proxy.
    let selected =
        crate::proxy_config::apply_to_subprocess_for_provider(&mut command, "antigravity-sub");
    let proxy_url = if selected {
        command
            .get_envs()
            .find(|(key, _)| *key == "HTTPS_PROXY")
            .and_then(|(_, value)| value)
            .and_then(|v| v.to_str())
            .map(str::to_owned)
    } else {
        None
    };
    let baseline: BTreeMap<_, _> = command
        .get_envs()
        .filter_map(|(key, value)| Some((key.to_str()?.to_owned(), value?.to_str()?.to_owned())))
        .collect();
    (proxy_url, go_proxy_environment(&baseline))
}

struct PreparingRun(Option<PathBuf>);
impl Drop for PreparingRun {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

impl Instance {
    #[cfg(all(test, unix))]
    pub(super) fn test_process(
        root: &Path,
        account_generation: &str,
        component_identity: &str,
    ) -> Arc<Self> {
        let generation = Uuid::new_v4().to_string();
        let run_dir = root.join(&generation);
        private_dir(&run_dir).unwrap();
        let mut command = crate::process_cmd::new("/bin/sleep");
        command
            .arg("60")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        Arc::new(Self {
            generation,
            account_generation: account_generation.to_owned(),
            component_identity: component_identity.to_owned(),
            client: Client::new(1, random_key(), random_key()).unwrap(),
            born_at: Instant::now(),
            proxy_environment: (Some("http://obsolete.test:1".to_owned()), BTreeMap::new()),
            ready: std::sync::atomic::AtomicBool::new(true),
            child: Arc::new(Mutex::new(
                crate::process_cmd::spawn_tree(&mut command).unwrap(),
            )),
            run_dir,
        })
    }

    #[cfg(all(test, unix))]
    pub(super) fn test_cleanup(&self) {
        let _ = crate::process_cmd::settle_tree(&self.child, Duration::ZERO);
    }

    pub fn ready(&self) -> bool {
        self.ready.load(std::sync::atomic::Ordering::Acquire)
    }

    pub fn alive(&self) -> bool {
        self.child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok())
            .is_some_and(|status| status.is_none())
    }

    pub async fn stop(&self) -> Result<()> {
        let child = Arc::clone(&self.child);
        tauri::async_runtime::spawn_blocking(move || {
            crate::process_cmd::settle_tree(&child, Duration::ZERO)
        })
        .await
        .map_err(|_| Error::new("process_stop", "无法确认组件退出"))?
        .map_err(|_| Error::new("process_stop", "组件仍未退出，请重试清理"))?;
        match std::fs::remove_dir_all(&self.run_dir) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(Error::storage()),
        }
    }

    pub fn spawn(
        executable: &Path,
        auth_dir: &Path,
        run_root: &Path,
        account_generation: &str,
        component_identity: &str,
    ) -> Result<Arc<Self>> {
        let port = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| Error::new("local_port", "无法分配组件本机端口"))?
            .local_addr()
            .map_err(|_| Error::contract())?
            .port();
        let generation = Uuid::new_v4().to_string();
        let run_dir = run_root.join(&generation);
        private_dir(&run_dir)?;
        let mut preparing = PreparingRun(Some(run_dir.clone()));
        private_dir(auth_dir)?;
        let model_key = random_key();
        let management_key = random_key();
        let client = Client::new(port, management_key.clone(), model_key.clone())?;
        let mut command = crate::process_cmd::new(executable);
        command.env_clear();
        for key in [
            "HOME",
            "USERPROFILE",
            "SystemRoot",
            "WINDIR",
            "TEMP",
            "TMP",
            "TMPDIR",
            "PATH",
            "LANG",
            "LC_ALL",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        let proxy_environment = proxy_environment();
        command.envs(&proxy_environment.1);
        let config = controlled_config(
            port,
            auth_dir,
            &model_key,
            &management_key,
            proxy_environment.0.as_deref(),
        );
        let config_path = run_dir.join("config.yaml");
        write_atomic(
            &config_path,
            serde_yaml::to_string(&config)
                .map_err(|_| Error::contract())?
                .as_bytes(),
        )?;
        command
            .current_dir(&run_dir)
            .arg("-config")
            .arg(&config_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = match crate::process_cmd::spawn_tree(&mut command) {
            Ok(child) => child,
            Err(_) => {
                let _ = std::fs::remove_dir_all(&run_dir);
                return Err(Error::new("process_start", "无法启动内置模型组件"));
            }
        };
        preparing.0 = None;
        Ok(Arc::new(Self {
            generation,
            account_generation: account_generation.to_owned(),
            component_identity: component_identity.to_owned(),
            client,
            born_at: Instant::now(),
            proxy_environment,
            ready: std::sync::atomic::AtomicBool::new(false),
            child: Arc::new(Mutex::new(child)),
            run_dir,
        }))
    }

    /// The manager retains this instance before awaiting probes. A stop failure
    /// therefore cannot orphan a writer and let a retry reuse its auth-dir.
    pub async fn wait_ready(&self, mut cancelled: watch::Receiver<bool>) -> Result<()> {
        if *cancelled.borrow() {
            return Err(Error::cancelled());
        }
        let instance = self;
        let check = async {
            loop {
                if !instance.alive() {
                    return Err(Error::new("process_start", "组件在启动时退出"));
                }
                if instance.client.health().await.is_ok()
                    && instance.client.account().await.is_ok()
                    && instance.client.routed_models().await.is_ok()
                    && instance.alive()
                {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        };
        let checked = tokio::select! {
            biased;
            _ = cancelled.changed() => Err(Error::cancelled()),
            result = tokio::time::timeout(Duration::from_secs(20), check) =>
                result.unwrap_or_else(|_| Err(Error::new("process_start", "组件启动检查超时"))),
        };
        checked?;
        if *cancelled.borrow() {
            return Err(Error::cancelled());
        }
        self.ready.store(true, std::sync::atomic::Ordering::Release);
        Ok(())
    }

    #[cfg(test)]
    pub async fn start(
        executable: &Path,
        auth_dir: &Path,
        run_root: &Path,
        account_generation: &str,
        component_identity: &str,
        cancelled: watch::Receiver<bool>,
    ) -> Result<Arc<Self>> {
        let instance = Self::spawn(
            executable,
            auth_dir,
            run_root,
            account_generation,
            component_identity,
        )?;
        if let Err(error) = instance.wait_ready(cancelled).await {
            instance.stop().await?;
            return Err(error);
        }
        Ok(instance)
    }
}

fn random_key() -> String {
    // Three UUID v4 values contain 366 CSPRNG bits. Base64url stays at 64
    // bytes, below the upstream management key's bcrypt limit of 72 bytes.
    let bytes: Vec<u8> = (0..3).flat_map(|_| Uuid::new_v4().into_bytes()).collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn controlled_config(
    port: u16,
    auth_dir: &Path,
    model_key: &str,
    management_key: &str,
    proxy_url: Option<&str>,
) -> serde_json::Value {
    json!({
        "host": "127.0.0.1", "port": port, "auth-dir": auth_dir,
        "api-keys": [model_key], "proxy-url": proxy_url.unwrap_or(""),
        "remote-management": { "allow-remote": false, "secret-key": management_key, "disable-control-panel": true },
        "plugins": { "enabled": false }, "pprof": { "enable": false },
        "commercial-mode": true, "logging-to-file": false, "request-log": false,
        "usage-statistics-enabled": false, "request-retry": 0,
        "claude-code": { "disable-cloaking-model-list": true },
        "streaming": { "keepalive-seconds": 15, "bootstrap-retries": 0 },
        "quota-exceeded": { "switch-project": false, "switch-preview-model": false, "antigravity-credits": false }
    })
}

/// Go's ProxyFromEnvironment consumes per-scheme proxy variables and NO_PROXY.
/// Project inherited ALL_PROXY into only missing per-scheme values, retaining
/// the native bypass matcher instead of forcing one global proxy-url.
fn go_proxy_environment(env: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut projected = env.clone();
    let nonempty = |key: &str| env.get(key).filter(|s| !s.is_empty());
    if let Some(all) = nonempty("ALL_PROXY").or_else(|| nonempty("all_proxy")) {
        for (upper, lower) in [("HTTP_PROXY", "http_proxy"), ("HTTPS_PROXY", "https_proxy")] {
            if nonempty(upper).or_else(|| nonempty(lower)).is_none() {
                projected.insert(upper.to_owned(), all.clone());
            }
        }
    }
    projected
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn final_environment_keeps_app_overrides_exclusions_and_removed_inherited_proxy() {
        // The shared provider helper has selected the app proxy, removed ALL,
        // and installed loopback exclusions. Its whole output is authoritative.
        let projected = BTreeMap::from([
            (
                "HTTP_PROXY".to_owned(),
                "http://app-proxy.test:1234".to_owned(),
            ),
            (
                "HTTPS_PROXY".to_owned(),
                "http://app-proxy.test:1234".to_owned(),
            ),
            ("NO_PROXY".to_owned(), "localhost,127.0.0.1,::1".to_owned()),
            ("no_proxy".to_owned(), "localhost,127.0.0.1,::1".to_owned()),
        ]);
        let final_env = go_proxy_environment(&projected);
        assert_eq!(final_env, projected);
        assert!(!final_env.contains_key("ALL_PROXY"));
        assert!(!final_env.contains_key("all_proxy"));
    }

    #[test]
    fn inherited_all_proxy_does_not_override_scheme_or_bypass() {
        let env = BTreeMap::from([
            ("ALL_PROXY".to_owned(), "socks5://127.0.0.1:1234".to_owned()),
            ("https_proxy".to_owned(), "http://127.0.0.1:2345".to_owned()),
            ("NO_PROXY".to_owned(), "example.test".to_owned()),
        ]);
        assert_eq!(go_proxy_environment(&env), {
            let mut expected = env.clone();
            expected.insert(
                "HTTP_PROXY".to_owned(),
                "socks5://127.0.0.1:1234".to_owned(),
            );
            expected
        });
    }
    #[test]
    fn generated_config_disables_native_broad_surfaces_and_paid_fallback() {
        let value = controlled_config(1234, Path::new("/tmp/auth"), "model", "management", None);
        assert_eq!(value["host"], "127.0.0.1");
        assert_eq!(value["remote-management"]["allow-remote"], false);
        assert_eq!(value["commercial-mode"], true);
        assert_eq!(value["quota-exceeded"]["antigravity-credits"], false);
        assert_ne!(random_key(), random_key());
        let key = random_key();
        assert_eq!(key.len(), 64);
        assert_eq!(
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(key)
                .unwrap()
                .len(),
            48
        );
    }
}
