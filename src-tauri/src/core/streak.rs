use chrono::{DateTime, Duration, FixedOffset, NaiveDate, Timelike};
use serde::{Deserialize, Serialize};

/// One row of the `days` table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayRecord {
    pub date: String,
    pub session_completed: bool,
    pub streak: i64,
    pub reminder_fired_at: Option<i64>,
    pub snoozed_until: Option<i64>,
}

impl DayRecord {
    /// A day that has not been touched yet.
    pub fn empty(date: &str) -> Self {
        DayRecord {
            date: date.to_string(),
            session_completed: false,
            streak: 0,
            reminder_fired_at: None,
            snoozed_until: None,
        }
    }
}

/// Reminder settings, read out of the `settings` table.
#[derive(Debug, Clone, PartialEq)]
pub struct ReminderConfig {
    pub enabled: bool,
    pub hour: u32,
}

impl Default for ReminderConfig {
    fn default() -> Self {
        ReminderConfig {
            enabled: true,
            hour: 18,
        }
    }
}

/// Snooze durations offered by the tray menu, in minutes.
pub const SNOOZE_CHOICES_MIN: [i64; 3] = [30, 60, 360];

/// The calendar day before `date` (`YYYY-MM-DD`). Unparseable input is
/// returned unchanged, which makes the caller's comparison fail closed.
pub fn previous_date(date: &str) -> String {
    match NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(d) => (d - Duration::days(1)).format("%Y-%m-%d").to_string(),
        Err(_) => date.to_string(),
    }
}

/// Streak value for `today` once today's session completes.
/// `prev` is the most recent PREVIOUS day row that has `session_completed`.
/// * already completed today -> unchanged (idempotent re-completion)
/// * `prev` is literally yesterday -> `prev.streak + 1`
/// * anything else (no history, or a gap) -> 1
pub fn streak_after_completion(today: &DayRecord, prev: Option<&DayRecord>) -> i64 {
    if today.session_completed {
        return today.streak.max(1);
    }
    match prev {
        Some(p) if p.session_completed && p.date == previous_date(&today.date) => p.streak + 1,
        _ => 1,
    }
}

/// Whether the reminder should fire right now.
/// Enabled AND today is not complete AND either: a pending snooze has expired
/// (a snooze fires on its own clock, bypassing the hour gate — a 6-hour snooze
/// taken at 18:00 fires at midnight, exactly as asked), or it is at/after the
/// configured hour and today's reminder has not fired yet.
pub fn reminder_due(cfg: &ReminderConfig, now: DateTime<FixedOffset>, day: &DayRecord) -> bool {
    if !cfg.enabled || day.session_completed {
        return false;
    }
    if let Some(until) = day.snoozed_until {
        return now.timestamp_millis() >= until;
    }
    if now.hour() < cfg.hour {
        return false;
    }
    day.reminder_fired_at.is_none()
}

/// Record that the notification just went out; any snooze is consumed.
pub fn after_fire(day: &DayRecord, now_ms: i64) -> DayRecord {
    DayRecord {
        reminder_fired_at: Some(now_ms),
        snoozed_until: None,
        ..day.clone()
    }
}

