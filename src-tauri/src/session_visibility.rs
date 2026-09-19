use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde_json::Value;

const CODEX_SUBSCRIPTION_PROVIDER_ID: &str = "codex-sub";
const SYSTEM_MAINTENANCE_SESSION_KINDS: &[&str] = &[
    crate::task::MANAGED_KIND_MEMORY_GARDENER,
    crate::task::MANAGED_KIND_MEMORY_MOLT,
];

pub fn is_prepared_session(session: &Value) -> bool {
    session
        .get("materializationState")
        .and_then(Value::as_str)
        .is_some_and(|state| state == "prepared")
}

pub fn is_history_visible_session(session: &Value, sessions_dir: &Path) -> bool {
    !is_prepared_session(session)
        && !is_system_maintenance_session(session)
        && !is_legacy_pre_query_managed_codex_draft(session, sessions_dir)
}

pub fn is_system_maintenance_session(session: &Value) -> bool {
    session
        .get("systemMaintenanceKind")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|kind| SYSTEM_MAINTENANCE_SESSION_KINDS.contains(&kind))
}

pub fn is_legacy_pre_query_managed_codex_draft(session: &Value, sessions_dir: &Path) -> bool {
    // Versioned births have an explicit lifecycle; lagging transcript statistics
    // cannot make them legacy pre-query drafts.
    if session.get("transcriptFormat").is_some() {
        return false;
    }
    if is_prepared_session(session) {
        return false;
    }
    if !is_managed_codex_runtime_backed_birth(session) {
        return false;
    }
    if !is_desktop_or_unknown_origin(session) {
        return false;
    }
    if session
        .get("favorite")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return false;
    }
    if session
        .get("cronTaskId")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
    {
        return false;
    }
    if session.get("title").and_then(Value::as_str) != Some("New Chat") {
        return false;
    }
    if session.get("titleSource").and_then(Value::as_str) == Some("user") {
        return false;
    }
    if session
        .get("lastMessagePreview")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
    {
        return false;
    }
    if session.get("lastContextUsage").is_some() || session.get("runtimeUsageTotals").is_some() {
        return false;
    }
    if stats_show_activity(session.get("stats")) {
        return false;
    }
    let Some(session_id) = session.get("id").and_then(Value::as_str) else {
        return false;
    };
    !session_has_user_messages(session_id, sessions_dir)
}

fn is_managed_codex_runtime_backed_birth(session: &Value) -> bool {
    let identity = session.get("providerExecutionIdentity");
    let identity_matches = identity
        .and_then(|value| value.get("kind"))
        .and_then(Value::as_str)
        == Some("runtime-backed-provider")
        && identity
            .and_then(|value| value.get("providerId"))
            .and_then(Value::as_str)
            == Some(CODEX_SUBSCRIPTION_PROVIDER_ID);
    let identity_matches = identity_matches
        && identity
            .and_then(|value| value.get("runtime"))
            .and_then(Value::as_str)
            == Some("codex")
        && identity
            .and_then(|value| value.get("runtimeSource"))
            .and_then(Value::as_str)
            == Some("managed-provider");

    identity_matches
        || (session.get("runtime").and_then(Value::as_str) == Some("codex")
            && session.get("runtimeSource").and_then(Value::as_str) == Some("managed-provider")
            && session.get("providerId").and_then(Value::as_str)
                == Some(CODEX_SUBSCRIPTION_PROVIDER_ID))
}

fn is_desktop_or_unknown_origin(session: &Value) -> bool {
    let origin_kind = session
        .get("origin")
        .and_then(|origin| origin.get("kind"))
        .and_then(Value::as_str);
    if let Some(kind) = origin_kind {
        if kind != "desktop" && kind != "unknown" {
            return false;
        }
    }

    match session.get("source").and_then(Value::as_str) {
        Some("desktop") | None => true,
        Some(_) => false,
    }
}

fn stats_show_activity(stats: Option<&Value>) -> bool {
    let Some(stats) = stats else {
        return false;
    };
    [
        "messageCount",
        "totalInputTokens",
        "totalOutputTokens",
        "totalCacheReadTokens",
        "totalCacheCreationTokens",
    ]
    .iter()
    .any(|key| stats.get(*key).and_then(Value::as_u64).unwrap_or(0) > 0)
}

