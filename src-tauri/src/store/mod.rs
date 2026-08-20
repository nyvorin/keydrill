pub mod schema;

use std::fmt;

/// Mirrors `SESSION_COUNT_KEY` in `src/lib/backend/api.ts` — every `Backend`
/// implementation increments it inside `end_session`.
pub const SESSION_COUNT_KEY: &str = "stats.sessionCount";

/// Every fallible store path returns this. No panics escape the store.
#[derive(Debug)]
pub enum StoreError {
    Sqlite(rusqlite::Error),
    UnknownSession(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Sqlite(e) => write!(f, "sqlite error: {e}"),
            StoreError::UnknownSession(id) => write!(f, "unknown session: {id}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sqlite(e)
    }
}

use crate::core::clock::Clock;
use crate::core::stats::{
    aggregate_heatmap, aggregate_latency_trend, aggregate_trends, split_skill_id, update_skill,
    DrillSummary, HeatCell, KeystrokeLog, LatencyTrendPoint, SessionRow, SkillEvent, SkillStat,
    TimedSkillEvent, TrendPoint,
};
use crate::core::streak::{previous_date, streak_after_completion, DayRecord};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Mirrors the TS `SessionMeta`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub mode: String,
    pub language: Option<String>,
    pub started_at: i64,
}

/// Mirrors the TS `DayState`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayState {
    pub date: String,
    pub session_completed: bool,
    pub streak: i64,
}