/// Push the next possible fire out by `minutes`.
pub fn after_snooze(day: &DayRecord, now_ms: i64, minutes: i64) -> DayRecord {
    DayRecord {
        snoozed_until: Some(now_ms + minutes * 60_000),
        ..day.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(iso: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(iso).expect("valid RFC3339")
    }

    fn ms(iso: &str) -> i64 {
        at(iso).timestamp_millis()
    }

    fn completed(date: &str, streak: i64) -> DayRecord {
        DayRecord {
            session_completed: true,
            streak,
            ..DayRecord::empty(date)
        }
    }

    #[test]
    fn previous_date_walks_back_one_day_across_a_month_boundary() {
        assert_eq!(previous_date("2026-08-17"), "2026-08-16");
        assert_eq!(previous_date("2026-09-01"), "2026-08-31");
        assert_eq!(previous_date("2027-01-01"), "2026-12-31");
    }

    #[test]
    fn first_ever_completion_starts_the_streak_at_one() {
        assert_eq!(
            streak_after_completion(&DayRecord::empty("2026-08-17"), None),
            1
        );
    }

    #[test]
    fn consecutive_days_accumulate() {
        let yesterday = completed("2026-08-16", 4);
        assert_eq!(
            streak_after_completion(&DayRecord::empty("2026-08-17"), Some(&yesterday)),
            5
        );
    }

    #[test]
    fn a_gap_resets_the_streak_to_one() {
        let two_days_ago = completed("2026-08-15", 9);
        assert_eq!(
            streak_after_completion(&DayRecord::empty("2026-08-17"), Some(&two_days_ago)),
            1
        );
    }

    #[test]
    fn completing_twice_in_one_day_is_idempotent() {
        let today = completed("2026-08-17", 5);
        let yesterday = completed("2026-08-16", 4);
        assert_eq!(streak_after_completion(&today, Some(&yesterday)), 5);
    }

    #[test]
    fn reminder_fires_at_the_configured_hour_and_only_once() {
        let cfg = ReminderConfig { enabled: true, hour: 18 };
        let day = DayRecord::empty("2026-08-17");

        assert!(!reminder_due(&cfg, at("2026-08-17T17:59:00-07:00"), &day));
        assert!(reminder_due(&cfg, at("2026-08-17T18:00:00-07:00"), &day));

        let fired = after_fire(&day, ms("2026-08-17T18:00:00-07:00"));
        assert_eq!(fired.reminder_fired_at, Some(ms("2026-08-17T18:00:00-07:00")));
        assert!(!reminder_due(&cfg, at("2026-08-17T19:00:00-07:00"), &fired));
    }

    #[test]
    fn reminder_respects_disabled_and_completed() {
        let day = DayRecord::empty("2026-08-17");
        let off = ReminderConfig { enabled: false, hour: 18 };
        assert!(!reminder_due(&off, at("2026-08-17T20:00:00-07:00"), &day));

        let cfg = ReminderConfig { enabled: true, hour: 18 };
        let done = completed("2026-08-17", 1);
        assert!(!reminder_due(&cfg, at("2026-08-17T20:00:00-07:00"), &done));
    }

    #[test]
    fn snoozing_delays_the_refire_by_the_chosen_minutes() {
        let cfg = ReminderConfig { enabled: true, hour: 18 };
        let fired = after_fire(&DayRecord::empty("2026-08-17"), ms("2026-08-17T18:00:00-07:00"));

        for minutes in SNOOZE_CHOICES_MIN {
            let snoozed = after_snooze(&fired, ms("2026-08-17T18:00:00-07:00"), minutes);
            assert_eq!(
                snoozed.snoozed_until,
                Some(ms("2026-08-17T18:00:00-07:00") + minutes * 60_000)
            );
            let one_minute_early = ms("2026-08-17T18:00:00-07:00") + (minutes - 1) * 60_000;
            let due_at = ms("2026-08-17T18:00:00-07:00") + minutes * 60_000;
            assert!(!reminder_due(
                &cfg,
                fixed_from_ms(one_minute_early),
                &snoozed
            ));
            assert!(reminder_due(&cfg, fixed_from_ms(due_at), &snoozed));
        }
    }

    #[test]
    fn firing_after_a_snooze_clears_the_snooze() {
        let day = after_snooze(
            &after_fire(&DayRecord::empty("2026-08-17"), ms("2026-08-17T18:00:00-07:00")),
            ms("2026-08-17T18:00:00-07:00"),
            30,
        );
        let refired = after_fire(&day, ms("2026-08-17T18:30:00-07:00"));
        assert_eq!(refired.snoozed_until, None);
        assert_eq!(
            refired.reminder_fired_at,
            Some(ms("2026-08-17T18:30:00-07:00"))
        );
    }

    fn fixed_from_ms(ms_value: i64) -> DateTime<FixedOffset> {
        use chrono::TimeZone;
        FixedOffset::west_opt(7 * 3600)
            .expect("valid offset")
            .timestamp_millis_opt(ms_value)
            .single()
            .expect("representable instant")
    }
}
