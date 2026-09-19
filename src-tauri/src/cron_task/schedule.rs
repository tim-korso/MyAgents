use super::*;
use chrono::TimeZone;

/// Advance an interval target to the first future occurrence after `now`.
///
/// This is used for recurring schedules with an explicit anchor (`start_at`).
/// Missing a window due to app shutdown or system sleep should skip the missed
/// occurrence instead of firing immediately at the wrong wall-clock time.
pub(super) fn advance_interval_target_after(
    candidate: DateTime<Utc>,
    interval_secs: i64,
    now: DateTime<Utc>,
) -> DateTime<Utc> {
    if candidate > now {
        return candidate;
    }
    let interval_secs = interval_secs.max(1);
    let behind_secs = (now - candidate).num_seconds().max(0);
    let steps = behind_secs / interval_secs + 1;
    candidate
        .checked_add_signed(chrono::Duration::seconds(
            interval_secs.saturating_mul(steps),
        ))
        .unwrap_or_else(|| now + chrono::Duration::seconds(interval_secs))
}

pub(crate) fn resolve_missed_interval_target(
    candidate: DateTime<Utc>,
    interval_secs: i64,
    now: DateTime<Utc>,
    catch_up_window: Option<&RecurringWindow>,
    min_ahead_secs: i64,
) -> DateTime<Utc> {
    if candidate > now {
        return candidate;
    }
    if let Some(window) = catch_up_window {
        if let Some(next) = next_catch_up_window_target(now, window, min_ahead_secs) {
            return next;
        }
    }
    advance_interval_target_after(candidate, interval_secs, now)
}

fn next_catch_up_window_target(
    now: DateTime<Utc>,
    window: &RecurringWindow,
    min_ahead_secs: i64,
) -> Option<DateTime<Utc>> {
    use chrono::Timelike;

    let tz = window.timezone.parse::<chrono_tz::Tz>().ok()?;
    let start = parse_hhmm(&window.start)?;
    let end = parse_hhmm(&window.end)?;
    if start == end {
        return None;
    }

    let local = now.with_timezone(&tz);
    let minutes = local.hour() * 60 + local.minute();
    let min_target = now + chrono::Duration::seconds(min_ahead_secs.max(1));

    if is_in_window(minutes, start, end) {
        let end_date = if start < end || minutes < end {
            local.date_naive()
        } else {
            local.date_naive().checked_add_days(chrono::Days::new(1))?
        };
        let end_utc = local_time_to_utc(&tz, end_date, end)?;
        if min_target < end_utc {
            return Some(min_target);
        }
    }

    let target_date = if start < end {
        if minutes < start {
            local.date_naive()
        } else {
            local.date_naive().checked_add_days(chrono::Days::new(1))?
        }
    } else if minutes < start && minutes >= end {
        local.date_naive()
    } else {
        local.date_naive().checked_add_days(chrono::Days::new(1))?
    };
    let candidate = local_time_to_utc(&tz, target_date, start)?;
    if candidate > now {
        Some(candidate)
    } else {
        let next_date = target_date.checked_add_days(chrono::Days::new(1))?;
        local_time_to_utc(&tz, next_date, start)
    }
}

fn local_time_to_utc(
    tz: &chrono_tz::Tz,
    date: chrono::NaiveDate,
    minutes: u32,
) -> Option<DateTime<Utc>> {
    let naive = date.and_hms_opt(minutes / 60, minutes % 60, 0)?;
    match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
        chrono::LocalResult::Ambiguous(early, _) => Some(early.with_timezone(&Utc)),
        chrono::LocalResult::None => (1..=120).find_map(|offset| {
            let adjusted = naive + chrono::Duration::minutes(offset);
            match tz.from_local_datetime(&adjusted) {
                chrono::LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
                chrono::LocalResult::Ambiguous(early, _) => Some(early.with_timezone(&Utc)),
                chrono::LocalResult::None => None,
            }
        }),
    }
}

fn is_in_window(minutes: u32, start: u32, end: u32) -> bool {
    if start < end {
        minutes >= start && minutes < end
    } else {
        minutes >= start || minutes < end
    }
}

fn parse_hhmm(s: &str) -> Option<u32> {
    let (hour, minute) = s.split_once(':')?;
    let hour: u32 = hour.parse().ok()?;
    let minute: u32 = minute.parse().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    Some(hour * 60 + minute)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn shanghai_night_window() -> RecurringWindow {
        RecurringWindow {
            timezone: "Asia/Shanghai".to_string(),
            start: "21:00".to_string(),
            end: "09:00".to_string(),
        }
    }

    #[test]
    fn missed_window_catches_up_at_next_window_start_not_next_full_interval() {
        let candidate = Utc.with_ymd_and_hms(2026, 7, 1, 13, 0, 0).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 7, 2, 7, 0, 0).unwrap();
        let next = resolve_missed_interval_target(
            candidate,
            14 * 24 * 60 * 60,
            now,
            Some(&shanghai_night_window()),
            5,
        );

        assert_eq!(next, Utc.with_ymd_and_hms(2026, 7, 2, 13, 0, 0).unwrap());
    }

    #[test]
    fn missed_window_catches_up_immediately_when_still_inside_window() {
        let candidate = Utc.with_ymd_and_hms(2026, 7, 1, 13, 0, 0).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 7, 2, 15, 0, 0).unwrap();
        let next = resolve_missed_interval_target(
            candidate,
            14 * 24 * 60 * 60,
            now,
            Some(&shanghai_night_window()),
            5,
        );

        assert_eq!(next, now + chrono::Duration::seconds(5));
    }
}
