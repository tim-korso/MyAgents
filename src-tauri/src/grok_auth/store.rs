use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::types::{GrokAccountSummary, GrokAuthError, GrokAuthErrorCode};

pub const STORE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedOauthEndpoints {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokGrant {
    /** Stable identity for the device-login grant across access/refresh rotation. */
    #[serde(default)]
    pub lineage: String,
    pub access_token: String,
    pub refresh_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    pub token_type: String,
    pub issued_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
    pub credential_version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_refresh_at: Option<String>,
    pub endpoints: ValidatedOauthEndpoints,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokCredentialStore {
    pub schema_version: u32,
    pub next_credential_version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant: Option<GrokGrant>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<GrokAccountSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_auth_error: Option<GrokAuthError>,
    #[serde(default)]
    pub quarantined: bool,
}

impl Default for GrokCredentialStore {
    fn default() -> Self {
        Self {
            schema_version: STORE_SCHEMA_VERSION,
            next_credential_version: 1,
            grant: None,
            account: None,
            verified_at: None,
            verification_state: None,
            last_auth_error: None,
            quarantined: false,
        }
    }
}

pub fn auth_store_path() -> Result<PathBuf, GrokAuthError> {
    let root = crate::app_dirs::myagents_data_dir().ok_or_else(|| {
        GrokAuthError::new(
            GrokAuthErrorCode::Internal,
            "Cannot determine MyAgents data directory",
        )
    })?;
    Ok(root.join("credentials").join("grok-oauth.json"))
}

pub fn auth_lock_path(store_path: &Path) -> PathBuf {
    let mut value = store_path.as_os_str().to_os_string();
    value.push(".lock");
    PathBuf::from(value)
}

pub fn read_store(path: &Path) -> Result<GrokCredentialStore, GrokAuthError> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            let state: GrokCredentialStore = serde_json::from_str(&raw).map_err(|_| {
                GrokAuthError::new(
                    GrokAuthErrorCode::StoreCorrupt,
                    "Grok 登录凭据已损坏，请重新登录",
                )
            })?;
            if state.schema_version != STORE_SCHEMA_VERSION {
                return Err(GrokAuthError::new(
                    GrokAuthErrorCode::StoreCorrupt,
                    "Grok 登录凭据版本不受支持，请重新登录",
                ));
            }
            if state.grant.as_ref().is_some_and(|grant| {
                grant.access_token.trim().is_empty() || grant.refresh_token.trim().is_empty()
            }) {
                return Err(GrokAuthError::new(
                    GrokAuthErrorCode::StoreCorrupt,
                    "Grok 登录凭据不完整，请重新登录",
                ));
            }
            Ok(state)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(GrokCredentialStore::default())
        }
        Err(_) => Err(GrokAuthError::new(
            GrokAuthErrorCode::Internal,
            "无法读取 Grok 登录凭据",
        )),
    }
}

pub fn write_store_atomic(path: &Path, state: &GrokCredentialStore) -> Result<(), GrokAuthError> {
    let parent = path.parent().ok_or_else(|| {
        GrokAuthError::new(GrokAuthErrorCode::Internal, "Invalid Grok credential path")
    })?;
    fs::create_dir_all(parent)
        .map_err(|_| GrokAuthError::new(GrokAuthErrorCode::Internal, "无法创建 Grok 凭据目录"))?;

    let tmp = parent.join(format!(
        ".grok-oauth.{}.{}.tmp",
        std::process::id(),
        Uuid::new_v4()
    ));
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|_| GrokAuthError::new(GrokAuthErrorCode::Internal, "无法序列化 Grok 登录凭据"))?;

    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&tmp)
        .map_err(|_| GrokAuthError::new(GrokAuthErrorCode::Internal, "无法写入 Grok 登录凭据"))?;
    let write_result = (|| -> Result<(), GrokAuthError> {
        file.write_all(&bytes).map_err(|_| {
            GrokAuthError::new(GrokAuthErrorCode::Internal, "无法写入 Grok 登录凭据")
        })?;
        file.sync_all().map_err(|_| {
            GrokAuthError::new(GrokAuthErrorCode::Internal, "无法同步 Grok 登录凭据")
        })?;
        drop(file);
        fs::rename(&tmp, path).map_err(|_| {
            GrokAuthError::new(GrokAuthErrorCode::Internal, "无法替换 Grok 登录凭据")
        })?;
        harden_permissions(path);
        fsync_parent(parent)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    write_result
}

pub fn quarantine_corrupt_store(path: &Path) {
    if fs::symlink_metadata(path).is_err() {
        return;
    }
    let suffix = Utc::now().format("%Y%m%d%H%M%S");
    let quarantine = path.with_file_name(format!("grok-oauth.corrupt-{}.json", suffix));
    let _ = fs::rename(path, quarantine);
}

fn fsync_parent(_parent: &Path) -> Result<(), GrokAuthError> {
    #[cfg(unix)]
    {
        let parent = _parent;
        let dir = fs::File::open(parent).map_err(|_| {
            GrokAuthError::new(GrokAuthErrorCode::Internal, "无法同步 Grok 凭据目录")
        })?;
        dir.sync_all().map_err(|_| {
            GrokAuthError::new(GrokAuthErrorCode::Internal, "无法同步 Grok 凭据目录")
        })?;
    }
    Ok(())
}

fn harden_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
            crate::ulog_warn!(
                "[grok-auth] failed to harden credential permissions path={} error={}",
                path.display(),
                error
            );
        }
    }

    #[cfg(target_os = "windows")]
    harden_windows_acl(path);
}