fn session_has_user_messages(session_id: &str, sessions_dir: &Path) -> bool {
    let jsonl_path = sessions_dir.join(format!("{}.jsonl", session_id));
    match fs::read_to_string(jsonl_path) {
        Ok(content) => {
            for line in content
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
            {
                let Ok(msg) = serde_json::from_str::<Value>(line) else {
                    return true;
                };
                if msg.get("role").and_then(Value::as_str) == Some("user") {
                    return true;
                }
            }
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(_) => return true,
    }

    let legacy_path = sessions_dir.join(format!("{}.json", session_id));
    let content = match fs::read_to_string(legacy_path) {
        Ok(content) => content,
        Err(err) if err.kind() == ErrorKind::NotFound => return false,
        Err(_) => return true,
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&content) else {
        return true;
    };
    parsed
        .get("messages")
        .and_then(Value::as_array)
        .is_some_and(|messages| {
            messages
                .iter()
                .any(|msg| msg.get("role").and_then(Value::as_str) == Some("user"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn matches_node_visibility_contract() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../src/shared/fixtures/session-history-visibility.json"
        ))
        .unwrap();
        let directory = tempfile::tempdir().unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let mut session = fixture["base"].clone();
            session
                .as_object_mut()
                .unwrap()
                .extend(case["patch"].as_object().unwrap().clone());
            assert_eq!(
                is_history_visible_session(&session, directory.path()),
                case["visible"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn versioned_birth_is_visible_before_transcript_statistics_are_published() {
        let directory = tempfile::tempdir().unwrap();
        let mut session = legacy_managed_codex_session();
        session["transcriptFormat"] = json!(2);
        assert!(is_history_visible_session(&session, directory.path()));
        session["materializationState"] = json!("prepared");
        assert!(!is_history_visible_session(&session, directory.path()));
    }

    fn legacy_managed_codex_session() -> Value {
        json!({
            "id": "managed-empty",
            "title": "New Chat",
            "agentDir": "/tmp/workspace",
            "runtime": "codex",
            "runtimeSource": "managed-provider",
            "providerId": "codex-sub",
            "origin": { "kind": "desktop", "surface": "agent_card" },
            "stats": { "messageCount": 0 }
        })
    }

    #[test]
    fn hides_prepared_sessions() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!is_history_visible_session(
            &json!({ "id": "prepared", "materializationState": "prepared" }),
            temp.path(),
        ));
    }

    #[test]
    fn hides_legacy_empty_managed_codex_drafts() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!is_history_visible_session(
            &legacy_managed_codex_session(),
            temp.path(),
        ));
    }

    #[test]
    fn keeps_legacy_managed_codex_with_user_messages_visible() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(
            temp.path().join("managed-empty.jsonl"),
            r#"{"role":"user","content":"hello"}"#,
        )
        .unwrap();
        assert!(is_history_visible_session(
            &legacy_managed_codex_session(),
            temp.path(),
        ));
    }

    #[test]
    fn keeps_favorite_or_non_desktop_sessions_visible() {
        let temp = tempfile::tempdir().unwrap();
        let mut favorite = legacy_managed_codex_session();
        favorite["favorite"] = json!(true);
        assert!(is_history_visible_session(&favorite, temp.path()));

        let mut channel = legacy_managed_codex_session();
        channel["origin"] = json!({ "kind": "agent-channel", "surface": "channel_message" });
        assert!(is_history_visible_session(&channel, temp.path()));
    }

    #[test]
    fn keeps_legacy_managed_codex_with_corrupt_message_file_visible() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("managed-empty.jsonl"), r#"{"role":"user""#).unwrap();
        assert!(is_history_visible_session(
            &legacy_managed_codex_session(),
            temp.path(),
        ));
    }

    #[test]
    fn keeps_legacy_managed_codex_with_unreadable_utf8_message_file_visible() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("managed-empty.jsonl"), [0xff, 0xfe]).unwrap();
        assert!(is_history_visible_session(
            &legacy_managed_codex_session(),
            temp.path(),
        ));
    }

    #[test]
    fn hides_system_maintenance_sessions() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!is_history_visible_session(
            &json!({
                "id": "maintenance",
                "origin": { "kind": "automation", "surface": "cron" },
                "systemMaintenanceKind": "memory_gardener"
            }),
            temp.path(),
        ));
        assert!(!is_history_visible_session(
            &json!({
                "id": "maintenance",
                "origin": { "kind": "automation", "surface": "cron" },
                "systemMaintenanceKind": "memory_molt"
            }),
            temp.path(),
        ));
    }

    #[test]
    fn keeps_ordinary_automation_sessions_visible() {
        let temp = tempfile::tempdir().unwrap();
        assert!(is_history_visible_session(
            &json!({
                "id": "ordinary-cron",
                "origin": { "kind": "automation", "surface": "cron" },
                "cronTaskId": "task-1"
            }),
            temp.path(),
        ));
        assert!(is_history_visible_session(
            &json!({
                "id": "auto-update-target",
                "origin": { "kind": "automation", "surface": "memory_update" },
                "systemMaintenanceKind": "memory_auto_update_batch"
            }),
            temp.path(),
        ));
    }
}
