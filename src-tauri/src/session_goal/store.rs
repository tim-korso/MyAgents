use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::SessionGoal;
use crate::utils::bom::strip_bom;

const SESSION_GOAL_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub(super) enum SessionGoalStoreState {
    Ready(HashMap<String, SessionGoal>),
    Corrupt { error: String },
}

impl SessionGoalStoreState {
    pub(super) fn ready(&self) -> Result<&HashMap<String, SessionGoal>, String> {
        match self {
            Self::Ready(goals) => Ok(goals),
            Self::Corrupt { error } => Err(error.clone()),
        }
    }

    pub(super) fn ready_mut(&mut self) -> Result<&mut HashMap<String, SessionGoal>, String> {
        match self {
            Self::Ready(goals) => Ok(goals),
            Self::Corrupt { error } => Err(error.clone()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionGoalFile {
    schema_version: u32,
    #[serde(default)]
    goals: Vec<SessionGoal>,
}

pub(super) fn load(path: &Path) -> SessionGoalStoreState {
    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SessionGoalStoreState::Ready(HashMap::new());
        }
        Err(error) => {
            return SessionGoalStoreState::Corrupt {
                error: format!(
                    "Session Goal store cannot be inspected at {}: {}",
                    path.display(),
                    error
                ),
            };
        }
    }

    let mut bytes = Vec::new();
    let read_result = OpenOptions::new()
        .read(true)
        .open(path)
        .and_then(|mut file| file.read_to_end(&mut bytes));
    if let Err(error) = read_result {
        return SessionGoalStoreState::Corrupt {
            error: format!(
                "Session Goal store cannot be read at {}: {}",
                path.display(),
                error
            ),
        };
    }

    let text = match std::str::from_utf8(&bytes) {
        Ok(text) => strip_bom(text),
        Err(error) => {
            return SessionGoalStoreState::Corrupt {
                error: format!(
                    "Session Goal store is not valid UTF-8 at {}: {}",
                    path.display(),
                    error
                ),
            };
        }
    };
    let file: SessionGoalFile = match serde_json::from_str(text) {
        Ok(file) => file,
        Err(error) => {
            return SessionGoalStoreState::Corrupt {
                error: format!(
                    "Session Goal store is invalid JSON at {}: {}",
                    path.display(),
                    error
                ),
            };
        }
    };
    if file.schema_version != SESSION_GOAL_SCHEMA_VERSION {
        return SessionGoalStoreState::Corrupt {
            error: format!(
                "Unsupported Session Goal schema {} at {} (expected {})",
                file.schema_version,
                path.display(),
                SESSION_GOAL_SCHEMA_VERSION
            ),
        };
    }

    let mut goals = HashMap::with_capacity(file.goals.len());
    for goal in file.goals {
        if goals.insert(goal.session_id.clone(), goal).is_some() {
            return SessionGoalStoreState::Corrupt {
                error: format!(
                    "Session Goal store contains duplicate Session ids at {}",
                    path.display()
                ),
            };
        }
    }
    if let Err(error) = validate_candidate(&goals) {
        return SessionGoalStoreState::Corrupt {
            error: format!("{error} at {}", path.display()),
        };
    }
    let mut goals = goals;
    if recover_previous_process_authority(&mut goals) {
        if let Err(error) = persist_blocking(path, &goals) {
            return SessionGoalStoreState::Corrupt {
                error: format!(
                    "Session Goal startup recovery could not be persisted at {}: {}",
                    path.display(),
                    error
                ),
            };
        }
    }
    SessionGoalStoreState::Ready(goals)
}

pub(super) async fn persist(
    path: &Path,
    goals: &HashMap<String, SessionGoal>,
) -> Result<(), String> {
    let content = serialize(goals)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create Session Goal store directory: {error}"))?;
    }
    let lock_path = path.with_file_name("session_goals.json.lock");
    let path = path.to_path_buf();
    crate::utils::file_lock::with_file_lock(
        &lock_path,
        crate::utils::file_lock::FileLockOptions::default(),
        move || write_atomic(&path, &content),
    )
    .await
    .map_err(|error| error.to_string())
}

fn serialize(goals: &HashMap<String, SessionGoal>) -> Result<Vec<u8>, String> {
    validate_candidate(goals)?;
    let mut ordered = goals.values().cloned().collect::<Vec<_>>();
    ordered.sort_by(|a, b| a.id.cmp(&b.id));
    serde_json::to_vec_pretty(&SessionGoalFile {
        schema_version: SESSION_GOAL_SCHEMA_VERSION,
        goals: ordered,
    })
    .map_err(|error| format!("serialize Session Goal store: {error}"))
}

fn validate_candidate(goals: &HashMap<String, SessionGoal>) -> Result<(), String> {
    for (key, goal) in goals {
        if key != &goal.session_id
            || goal.id.trim().is_empty()
            || goal.session_id.trim().is_empty()
            || goal.session_id.starts_with("pending-")
            || goal.workspace_path.trim().is_empty()
            || goal.objective.trim().is_empty()
            || goal.revision == 0
            || goal.control_revision == 0
        {
            return Err("Session Goal store contains an invalid Goal identity".to_string());
        }
    }
    Ok(())
}

fn persist_blocking(path: &Path, goals: &HashMap<String, SessionGoal>) -> Result<(), String> {
    let content = serialize(goals)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create Session Goal store directory: {error}"))?;
    }
    let lock_path = path.with_file_name("session_goals.json.lock");
    let path = path.to_path_buf();
    crate::utils::file_lock::with_file_lock_blocking(
        &lock_path,
        crate::utils::file_lock::FileLockOptions::default(),
        move || write_atomic(&path, &content),
    )
    .map_err(|error| error.to_string())
}

fn recover_previous_process_authority(goals: &mut HashMap<String, SessionGoal>) -> bool {
    let now = chrono::Utc::now();
    let mut changed = false;
    for goal in goals.values_mut() {
        let goal_changed = goal.current_turn.take().is_some();
        if goal_changed {
            goal.updated_at = now;
            goal.bump_revision();
            changed = true;
        }
    }
    changed
}

fn write_atomic(
    path: &PathBuf,
    content: &[u8],
) -> Result<(), crate::utils::file_lock::FileLockError> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let tmp_path = path.with_file_name(format!(
        "session_goals.json.tmp.{}.{}",
        std::process::id(),
        nanos
    ));
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp_path)?;
        file.write_all(content)?;
        file.flush()?;
        file.sync_all()?;
        fs::rename(&tmp_path, path)?;
        if let Some(parent) = path.parent() {
            // Directory fsync is unavailable on some supported filesystems. The
            // file itself is already durable and atomically installed here.
            if let Ok(directory) = OpenOptions::new().read(true).open(parent) {
                let _ = directory.sync_all();
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    result.map_err(crate::utils::file_lock::FileLockError::Io)
}
