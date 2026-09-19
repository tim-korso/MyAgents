use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::path_safety::{resolve_inside_workspace, validate_workspace_root};

const SOUL_TEMPLATE: &str = include_str!("../../../src/shared/default-soul.md");
const USER_TEMPLATE: &str = include_str!("../../../src/shared/default-user.md");
const MEMORY_TEMPLATE: &str = include_str!("../../../src/shared/default-memory.md");
const UPDATE_MEMORY_TEMPLATE: &str = include_str!("../../../src/shared/default-update-memory.md");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRuleFileState {
    pub filename: String,
    pub relative_path: String,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRuleSubstrateResult {
    pub soul: MemoryRuleFileState,
    pub user: MemoryRuleFileState,
    pub memory: MemoryRuleFileState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryFileResult {
    pub content: String,
    pub created: bool,
}

struct RuleSpec {
    numbered: &'static str,
    plain: &'static str,
    template: &'static str,
}

pub fn default_update_memory_content() -> &'static str {
    UPDATE_MEMORY_TEMPLATE
}

pub fn ensure_memory_rule_substrate_for_workspace(
    workspace_path: &str,
) -> Result<MemoryRuleSubstrateResult, String> {
    let workspace_root = validate_workspace_root(workspace_path)?;
    ensure_memory_rule_substrate(&workspace_root)
}

pub fn ensure_memory_rule_substrate(
    workspace_root: &Path,
) -> Result<MemoryRuleSubstrateResult, String> {
    let claude_dir = resolve_inside_workspace(workspace_root, ".claude")?;
    ensure_plain_dir(&claude_dir, ".claude")?;

    let rules_dir = resolve_inside_workspace(workspace_root, ".claude/rules")?;
    ensure_plain_dir(&rules_dir, ".claude/rules")?;

    let soul = ensure_rule_file(
        &rules_dir,
        &RuleSpec {
            numbered: "02-SOUL.md",
            plain: "SOUL.md",
            template: SOUL_TEMPLATE,
        },
    )?;
    let user = ensure_rule_file(
        &rules_dir,
        &RuleSpec {
            numbered: "03-USER.md",
            plain: "USER.md",
            template: USER_TEMPLATE,
        },
    )?;
    let memory = ensure_rule_file(
        &rules_dir,
        &RuleSpec {
            numbered: "04-MEMORY.md",
            plain: "MEMORY.md",
            template: MEMORY_TEMPLATE,
        },
    )?;

    Ok(MemoryRuleSubstrateResult { soul, user, memory })
}

#[tauri::command]
pub async fn cmd_ensure_memory_rule_substrate(
    workspace_path: String,
) -> Result<MemoryRuleSubstrateResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_memory_rule_substrate_for_workspace(&workspace_path)
    })
    .await
    .map_err(|e| format!("ensure memory rule substrate task failed: {}", e))?
}

pub fn ensure_update_memory_file_for_workspace(
    workspace_path: &str,
) -> Result<UpdateMemoryFileResult, String> {
    ensure_memory_rule_substrate_for_workspace(workspace_path)?;
    let workspace_root = validate_workspace_root(workspace_path)?;
    let path = resolve_inside_workspace(&workspace_root, "UPDATE_MEMORY.md")?;
    ensure_update_memory_file_at(&path)
}

/// Atomically create the optional workspace override, or return the exact
/// existing user-owned content without rewriting it.
pub(crate) fn ensure_update_memory_file_at(path: &Path) -> Result<UpdateMemoryFileResult, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err("UPDATE_MEMORY.md is a symlink; refusing to read it".to_string());
            }
            if metadata.is_dir() {
                return Err("UPDATE_MEMORY.md is a directory".to_string());
            }
            let content = fs::read_to_string(path).map_err(|e| format!("read failed: {}", e))?;
            Ok(UpdateMemoryFileResult {
                content,
                created: false,
            })
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {
            let mut file = match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
            {
                Ok(file) => file,
                Err(open_err) if open_err.kind() == ErrorKind::AlreadyExists => {
                    return ensure_update_memory_file_at(path);
                }
                Err(open_err) => return Err(format!("create failed: {}", open_err)),
            };
            let content = default_update_memory_content().to_string();
            file.write_all(content.as_bytes())
                .map_err(|write_err| format!("write failed: {}", write_err))?;
            file.sync_all()
                .map_err(|sync_err| format!("sync failed: {}", sync_err))?;
            Ok(UpdateMemoryFileResult {
                content,
                created: true,
            })
        }
        Err(e) => Err(format!("metadata failed: {}", e)),
    }
}

#[tauri::command]
pub async fn cmd_ensure_update_memory_file(
    workspace_path: String,
) -> Result<UpdateMemoryFileResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_update_memory_file_for_workspace(&workspace_path)
    })
    .await
    .map_err(|e| format!("ensure UPDATE_MEMORY.md task failed: {}", e))?
}

