use super::*;

pub(crate) use crate::workspace_path::normalize_workspace_path_identity as normalize_path;

/// Validate a cron expression (and optional timezone) at data-boundary time
/// so bad input is rejected when saved, not silently swallowed at next fire
/// (which would leave the scheduler dead and the task status "running" with
/// no tick). Returns `Ok(())` when the expression parses and the tz (if
/// supplied) is an IANA id we recognize.
pub fn validate_cron_expression(expr: &str, tz: Option<&str>) -> Result<(), String> {
    // `next_cron_fire_time` already does both checks and throws away the
    // result; reuse it so the validator stays in lockstep with the runtime
    // parser — no way for validation to diverge from execution.
    next_cron_fire_time(expr, tz).map(|_| ())
}

/// Translate a Unix-style day-of-week field (0-7, Sun=0 or Sun=7) into the
/// `cron` crate's day-of-week numbering (1-7, Sun=1, Sat=7 — Quartz semantics).
///
/// Why: `cron` v0.15 rejects `0` for DOW with "Days of Week must be greater
/// than or equal to 1", and even when numeric DOW values parse, they're
/// shifted vs. the Unix convention the rest of the app uses (frontend
/// `CronExpressionInput`, CLI scheduling, AI tool calls all generate
/// Unix-style cron). Without this translation, `0 21 * * 0` is rejected
/// outright, and `0 8 * * 1-5` (Mon-Fri in Unix) silently fires Sun-Thu in
/// crate land.
///
/// Approach: fully enumerate the Unix days the token represents, shift each
/// to its crate equivalent (so `5-7` Fri-Sun → `{6,7,1}` not the invalid
/// `6-1`, and `1-7/2` Mon/Wed/Fri/Sun → `{2,4,6,1}` not the wrong-phase
/// `*/2`), then re-emit as a sorted comma list with consecutive runs
/// compressed back into ranges. Tokens containing names (`SUN`-`SAT`) or
/// `?` are passed through — the crate accepts those natively.
pub(super) fn translate_unix_dow_to_crate_dow(dow: &str) -> String {
    use std::collections::BTreeSet;

    fn shift_unix(n: u32) -> u32 {
        match n {
            0 | 7 => 1, // Sunday (Unix 0 or 7 → crate 1)
            1..=6 => n + 1,
            _ => n,
        }
    }

    /// Enumerate the Unix DOW values a token represents (0-7, where 7 also
    /// means Sunday). Returns `None` for anything we'd rather pass through
    /// (named days, `?`, malformed tokens).
    fn token_to_unix_days(token: &str) -> Option<Vec<u32>> {
        if token.is_empty() {
            return None;
        }
        if token == "*" {
            return Some((0..=6).collect());
        }
        if token == "?" {
            return None;
        }
        if let Some((base, step_str)) = token.split_once('/') {
            let step: u32 = step_str.parse().ok()?;
            if step == 0 {
                return None;
            }
            let (start, end) = if base == "*" {
                (0u32, 6u32)
            } else if let Some((s, e)) = base.split_once('-') {
                (s.parse().ok()?, e.parse().ok()?)
            } else {
                // single + step: "N/k" enumerates N, N+k, ... up to 7 (covers Sunday alias)
                let n: u32 = base.parse().ok()?;
                (n, 7u32)
            };
            if start > 7 || end > 7 || start > end {
                return None;
            }
            return Some((start..=end).step_by(step as usize).collect());
        }
        if let Some((s, e)) = token.split_once('-') {
            let start: u32 = s.parse().ok()?;
            let end: u32 = e.parse().ok()?;
            if start > 7 || end > 7 || start > end {
                return None;
            }
            return Some((start..=end).collect());
        }
        let n: u32 = token.parse().ok()?;
        if n > 7 {
            return None;
        }
        Some(vec![n])
    }

    /// Compact a sorted set of crate days back into the most readable form:
    /// 7 days → `*`, consecutive runs of ≥3 → `a-b`, otherwise comma list.
    fn format_crate_days(days: &BTreeSet<u32>) -> String {
        if days.len() == 7 {
            return "*".to_string();
        }
        let sorted: Vec<u32> = days.iter().copied().collect();
        let mut parts: Vec<String> = Vec::new();
        let mut i = 0;
        while i < sorted.len() {
            let run_start = sorted[i];
            let mut run_end = run_start;
            while i + 1 < sorted.len() && sorted[i + 1] == run_end + 1 {
                run_end = sorted[i + 1];
                i += 1;
            }
            if run_end >= run_start + 2 {
                parts.push(format!("{}-{}", run_start, run_end));
            } else if run_end == run_start + 1 {
                parts.push(run_start.to_string());
                parts.push(run_end.to_string());
            } else {
                parts.push(run_start.to_string());
            }
            i += 1;
        }
        parts.join(",")
    }

    let mut crate_days: BTreeSet<u32> = BTreeSet::new();
    for token in dow.split(',') {
        match token_to_unix_days(token) {
            Some(unix_days) => {
                for d in unix_days {
                    crate_days.insert(shift_unix(d));
                }
            }
            None => {
                // Fall back: any non-numeric token (named day, `?`, malformed)
                // means we can't safely fully enumerate — pass through verbatim.
                // This is rare in practice; the crate accepts SUN-SAT names natively.
                return dow.to_string();
            }
        }
    }
    if crate_days.is_empty() {
        return dow.to_string();
    }
    format_crate_days(&crate_days)
}

