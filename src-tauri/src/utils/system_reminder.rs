const SYSTEM_REMINDER_OPEN: &str = "<system-reminder>";
const SYSTEM_REMINDER_CLOSE: &str = "</system-reminder>";
const MAX_NESTED_REMINDERS: usize = 8;

/// Return the first XML-like tag inside a leading system-reminder envelope.
pub fn leading_system_reminder_kind(raw: &str) -> Option<&str> {
    let trimmed = raw.trim_start();
    let body = trimmed.strip_prefix(SYSTEM_REMINDER_OPEN)?.trim_start();
    let tag = body.strip_prefix('<')?;
    let end = tag.find(|character: char| {
        !(character.is_ascii_alphanumeric() || character == '_' || character == '-')
    })?;
    (end > 0).then_some(&tag[..end])
}

/// Return only the user-visible tail after leading system-reminder envelopes.
///
/// Plain user text passes through unchanged. A pure or malformed leading
/// reminder has no visible tail and therefore returns an empty string. This is
/// the Rust mirror of `src/shared/systemReminder.ts::stripLeadingSystemReminder`.
pub fn strip_leading_system_reminder(raw: &str) -> String {
    let mut text = raw;
    let mut found_reminder = false;

    for _ in 0..MAX_NESTED_REMINDERS {
        let trimmed = text.trim_start();
        if !trimmed.starts_with(SYSTEM_REMINDER_OPEN) {
            return if found_reminder {
                trimmed.trim().to_string()
            } else {
                raw.to_string()
            };
        }

        found_reminder = true;
        let Some(close_idx) = trimmed.find(SYSTEM_REMINDER_CLOSE) else {
            return String::new();
        };
        text = &trimmed[close_idx + SYSTEM_REMINDER_CLOSE.len()..];
    }

    text.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_plain_user_text() {
        assert_eq!(strip_leading_system_reminder("hello"), "hello");
    }

    #[test]
    fn returns_only_the_visible_tail() {
        assert_eq!(
            strip_leading_system_reminder(
                "<system-reminder><GOAL_CONTEXT>hidden</GOAL_CONTEXT></system-reminder>visible"
            ),
            "visible"
        );
    }

    #[test]
    fn extracts_only_a_leading_reminder_kind() {
        assert_eq!(
            leading_system_reminder_kind(
                "<system-reminder>\n<GOAL_CONTEXT>hidden</GOAL_CONTEXT></system-reminder>visible"
            ),
            Some("GOAL_CONTEXT")
        );
        assert_eq!(
            leading_system_reminder_kind("discuss <MEMORY_UPDATE>"),
            None
        );
    }

    #[test]
    fn drops_pure_and_unclosed_reminders() {
        assert_eq!(
            strip_leading_system_reminder(
                "<system-reminder><MEMORY_UPDATE>hidden</MEMORY_UPDATE></system-reminder>"
            ),
            ""
        );
        assert_eq!(strip_leading_system_reminder("<system-reminder>hidden"), "");
    }
}