fn ensure_plain_dir(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "{} is a symlink; refusing to write through it",
                    label
                ));
            }
            if !metadata.is_dir() {
                return Err(format!("{} exists but is not a directory", label));
            }
            Ok(())
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {
            fs::create_dir(path)
                .map_err(|create_err| format!("create {} failed: {}", label, create_err))?;
            Ok(())
        }
        Err(e) => Err(format!("metadata {} failed: {}", label, e)),
    }
}

fn ensure_rule_file(rules_dir: &Path, spec: &RuleSpec) -> Result<MemoryRuleFileState, String> {
    if let Some(state) = existing_rule_state(rules_dir, spec.numbered)? {
        return Ok(state);
    }
    if let Some(state) = existing_rule_state(rules_dir, spec.plain)? {
        return Ok(state);
    }

    let target = rules_dir.join(spec.numbered);
    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {
            return ensure_rule_file(rules_dir, spec);
        }
        Err(e) => return Err(format!("create {} failed: {}", spec.numbered, e)),
    };
    file.write_all(spec.template.as_bytes())
        .map_err(|e| format!("write {} failed: {}", spec.numbered, e))?;
    file.sync_all()
        .map_err(|e| format!("sync {} failed: {}", spec.numbered, e))?;

    Ok(MemoryRuleFileState {
        filename: spec.numbered.to_string(),
        relative_path: format!(".claude/rules/{}", spec.numbered),
        created: true,
    })
}

fn existing_rule_state(
    rules_dir: &Path,
    filename: &str,
) -> Result<Option<MemoryRuleFileState>, String> {
    let path: PathBuf = rules_dir.join(filename);
    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!("{} is a symlink; refusing to use it", filename));
            }
            if metadata.is_dir() {
                return Err(format!("{} is a directory", filename));
            }
            Ok(Some(MemoryRuleFileState {
                filename: filename.to_string(),
                relative_path: format!(".claude/rules/{}", filename),
                created: false,
            }))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("metadata {} failed: {}", filename, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_files::test_support::make_test_workspace;

    #[test]
    fn ensure_memory_rule_substrate_creates_numbered_files() {
        let dir = make_test_workspace("memory_rules_create");

        let result = ensure_memory_rule_substrate(&dir).expect("ensure substrate");

        assert_eq!(result.soul.filename, "02-SOUL.md");
        assert_eq!(result.user.filename, "03-USER.md");
        assert_eq!(result.memory.filename, "04-MEMORY.md");
        assert!(dir.join(".claude/rules/02-SOUL.md").is_file());
        assert!(dir.join(".claude/rules/03-USER.md").is_file());
        assert!(dir.join(".claude/rules/04-MEMORY.md").is_file());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_memory_rule_substrate_prefers_numbered_existing_file() {
        let dir = make_test_workspace("memory_rules_existing");
        let rules = dir.join(".claude/rules");
        fs::create_dir_all(&rules).expect("mkdir rules");
        fs::write(rules.join("MEMORY.md"), "plain").expect("write plain");
        fs::write(rules.join("04-MEMORY.md"), "numbered").expect("write numbered");

        let result = ensure_memory_rule_substrate(&dir).expect("ensure substrate");

        assert_eq!(result.memory.filename, "04-MEMORY.md");
        assert!(!result.memory.created);
        assert_eq!(
            fs::read_to_string(rules.join("04-MEMORY.md")).expect("read numbered"),
            "numbered"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_update_memory_content_has_frontmatter_and_empty_body() {
        let content = default_update_memory_content();
        let closing = content
            .find("\n---")
            .expect("default UPDATE_MEMORY.md closing frontmatter");
        let body = &content[closing + "\n---".len()..];

        assert!(content.contains("myagents-memory-update"));
        assert!(body.trim().is_empty());
        assert!(!content.contains("{{MEMORY_RULE_PATH}}"));
    }

    #[test]
    fn workspace_update_file_ensure_is_create_once_and_preserve_existing() {
        let dir = make_test_workspace("memory_update_file_ensure");
        let workspace = dir.to_string_lossy();

        let created =
            ensure_update_memory_file_for_workspace(&workspace).expect("create update file");
        assert!(created.created);
        assert_eq!(created.content, default_update_memory_content());

        let custom =
            "---\ndescription: custom\n---\nKeep project decisions in memory/topics/product.md.\n";
        fs::write(dir.join("UPDATE_MEMORY.md"), custom).expect("replace with user content");
        let existing =
            ensure_update_memory_file_for_workspace(&workspace).expect("read update file");
        assert!(!existing.created);
        assert_eq!(existing.content, custom);
        assert_eq!(
            fs::read_to_string(dir.join("UPDATE_MEMORY.md")).unwrap(),
            custom
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