/// Parse a cron expression and compute the next fire time as a wall-clock UTC timestamp.
///
/// Input dialect: standard Unix 5-field (`min hour dom month dow`, Sun=0 or 7)
/// — the format used by every UI surface and `crontab(5)`. We convert to the
/// `cron` crate's native 7-field format (`sec min hour dom month dow year`,
/// Sun=1) by prepending seconds, appending year, and translating DOW.
///
/// 6-field and 7-field inputs are passed through with minimal massaging,
/// assuming the caller is using the cron crate's native dialect (Quartz-style,
/// 1=Sun). We don't translate DOW for those — power users typing 6/7 fields
/// know what they're doing.
pub(crate) fn next_cron_fire_time(expr: &str, tz: Option<&str>) -> Result<DateTime<Utc>, String> {
    let expr7 = {
        let fields: Vec<&str> = expr.trim().split_whitespace().collect();
        match fields.len() {
            5 => {
                // Unix 5-field: translate DOW (the 5th field) from Unix to crate semantics.
                let dow_translated = translate_unix_dow_to_crate_dow(fields[4]);
                format!(
                    "0 {} {} {} {} {} *",
                    fields[0], fields[1], fields[2], fields[3], dow_translated
                )
            }
            6 => format!("{} *", expr.trim()), // crate-native 6-field (sec min hour dom month dow) — append year
            7 => expr.trim().to_string(),      // already full 7-field
            _ => {
                return Err(format!(
                    "Invalid cron expression '{}': expected 5-7 fields, got {}",
                    expr,
                    fields.len()
                ))
            }
        }
    };

    let schedule = CronExprSchedule::from_str(&expr7).map_err(|e| {
        format!(
            "Failed to parse cron expression '{}' (normalized: '{}'): {}",
            expr, expr7, e
        )
    })?;

    // Resolve timezone
    let now = if let Some(tz_str) = tz {
        let tz: chrono_tz::Tz = tz_str
            .parse()
            .map_err(|_| format!("Invalid timezone '{}' for cron expression", tz_str))?;
        Utc::now().with_timezone(&tz)
    } else {
        // Default to UTC — use a fixed-offset representation
        Utc::now().with_timezone(&chrono_tz::UTC)
    };

    let next = schedule
        .after(&now)
        .next()
        .ok_or_else(|| format!("No upcoming fire time for cron expression '{}'", expr))?;

    Ok(next.with_timezone(&Utc))
}