/// The imperative shell: the only place in the crate that talks to SQLite.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Open (creating if absent) the database at `path` and migrate it.
    pub fn open(path: &Path) -> Result<Store, StoreError> {
        let conn = Connection::open(path)?;
        schema::migrate(&conn)?;
        Ok(Store { conn })
    }

    /// Ephemeral database — used by tests and by `--fresh` debugging runs.
    pub fn open_in_memory() -> Result<Store, StoreError> {
        let conn = Connection::open_in_memory()?;
        schema::migrate(&conn)?;
        Ok(Store { conn })
    }

    /// Open a new session row and hand back its identity.
    pub fn start_session(
        &self,
        mode: &str,
        language: Option<&str>,
        clock: &dyn Clock,
    ) -> Result<SessionMeta, StoreError> {
        let id = uuid::Uuid::new_v4().to_string();
        let started_at = clock.now_ms();
        self.conn.execute(
            "INSERT INTO sessions (id, started_at, mode, language, completed)
             VALUES (?1, ?2, ?3, ?4, 0)",
            params![id, started_at, mode, language],
        )?;
        Ok(SessionMeta {
            id,
            mode: mode.to_string(),
            language: language.map(|s| s.to_string()),
            started_at,
        })
    }

    /// Append raw keystrokes and fold each one into its skill's EWMA.
    /// One transaction, so a partial batch never lands.
    pub fn ingest_keystrokes(
        &mut self,
        session_id: &str,
        logs: &[KeystrokeLog],
        clock: &dyn Clock,
    ) -> Result<(), StoreError> {
        let known: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM sessions WHERE id = ?1",
                params![session_id],
                |r| r.get(0),
            )
            .optional()?;
        if known.is_none() {
            return Err(StoreError::UnknownSession(session_id.to_string()));
        }

        let now = clock.now_ms();
        let tx = self.conn.transaction()?;
        {
            let mut insert_event = tx.prepare(
                "INSERT INTO keystroke_events
                   (session_id, ts, expected, got, correct, latency_ms, skill_id, drill_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
            )?;
            let mut select_skill = tx.prepare(
                "SELECT id, ewma_error, ewma_latency_ms, samples FROM skills WHERE id = ?1",
            )?;
            let mut upsert_skill = tx.prepare(
                "INSERT INTO skills (id, layer, key_id, ewma_error, ewma_latency_ms, samples, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                   ewma_error      = excluded.ewma_error,
                   ewma_latency_ms = excluded.ewma_latency_ms,
                   samples         = excluded.samples,
                   updated_at      = excluded.updated_at",
            )?;

            for entry in logs {
                insert_event.execute(params![
                    session_id,
                    entry.ts as i64,
                    entry.expected,
                    entry.got,
                    entry.correct as i64,
                    entry.latency_ms,
                    entry.skill_id,
                ])?;

                let Some(skill_id) = entry.skill_id.as_deref() else {
                    continue;
                };
                let Some((layer, key_id)) = split_skill_id(skill_id) else {
                    continue;
                };
                let prev = select_skill
                    .query_row(params![skill_id], Store::map_skill)
                    .optional()?;
                let next = update_skill(prev.as_ref(), entry);
                upsert_skill.execute(params![
                    next.skill_id,
                    layer,
                    key_id,
                    next.ewma_error,
                    next.ewma_latency_ms,
                    next.samples,
                    now,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Close a session out with its summary. `completed_daily_session` also
    /// marks today done and advances the streak.
    ///
    /// The `stats.sessionCount` settings key is incremented HERE, because the TS
    /// `Backend` contract (Task 8, `SESSION_COUNT_KEY`) binds every implementation to
    /// bump it inside `endSession` — `MockBackend` does it in `endSession`, so the Rust
    /// store owns it on the Tauri path. Without this, `[data-testid="session-count"]`
    /// on `#/stats` is permanently 0 in the packaged app.
    pub fn end_session(
        &mut self,
        session_id: &str,
        summary: &DrillSummary,
        completed_daily_session: bool,
        clock: &dyn Clock,
    ) -> Result<(), StoreError> {
        let updated = self.conn.execute(
            "UPDATE sessions
                SET ended_at = ?2, wpm = ?3, accuracy = ?4, completed = ?5
              WHERE id = ?1",
            params![
                session_id,
                clock.now_ms(),
                summary.wpm,
                summary.accuracy,
                completed_daily_session as i64,
            ],
        )?;
        if updated == 0 {
            return Err(StoreError::UnknownSession(session_id.to_string()));
        }
        let count = self
            .get_setting(SESSION_COUNT_KEY)?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0)
            + 1;
        self.set_setting(SESSION_COUNT_KEY, &count.to_string())?;
        if completed_daily_session {
            self.complete_today(clock)?;
        }
        Ok(())
    }

    /// Every skill the trainee has ever produced, ascending by id.
    pub fn get_skill_stats(&self) -> Result<Vec<SkillStat>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, ewma_error, ewma_latency_ms, samples FROM skills ORDER BY id",
        )?;
        let rows = stmt.query_map([], Store::map_skill)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        let value = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value)
    }

    pub fn set_setting(&mut self, key: &str, value: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// A day row, or a blank one if that date has never been touched.
    pub fn get_day(&self, date: &str) -> Result<DayRecord, StoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT date, session_completed, streak, reminder_fired_at, snoozed_until
                   FROM days WHERE date = ?1",
                params![date],
                Store::map_day,
            )
            .optional()?;
        Ok(row.unwrap_or_else(|| DayRecord::empty(date)))
    }

    pub fn put_day(&mut self, day: &DayRecord) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO days (date, session_completed, streak, reminder_fired_at, snoozed_until)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(date) DO UPDATE SET
               session_completed = excluded.session_completed,
               streak            = excluded.streak,
               reminder_fired_at = excluded.reminder_fired_at,
               snoozed_until     = excluded.snoozed_until",
            params![
                day.date,
                day.session_completed as i64,
                day.streak,
                day.reminder_fired_at,
                day.snoozed_until,
            ],
        )?;
        Ok(())
    }

    /// The most recent COMPLETED day strictly before `date`.
    fn latest_completed_day_before(&self, date: &str) -> Result<Option<DayRecord>, StoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT date, session_completed, streak, reminder_fired_at, snoozed_until
                   FROM days
                  WHERE date < ?1 AND session_completed = 1
                  ORDER BY date DESC LIMIT 1",
                params![date],
                Store::map_day,
            )
            .optional()?;
        Ok(row)
    }

    /// Mark today done, advancing the streak per the pure rule. Idempotent.
    pub fn complete_today(&mut self, clock: &dyn Clock) -> Result<DayState, StoreError> {
        let date = clock.today();
        let today = self.get_day(&date)?;
        let prev = self.latest_completed_day_before(&date)?;
        let streak = streak_after_completion(&today, prev.as_ref());
        let next = DayRecord {
            session_completed: true,
            streak,
            ..today
        };
        self.put_day(&next)?;
        Ok(DayState {
            date: next.date,
            session_completed: true,
            streak,
        })
    }

    /// What the Home screen shows: today's completion plus the live streak.
    pub fn get_day_state(&self, clock: &dyn Clock) -> Result<DayState, StoreError> {
        let date = clock.today();
        let today = self.get_day(&date)?;
        if today.session_completed {
            return Ok(DayState {
                date,
                session_completed: true,
                streak: today.streak,
            });
        }
        let streak = match self.latest_completed_day_before(&date)? {
            Some(prev) if prev.date == previous_date(&date) => prev.streak,
            _ => 0,
        };
        Ok(DayState {
            date,
            session_completed: false,
            streak,
        })
    }

    /// Daily WPM/accuracy means over the last `days` local calendar days
    /// (today inclusive), ascending. Only finished sessions count.
    /// `mode` narrows to one session mode (`"drill"` / `"code"` / `"session"`); `None` = all.
    pub fn get_trends(
        &self,
        days: i64,
        mode: Option<&str>,
        clock: &dyn Clock,
    ) -> Result<Vec<TrendPoint>, StoreError> {
        let window = days.max(1);
        let now = clock.now_fixed();
        let offset = *now.offset();
        let cutoff = (now.date_naive() - chrono::Duration::days(window - 1))
            .and_hms_opt(0, 0, 0)
            .and_then(|naive| naive.and_local_timezone(offset).single())
            .map(|dt| dt.timestamp_millis())
            .unwrap_or(0);

        let mut stmt = self.conn.prepare(
            "SELECT started_at, wpm, accuracy
               FROM sessions
              WHERE ended_at IS NOT NULL AND started_at >= ?1
                AND (?2 IS NULL OR mode = ?2)
              ORDER BY started_at",
        )?;
        let rows = stmt.query_map(params![cutoff, mode], |row| {
            Ok(SessionRow {
                started_at_ms: row.get(0)?,
                wpm: row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                accuracy: row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
            })
        })?;
        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(aggregate_trends(&sessions, &offset))
    }

    /// Per-key error rate and median latency for one layer.
    pub fn get_heatmap(&self, layer: &str) -> Result<Vec<HeatCell>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT skill_id, correct, latency_ms
               FROM keystroke_events
              WHERE skill_id IS NOT NULL AND skill_id LIKE ?1",
        )?;
        let rows = stmt.query_map(params![format!("{layer}:%")], |row| {
            Ok(SkillEvent {
                skill_id: row.get(0)?,
                correct: row.get::<_, i64>(1)? != 0,
                latency_ms: row.get(2)?,
            })
        })?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row?);
        }
        Ok(aggregate_heatmap(&events, layer))
    }

    /// The newest `limit` day rows, newest-first — what the calendar renders.
    pub fn get_recent_days(&self, limit: i64) -> Result<Vec<DayState>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT date, session_completed, streak
               FROM days
              ORDER BY date DESC
              LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.max(0)], |row| {
            Ok(DayState {
                date: row.get(0)?,
                session_completed: row.get::<_, i64>(1)? != 0,
                streak: row.get(2)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Per-local-day median keystroke latency, base vs layer, ascending by date,
    /// trimmed to the most recent `days` points.
    pub fn get_latency_trend(
        &self,
        days: i64,
        clock: &dyn Clock,
    ) -> Result<Vec<LatencyTrendPoint>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT ts, skill_id, latency_ms
               FROM keystroke_events
              WHERE skill_id IS NOT NULL AND latency_ms IS NOT NULL
              ORDER BY ts",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TimedSkillEvent {
                ts_ms: row.get(0)?,
                skill_id: row.get(1)?,
                latency_ms: row.get::<_, Option<f64>>(2)?,
            })
        })?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row?);
        }

        // Same pattern as `get_trends`: take the offset by value, never `&…offset()`
        // (that would be a `&&FixedOffset` and fail to compile).
        let now = clock.now_fixed();
        let offset = *now.offset();
        let mut points = aggregate_latency_trend(&events, &offset);
        let window = days.max(1) as usize;
        if points.len() > window {
            points.drain(..points.len() - window);
        }
        Ok(points)
    }

    fn map_skill(row: &Row<'_>) -> rusqlite::Result<SkillStat> {
        Ok(SkillStat {
            skill_id: row.get(0)?,
            ewma_error: row.get(1)?,
            ewma_latency_ms: row.get(2)?,
            samples: row.get(3)?,
        })
    }

    fn map_day(row: &Row<'_>) -> rusqlite::Result<DayRecord> {
        Ok(DayRecord {
            date: row.get(0)?,
            session_completed: row.get::<_, i64>(1)? != 0,
            streak: row.get(2)?,
            reminder_fired_at: row.get(3)?,
            snoozed_until: row.get(4)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_names(store: &Store) -> Vec<String> {
        // `sqlite_sequence` is created implicitly by AUTOINCREMENT — not ours.
        store
            .conn
            .prepare(
                "SELECT name FROM sqlite_master
                  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                  ORDER BY name",
            )
            .expect("prepare")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query")
            .map(|r| r.expect("row"))
            .collect()
    }

    #[test]
    fn migrations_create_every_spec_table() {
        let store = Store::open_in_memory().expect("open");
        let names = table_names(&store);
        for expected in ["days", "keystroke_events", "sessions", "settings", "skills"] {
            assert!(names.contains(&expected.to_string()), "missing table {expected}");
        }
    }

    #[test]
    fn migrations_stamp_the_schema_version_and_are_idempotent() {
        let store = Store::open_in_memory().expect("open");
        let version: i64 = store
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("pragma");
        assert_eq!(version, schema::SCHEMA_VERSION);

        schema::migrate(&store.conn).expect("second migrate is a no-op");
        assert_eq!(table_names(&store).len(), 5);
    }

    use crate::core::clock::FixedClock;

    fn log(correct: bool, latency_ms: Option<f64>, skill_id: &str) -> KeystrokeLog {
        KeystrokeLog {
            ts: 1_000.0,
            expected: "{".to_string(),
            got: if correct { "{".to_string() } else { "[".to_string() },
            correct,
            latency_ms,
            skill_id: Some(skill_id.to_string()),
        }
    }

    fn summary(wpm: f64, accuracy: f64) -> DrillSummary {
        DrillSummary {
            wpm,
            accuracy,
            duration_ms: 60_000.0,
            keystrokes: 50,
            errors: 2,
            layer_latency_ms: Some(420.0),
            base_latency_ms: Some(180.0),
        }
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-9, "expected {expected}, got {actual}");
    }

    #[test]
    fn start_session_persists_a_row_and_returns_its_meta() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let store = Store::open_in_memory().expect("open");
        let meta = store.start_session("drill", Some("rust"), &clock).expect("start");

        assert_eq!(meta.mode, "drill");
        assert_eq!(meta.language.as_deref(), Some("rust"));
        assert_eq!(meta.started_at, clock.now_ms());
        assert!(!meta.id.is_empty());

        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE id = ?1", params![meta.id], |r| r.get(0))
            .expect("count");
        assert_eq!(count, 1);
    }

    #[test]
    fn ingest_rejects_an_unknown_session() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");
        let err = store
            .ingest_keystrokes("nope", &[log(true, Some(200.0), "lower:L35")], &clock)
            .expect_err("should reject");
        assert!(matches!(err, StoreError::UnknownSession(ref id) if id == "nope"));
    }

    #[test]
    fn ingest_stores_events_and_upserts_skills_with_the_shared_ewma_fixture() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");
        let meta = store.start_session("drill", None, &clock).expect("start");

        let logs = vec![
            log(true, Some(200.0), "lower:L35"),
            log(false, Some(600.0), "lower:L35"),
            log(true, Some(400.0), "lower:L35"),
            log(true, Some(300.0), "lower:L35"),
            log(false, Some(1000.0), "lower:L35"),
        ];
        store.ingest_keystrokes(&meta.id, &logs, &clock).expect("ingest");

        let events: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM keystroke_events WHERE session_id = ?1", params![meta.id], |r| r.get(0))
            .expect("count");
        assert_eq!(events, 5);

        let stats = store.get_skill_stats().expect("stats");
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].skill_id, "lower:L35");
        assert_close(stats[0].ewma_error, 0.24211875);
        assert_close(stats[0].ewma_latency_ms, 334.36);
        assert_eq!(stats[0].samples, 5);

        let (layer, key_id): (String, String) = store
            .conn
            .query_row("SELECT layer, key_id FROM skills WHERE id = 'lower:L35'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .expect("skill row");
        assert_eq!(layer, "lower");
        assert_eq!(key_id, "L35");
    }

    #[test]
    fn ingest_across_two_calls_continues_the_same_ewma() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");
        let meta = store.start_session("drill", None, &clock).expect("start");

        store
            .ingest_keystrokes(&meta.id, &[log(true, Some(200.0), "lower:L35")], &clock)
            .expect("ingest 1");
        store
            .ingest_keystrokes(&meta.id, &[log(false, Some(600.0), "lower:L35")], &clock)
            .expect("ingest 2");

        let stats = store.get_skill_stats().expect("stats");
        assert_close(stats[0].ewma_error, 0.15);
        assert_close(stats[0].ewma_latency_ms, 240.0);
        assert_eq!(stats[0].samples, 2);
    }

    #[test]
    fn end_session_stamps_wpm_accuracy_and_completion() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");
        let meta = store.start_session("code", Some("sql"), &clock).expect("start");

        store.end_session(&meta.id, &summary(52.5, 0.97), true, &clock).expect("end");

        let (ended_at, wpm, accuracy, completed): (i64, f64, f64, i64) = store
            .conn
            .query_row(
                "SELECT ended_at, wpm, accuracy, completed FROM sessions WHERE id = ?1",
                params![meta.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("session row");
        assert_eq!(ended_at, clock.now_ms());
        assert_close(wpm, 52.5);
        assert_close(accuracy, 0.97);
        assert_eq!(completed, 1);

        // The TS `Backend` contract binds every implementation to bump this in `endSession`.
        assert_eq!(store.get_setting(SESSION_COUNT_KEY).expect("count"), Some("1".to_string()));
        let second = store.start_session("drill", None, &clock).expect("start");
        store.end_session(&second.id, &summary(40.0, 1.0), false, &clock).expect("end");
        assert_eq!(store.get_setting(SESSION_COUNT_KEY).expect("count"), Some("2".to_string()));
    }

    #[test]
    fn settings_round_trip_and_return_none_when_absent() {
        let mut store = Store::open_in_memory().expect("open");
        assert_eq!(store.get_setting("reminder.hour").expect("get"), None);

        store.set_setting("reminder.hour", "18").expect("set");
        assert_eq!(store.get_setting("reminder.hour").expect("get"), Some("18".to_string()));

        store.set_setting("reminder.hour", "7").expect("overwrite");
        assert_eq!(store.get_setting("reminder.hour").expect("get"), Some("7".to_string()));
    }

    #[test]
    fn completing_a_session_writes_the_day_and_starts_the_streak() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");
        let meta = store.start_session("session", None, &clock).expect("start");
        store.end_session(&meta.id, &summary(40.0, 0.95), true, &clock).expect("end");

        let state = store.get_day_state(&clock).expect("day state");
        assert_eq!(state.date, clock.today());
        assert!(state.session_completed);
        assert_eq!(state.streak, 1);
    }

    #[test]
    fn consecutive_days_accumulate_and_a_gap_resets() {
        let mut store = Store::open_in_memory().expect("open");

        let day1 = FixedClock::new("2026-08-15T09:00:00");
        assert_eq!(store.complete_today(&day1).expect("d1").streak, 1);

        let day2 = FixedClock::new("2026-08-16T09:00:00");
        assert_eq!(store.complete_today(&day2).expect("d2").streak, 2);

        // 2026-08-17 skipped entirely.
        let day4 = FixedClock::new("2026-08-18T09:00:00");
        assert_eq!(store.complete_today(&day4).expect("d4").streak, 1);
    }

    #[test]
    fn completing_twice_on_one_day_does_not_double_the_streak() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");
        assert_eq!(store.complete_today(&clock).expect("first").streak, 1);
        assert_eq!(store.complete_today(&clock).expect("second").streak, 1);
    }

    #[test]
    fn day_state_shows_yesterdays_streak_before_today_is_done() {
        let mut store = Store::open_in_memory().expect("open");
        let yesterday = FixedClock::new("2026-08-16T09:00:00");
        store.complete_today(&yesterday).expect("yesterday");

        let today = FixedClock::new("2026-08-17T09:00:00");
        let state = store.get_day_state(&today).expect("state");
        assert!(!state.session_completed);
        assert_eq!(state.streak, 1);
    }

    #[test]
    fn day_rows_round_trip_reminder_bookkeeping() {
        let mut store = Store::open_in_memory().expect("open");
        let day = DayRecord {
            date: "2026-08-17".to_string(),
            session_completed: false,
            streak: 3,
            reminder_fired_at: Some(1_000),
            snoozed_until: Some(2_000),
        };
        store.put_day(&day).expect("put");
        assert_eq!(store.get_day("2026-08-17").expect("get"), day);
        assert_eq!(
            store.get_day("2026-08-18").expect("absent"),
            DayRecord::empty("2026-08-18")
        );
    }

    #[test]
    fn trends_return_one_point_per_local_day_of_finished_sessions() {
        let mut store = Store::open_in_memory().expect("open");

        let morning = FixedClock::new("2026-08-16T09:00:00");
        let m = store.start_session("drill", None, &morning).expect("start");
        store.end_session(&m.id, &summary(40.0, 0.90), false, &morning).expect("end");

        let evening = FixedClock::new("2026-08-16T21:00:00");
        let e = store.start_session("drill", None, &evening).expect("start");
        store.end_session(&e.id, &summary(50.0, 0.98), false, &evening).expect("end");

        let today = FixedClock::new("2026-08-17T09:00:00");
        let t = store.start_session("drill", None, &today).expect("start");
        store.end_session(&t.id, &summary(60.0, 0.94), false, &today).expect("end");

        let trends = store.get_trends(14, None, &today).expect("trends");
        assert_eq!(trends.len(), 2);
        assert_eq!(trends[0].date, "2026-08-16");
        assert_close(trends[0].wpm, 45.0);
        assert_eq!(trends[1].date, "2026-08-17");
        assert_close(trends[1].wpm, 60.0);
    }

    #[test]
    fn trends_exclude_days_outside_the_window_and_unfinished_sessions() {
        let mut store = Store::open_in_memory().expect("open");

        let old = FixedClock::new("2026-08-01T09:00:00");
        let o = store.start_session("drill", None, &old).expect("start");
        store.end_session(&o.id, &summary(10.0, 0.5), false, &old).expect("end");

        let today = FixedClock::new("2026-08-17T09:00:00");
        store.start_session("drill", None, &today).expect("unfinished");

        assert_eq!(store.get_trends(7, None, &today).expect("trends").len(), 0);
    }

    #[test]
    fn recent_days_come_back_newest_first() {
        let mut store = Store::open_in_memory().expect("open");
        for date in ["2026-08-15", "2026-08-16", "2026-08-17"] {
            store
                .put_day(&DayRecord {
                    date: date.to_string(),
                    session_completed: true,
                    streak: 1,
                    reminder_fired_at: None,
                    snoozed_until: None,
                })
                .expect("put");
        }

        let days = store.get_recent_days(2).expect("recent");
        assert_eq!(days.len(), 2);
        assert_eq!(days[0].date, "2026-08-17");
        assert_eq!(days[1].date, "2026-08-16");
        assert!(days[0].session_completed);
    }

    #[test]
    fn latency_trend_returns_one_point_per_day_with_both_medians() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");
        let meta = store.start_session("drill", None, &clock).expect("start");

        // The `log` fixture stamps every event at ts = 1_000 ms, so they share one local day.
        let logs = vec![
            log(true, Some(100.0), "base:L11"),
            log(true, Some(200.0), "base:L12"),
            log(true, Some(500.0), "lower:L35"),
            log(true, None, "raise:R00"),
        ];
        store.ingest_keystrokes(&meta.id, &logs, &clock).expect("ingest");

        let points = store.get_latency_trend(30, &clock).expect("latency trend");
        assert_eq!(points.len(), 1);
        assert_close(points[0].base_ms.expect("base median"), 150.0);
        assert_close(points[0].layer_ms.expect("layer median"), 500.0);
    }

    #[test]
    fn trends_can_be_filtered_by_session_mode() {
        let today = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");

        let d = store.start_session("drill", None, &today).expect("start");
        store.end_session(&d.id, &summary(60.0, 0.99), false, &today).expect("end");
        let c = store.start_session("code", Some("rust"), &today).expect("start");
        store.end_session(&c.id, &summary(40.0, 0.90), false, &today).expect("end");

        let all = store.get_trends(14, None, &today).expect("all");
        assert_eq!(all.len(), 1);
        assert_close(all[0].wpm, 50.0);

        let code = store.get_trends(14, Some("code"), &today).expect("code");
        assert_eq!(code.len(), 1);
        assert_close(code[0].wpm, 40.0);
    }

    #[test]
    fn heatmap_aggregates_events_for_one_layer_only() {
        let clock = FixedClock::new("2026-08-17T09:00:00");
        let mut store = Store::open_in_memory().expect("open");
        let meta = store.start_session("drill", None, &clock).expect("start");

        let logs = vec![
            log(true, Some(300.0), "lower:L35"),
            log(false, Some(900.0), "lower:L35"),
            log(true, Some(500.0), "lower:L35"),
            log(false, Some(700.0), "lower:R11"),
            log(true, Some(120.0), "base:L11"),
        ];
        store.ingest_keystrokes(&meta.id, &logs, &clock).expect("ingest");

        let cells = store.get_heatmap("lower").expect("heatmap");
        assert_eq!(cells.len(), 2);
        let l35 = cells.iter().find(|c| c.key_id == "L35").expect("L35");
        assert_eq!(l35.samples, 3);
        assert_close(l35.error_rate, 1.0 / 3.0);
        assert_close(l35.median_latency_ms, 500.0);

        assert_eq!(store.get_heatmap("base").expect("base").len(), 1);
    }
}
