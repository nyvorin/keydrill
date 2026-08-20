use std::time::Duration;

use crate::core::clock::{Clock, SystemClock};
use crate::core::streak::{reminder_due, DayRecord, ReminderConfig};
use crate::store::{Store, StoreError};

const ENABLED_KEY: &str = "reminder.enabled";
const HOUR_KEY: &str = "reminder.hour";
const SNOOZED_KEY: &str = "reminder.snoozedUntil";

fn read_config(store: &Store) -> Result<ReminderConfig, StoreError> {
    let enabled = store
        .get_setting(ENABLED_KEY)?
        .map(|v| v != "false")
        .unwrap_or(true);
    let hour = store
        .get_setting(HOUR_KEY)?
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|h| *h < 24)
        .unwrap_or(9);
    Ok(ReminderConfig { enabled, hour })
}

fn read_day_with_snooze(store: &Store, clock: &dyn Clock) -> Result<DayRecord, StoreError> {
    let mut day = store.get_day(&clock.today())?;
    // The settings key is the single snooze source (shared with the webview banner);
    // it overrides whatever the days row carries.
    // `0` is the "no snooze" sentinel (the webview banner defaults the key to '0' too),
    // so it must NOT become `Some(0)` — that would make every poll due.
    day.snoozed_until = store
        .get_setting(SNOOZED_KEY)?
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|ms| *ms > 0);
    Ok(day)
}

/// True when the once-a-day reminder should fire right now.
pub fn compute_due(store: &Store, clock: &dyn Clock) -> Result<bool, StoreError> {
    let cfg = read_config(store)?;
    let day = read_day_with_snooze(store, clock)?;
    Ok(reminder_due(&cfg, clock.now_fixed(), &day))
}

/// Record that today's reminder fired so it never double-fires.
///
/// Clearing the shared snooze key FIRST is load-bearing: `read_day_with_snooze` always
/// overwrites `day.snoozed_until` from the setting, and `reminder_due`'s `Some(until)` arm
/// never consults `reminder_fired_at`. Leaving an elapsed snooze behind would make
/// `compute_due` true on every 60-second poll, forever and across days.
pub fn mark_fired(store: &mut Store, clock: &dyn Clock) -> Result<(), StoreError> {
    store.set_setting(SNOOZED_KEY, "0")?;
    let mut day = store.get_day(&clock.today())?;
    day.reminder_fired_at = Some(clock.now_ms());
    day.snoozed_until = None;
    store.put_day(&day)
}

/// Push the reminder out by `minutes` (30 / 60 / 360 from the tray or banner).
pub fn snooze_minutes(store: &mut Store, clock: &dyn Clock, minutes: i64) -> Result<(), StoreError> {
    let until = clock.now_ms() + minutes * 60_000;
    store.set_setting(SNOOZED_KEY, &until.to_string())?;
    // A snoozed reminder may fire again today once the snooze elapses.
    let mut day = store.get_day(&clock.today())?;
    day.reminder_fired_at = None;
    store.put_day(&day)
}

/// 60-second poll loop; fires at most one native notification per day.
pub fn spawn_reminder_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        use tauri_plugin_notification::NotificationExt;
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let state = app.state::<crate::commands::AppState>();
            let due = {
                let store = match state.lock() {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                compute_due(&store, &SystemClock).unwrap_or(false)
            };
            if due {
                let _ = app
                    .notification()
                    .builder()
                    .title("keydrill")
                    .body("Time to train — 10 minutes keeps the streak.")
                    .show();
                if let Ok(mut store) = state.lock() {
                    let _ = mark_fired(&mut store, &SystemClock);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::clock::FixedClock;

    fn store_at(iso: &str) -> (Store, FixedClock) {
        (Store::open_in_memory().unwrap(), FixedClock::new(iso))
    }

    #[test]
    fn due_after_hour_with_defaults() {
        let (store, clock) = store_at("2026-08-20T09:30:00");
        assert!(compute_due(&store, &clock).unwrap());
    }

    #[test]
    fn not_due_before_hour_or_when_disabled() {
        let (mut store, clock) = store_at("2026-08-20T08:59:00");
        assert!(!compute_due(&store, &clock).unwrap());
        let (mut s2, c2) = store_at("2026-08-20T10:00:00");
        s2.set_setting("reminder.enabled", "false").unwrap();
        assert!(!compute_due(&s2, &c2).unwrap());
        store.set_setting("reminder.hour", "23").unwrap();
        assert!(!compute_due(&store, &clock).unwrap());
    }

    #[test]
    fn snooze_setting_suppresses_until_elapsed() {
        let (mut store, clock) = store_at("2026-08-20T10:00:00");
        snooze_minutes(&mut store, &clock, 30).unwrap();
        assert!(!compute_due(&store, &clock).unwrap());
        let later = FixedClock::new("2026-08-20T10:31:00");
        assert!(compute_due(&store, &later).unwrap());
    }

    #[test]
    fn mark_fired_prevents_refire_same_day() {
        let (mut store, clock) = store_at("2026-08-20T10:00:00");
        assert!(compute_due(&store, &clock).unwrap());
        mark_fired(&mut store, &clock).unwrap();
        assert!(!compute_due(&store, &clock).unwrap());
        let tomorrow = FixedClock::new("2026-08-21T10:00:00");
        assert!(compute_due(&store, &tomorrow).unwrap());
    }

    #[test]
    fn mark_fired_clears_an_elapsed_snooze() {
        let (mut store, clock) = store_at("2026-08-20T10:00:00");
        snooze_minutes(&mut store, &clock, 30).unwrap();
        let later = FixedClock::new("2026-08-20T10:31:00");
        assert!(compute_due(&store, &later).unwrap());
        mark_fired(&mut store, &later).unwrap();
        // Without clearing `reminder.snoozedUntil` this stays true on every 60 s poll.
        assert!(!compute_due(&store, &later).unwrap());
        let even_later = FixedClock::new("2026-08-20T23:59:00");
        assert!(!compute_due(&store, &even_later).unwrap());
    }

    #[test]
    fn completed_session_silences_the_day() {
        let (mut store, clock) = store_at("2026-08-20T10:00:00");
        store.complete_today(&clock).unwrap();
        assert!(!compute_due(&store, &clock).unwrap());
    }
}