#[cfg(target_os = "windows")]
fn harden_windows_acl(path: &Path) {
    use base64::{engine::general_purpose, Engine as _};

    let Some(raw_path) = path.to_str() else {
        crate::ulog_warn!("[grok-auth] cannot harden non-UTF8 credential path");
        return;
    };
    let encoded_path = general_purpose::STANDARD.encode(raw_path.as_bytes());
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded_path}'))
$acl = Get-Acl -LiteralPath $path
$acl.SetAccessRuleProtection($true, $false)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $path -AclObject $acl"#
    );
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect();
    let encoded_script = general_purpose::STANDARD.encode(utf16);
    let powershell =
        crate::system_binary::find("powershell").or_else(|| crate::system_binary::find("pwsh"));
    let Some(powershell) = powershell else {
        crate::ulog_warn!("[grok-auth] PowerShell unavailable; cannot harden credential ACL");
        return;
    };
    match crate::process_cmd::new(powershell)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded_script,
        ])
        .output()
    {
        Ok(output) if output.status.success() => {}
        Ok(output) => crate::ulog_warn!(
            "[grok-auth] failed to harden credential ACL exit={:?}",
            output.status.code()
        ),
        Err(error) => crate::ulog_warn!(
            "[grok-auth] failed to run ACL hardening helper error={}",
            error
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_store_round_trips_atomically() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("credentials").join("grok-oauth.json");
        let mut state = GrokCredentialStore::default();
        state.account = Some(GrokAccountSummary {
            email: Some("user@example.com".to_string()),
            display_name: Some("User".to_string()),
        });
        state.verification_state = Some("valid".to_string());
        write_store_atomic(&path, &state).unwrap();
        let restored = read_store(&path).unwrap();
        assert_eq!(restored.schema_version, STORE_SCHEMA_VERSION);
        assert_eq!(
            restored
                .account
                .and_then(|account| account.email)
                .as_deref(),
            Some("user@example.com")
        );
        assert!(!temp
            .path()
            .join("credentials")
            .read_dir()
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().ends_with(".tmp")));
    }

    #[cfg(unix)]
    #[test]
    fn credential_store_is_owner_only_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("grok-oauth.json");
        write_store_atomic(&path, &GrokCredentialStore::default()).unwrap();
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn corrupt_store_is_not_silently_treated_as_logged_out() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("grok-oauth.json");
        fs::write(&path, "{not-json").unwrap();
        let error = read_store(&path).unwrap_err();
        assert_eq!(error.code, GrokAuthErrorCode::StoreCorrupt);
        quarantine_corrupt_store(&path);
        assert!(!path.exists());
        assert!(temp.path().read_dir().unwrap().flatten().any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with("grok-oauth.corrupt-")));
    }

    #[test]
    fn structurally_valid_store_with_empty_tokens_is_corrupt() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("grok-oauth.json");
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": STORE_SCHEMA_VERSION,
                "nextCredentialVersion": 2,
                "grant": {
                    "lineage": "login-1",
                    "accessToken": "",
                    "refreshToken": "refresh",
                    "tokenType": "Bearer",
                    "issuedAt": 1,
                    "credentialVersion": 1,
                    "endpoints": {
                        "authorizationEndpoint": "https://auth.x.ai/oauth2/authorize",
                        "tokenEndpoint": "https://auth.x.ai/oauth2/token"
                    }
                },
                "quarantined": false
            }))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            read_store(&path).unwrap_err().code,
            GrokAuthErrorCode::StoreCorrupt
        );
    }
}
