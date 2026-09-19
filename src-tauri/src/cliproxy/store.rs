//! Lifecycle metadata only. Never parse, snapshot or restore native token files.
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::types::{Error, Result};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AccountRef {
    pub id: String,
    pub generation: String,
    pub attempt_id: String,
    pub phase: String,
    #[serde(default)]
    pub authorized_at: Option<String>,
    pub verified_model: Option<String>,
    pub verified_at: Option<String>,
    pub verification_identity: Option<String>,
    #[serde(default)]
    pub model_checks: BTreeMap<String, ModelCheck>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ModelCheck {
    pub status: super::types::TerminalOutcome,
    pub checked_at: String,
    pub component_identity: String,
}

impl AccountRef {
    pub fn candidate() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            generation: Uuid::new_v4().to_string(),
            attempt_id: Uuid::new_v4().to_string(),
            phase: "authorizing".to_owned(),
            authorized_at: None,
            verified_model: None,
            verified_at: None,
            verification_identity: None,
            model_checks: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Accounts {
    pub active: Option<AccountRef>,
    pub candidate: Option<AccountRef>,
    /// Set in the same atomic record as an account replacement or deletion.
    pub cleanup: BTreeSet<String>,
    pub disconnecting: bool,
}

impl Accounts {
    fn validate(&self) -> Result<()> {
        if self.cleanup.len() > 3 {
            return Err(Error::storage());
        }
        let mut ids = BTreeSet::new();
        for account in self.active.iter().chain(self.candidate.iter()) {
            if !ids.insert(&account.id)
                || [
                    account.id.as_str(),
                    &account.generation,
                    &account.attempt_id,
                ]
                .iter()
                .any(|s| Uuid::parse_str(s).is_err())
            {
                return Err(Error::storage());
            }
        }
        if self.cleanup.iter().any(|id| Uuid::parse_str(id).is_err()) {
            return Err(Error::storage());
        }
        Ok(())
    }
    pub fn registered_ids(&self) -> BTreeSet<String> {
        self.active
            .iter()
            .chain(self.candidate.iter())
            .map(|a| a.id.clone())
            .chain(self.cleanup.iter().cloned())
            .collect()
    }
    pub fn begin_disconnect(&mut self) {
        self.cleanup = self.registered_ids();
        self.disconnecting = true;
    }
    pub fn begin_cancel_candidate(&mut self) {
        if let Some(candidate) = &mut self.candidate {
            self.cleanup.insert(candidate.id.clone());
            candidate.phase = "cancelling".to_owned();
        }
    }
    pub fn commit_candidate(&mut self, generation: &str) -> Result<()> {
        let candidate = self.candidate.as_ref().ok_or_else(Error::cancelled)?;
        if self.disconnecting
            || self.cleanup.contains(&candidate.id)
            || candidate.generation != generation
            || candidate.authorized_at.is_none()
        {
            return Err(Error::cancelled());
        }
        if let Some(old) = &self.active {
            self.cleanup.insert(old.id.clone());
        }
        self.active = self.candidate.take();
        Ok(())
    }
}

#[derive(Clone)]
pub(super) struct Store {
    pub root: PathBuf,
}

impl Store {
    pub fn account_root(&self) -> PathBuf {
        self.root.join("antigravity-sub")
    }
    pub fn auth_dir(&self, id: &str) -> Result<PathBuf> {
        if Uuid::parse_str(id).is_err() {
            return Err(Error::storage());
        }
        Ok(self.account_root().join("accounts").join(id).join("auth"))
    }
    pub fn read_accounts(&self) -> Result<Accounts> {
        let value: Accounts =
            read_json(&self.account_root().join("account-state.json"))?.unwrap_or_default();
        value.validate()?;
        Ok(value)
    }
    pub fn write_accounts(&self, accounts: &Accounts) -> Result<()> {
        accounts.validate()?;
        write_json(&self.account_root().join("account-state.json"), accounts)
    }
    /// The caller must already have registered this ID durably, and must stop
    /// the sole native writer before calling remove_account.
    pub fn create_account(&self, id: &str) -> Result<PathBuf> {
        let auth_dir = self.auth_dir(id)?;
        private_dir(&auth_dir)?;
        Ok(auth_dir)
    }
    pub fn remove_account(&self, id: &str) -> Result<()> {
        let auth_dir = self.auth_dir(id)?;
        let directory = auth_dir.parent().ok_or_else(Error::storage)?;
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => {
                fs::remove_dir_all(directory).map_err(|_| Error::storage())?;
                crate::durable_fs::sync_directory(directory.parent().ok_or_else(Error::storage)?)
                    .map_err(|_| Error::storage())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => Err(Error::storage()),
        }
    }
}

pub(super) fn private_dir(path: &Path) -> Result<()> {
    ensure_private_dir(path, true)
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // includes junctions, not only symlinks
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn ensure_private_dir(path: &Path, restrict_existing: bool) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_dir() || is_link(&meta) => return Err(Error::storage()),
        Ok(_) => {
            return if restrict_existing {
                restrict_permissions(path, true)
            } else {
                Ok(())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Existing ancestors may be a user's home or a test scratch root;
            // creating our child must not rewrite those directories' ACLs.
            if let Some(parent) = path.parent() {
                ensure_private_dir(parent, false)?;
            }
            match fs::create_dir(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    return private_dir(path)
                }
                Err(_) => return Err(Error::storage()),
            }
        }
        Err(_) => return Err(Error::storage()),
    }
    restrict_permissions(path, true)
}

#[cfg(unix)]
fn restrict_permissions(path: &Path, directory: bool) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
    )
    .map_err(|_| Error::storage())
}

#[cfg(windows)]
fn restrict_permissions(path: &Path, _directory: bool) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
    use windows_sys::Win32::Security::{
        SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    };
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // Protected DACL; Owner Rights is inherited by files and directories.
    // No Users/Everyone ACE. Native files are created by the same user.
    let sddl: Vec<u16> = "D:P(A;OICI;FA;;;OW)"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut descriptor = std::ptr::null_mut();
    unsafe {
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(Error::storage());
        }
        let ok = SetFileSecurityW(
            name.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        );
        LocalFree(descriptor);
        if ok == 0 {
            return Err(Error::storage());
        }
    }
    Ok(())
}

pub(super) fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !is_link(&meta) && meta.len() <= 2 * 1024 * 1024 => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        _ => return Err(Error::storage()),
    }
    let bytes = fs::read(path).map_err(|_| Error::storage())?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| {
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("state.json");
            // Do not log parser text: it can include values from the document.
            crate::ulog_warn!("[cliproxy] state decode failed file={} category={:?} line={} column={}",
                name, error.classify(), error.line(), error.column());
            Error::new("state_format", format!("组件状态文件 {name} 格式不兼容或已损坏"))
        })
}

pub(super) fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| Error::storage())?;
    write_atomic(path, &bytes)
}

pub(super) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(Error::storage)?;
    private_dir(parent)?;
    let temp = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| Error::storage())?;
        restrict_permissions(&temp, false)?;
        file.write_all(bytes).map_err(|_| Error::storage())?;
        file.sync_all().map_err(|_| Error::storage())?;
        drop(file);
        fs::rename(&temp, path).map_err(|_| Error::storage())?;
        // Rename is the publication point. A failed directory flush must not
        // make an owner restore the pre-commit identity while disk shows new.
        crate::durable_fs::sync_directory(parent)
            .map_err(|_| Error::new("storage_sync", "状态已写入，但无法确认持久保存，请重试"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_state_is_distinct_from_an_io_failure() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("account-state.json");
        fs::write(&path, br#"{"active":"secret-value"}"#).unwrap();
        let error = read_json::<Accounts>(&path).err().unwrap();
        assert_eq!(error.code, "state_format");
        assert!(error.message.contains("account-state.json"));
        assert!(!error.message.contains("secret-value"));
        assert_eq!(read_json::<Accounts>(temp.path()).err().unwrap().code, "storage");
    }

    #[test]
    fn replacement_and_cleanup_intent_share_one_commit() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store {
            root: temp.path().to_owned(),
        };
        let old = AccountRef::candidate();
        let mut next = AccountRef::candidate();
        next.phase = "authorized".to_owned();
        next.authorized_at = Some("2026-09-13T00:00:00Z".to_owned());
        let mut state = Accounts {
            active: Some(old.clone()),
            candidate: Some(next.clone()),
            ..Default::default()
        };
        store.write_accounts(&state).unwrap();
        state.commit_candidate(&next.generation).unwrap();
        store.write_accounts(&state).unwrap();
        let mut restored = store.read_accounts().unwrap();
        assert_eq!(restored.active.as_ref().unwrap().id, next.id);
        assert!(restored.cleanup.contains(&old.id));
        assert!(restored.candidate.is_none());
        restored.begin_disconnect();
        store.write_accounts(&restored).unwrap();
        let restored = store.read_accounts().unwrap();
        assert!(restored.disconnecting);
        assert_eq!(restored.cleanup.len(), 2);
    }
    #[test]
    fn cancelling_candidate_cannot_commit_or_delete_active() {
        let old = AccountRef::candidate();
        let mut next = AccountRef::candidate();
        next.phase = "authorized".to_owned();
        next.authorized_at = Some("2026-09-13T00:00:00Z".to_owned());
        let mut state = Accounts {
            active: Some(old.clone()),
            candidate: Some(next.clone()),
            ..Default::default()
        };
        state.begin_cancel_candidate();
        assert!(state.commit_candidate(&next.generation).is_err());
        assert!(!state.cleanup.contains(&old.id));
    }

    #[test]
    fn native_authorization_commits_without_model_verification() {
        let mut candidate = AccountRef::candidate();
        candidate.phase = "authorized".to_owned();
        candidate.authorized_at = Some("2026-09-13T00:00:00Z".to_owned());
        let mut accounts = Accounts {
            candidate: Some(candidate.clone()),
            ..Accounts::default()
        };
        accounts.commit_candidate(&candidate.generation).unwrap();
        assert!(accounts.active.unwrap().verified_model.is_none());
    }
    #[test]
    fn restart_preserves_cancellation_until_registered_credentials_are_removed() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store {
            root: temp.path().join("provider"),
        };
        let active = AccountRef::candidate();
        let candidate = AccountRef::candidate();
        let mut state = Accounts {
            active: Some(active.clone()),
            candidate: Some(candidate.clone()),
            ..Default::default()
        };
        store.write_accounts(&state).unwrap();
        let active_auth = store.create_account(&active.id).unwrap();
        let candidate_auth = store.create_account(&candidate.id).unwrap();
        fs::write(active_auth.join("opaque-native-file"), "active").unwrap();
        fs::write(candidate_auth.join("opaque-native-file"), "candidate").unwrap();
        state.begin_cancel_candidate();
        store.write_accounts(&state).unwrap();
        let restored = store.read_accounts().unwrap();
        for id in &restored.cleanup {
            store.remove_account(id).unwrap();
        }
        assert!(!candidate_auth.exists());
        assert!(active_auth.join("opaque-native-file").exists());
        // Cleanup remains durable until the owner explicitly commits completion.
        assert!(store
            .read_accounts()
            .unwrap()
            .cleanup
            .contains(&candidate.id));
        store.remove_account(&candidate.id).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn private_children_do_not_change_ancestor_permissions_or_follow_final_links() {
        use std::os::unix::{fs::symlink, fs::PermissionsExt};
        let temp = tempfile::tempdir().unwrap();
        fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o750)).unwrap();
        let auth = temp.path().join("provider/account/auth");
        private_dir(&auth).unwrap();
        assert_eq!(
            fs::metadata(temp.path()).unwrap().permissions().mode() & 0o777,
            0o750
        );
        assert_eq!(
            fs::metadata(auth).unwrap().permissions().mode() & 0o777,
            0o700
        );
        symlink(temp.path(), temp.path().join("link")).unwrap();
        assert!(private_dir(&temp.path().join("link")).is_err());
    }
}
