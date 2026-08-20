use rusqlite::Connection;

/// Bump this (and add a `MIGRATION_Vn`) whenever the schema changes.
pub const SCHEMA_VERSION: i64 = 1;

/// Initial schema — spec §10.
pub const MIGRATION_V1: &str = r#"
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  mode        TEXT NOT NULL,
  language    TEXT,
  wpm         REAL,
  accuracy    REAL,
  completed   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE keystroke_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  expected    TEXT NOT NULL,
  got         TEXT NOT NULL,
  correct     INTEGER NOT NULL,
  latency_ms  REAL,
  skill_id    TEXT,
  drill_id    TEXT
);

CREATE INDEX idx_events_session ON keystroke_events(session_id);
CREATE INDEX idx_events_skill   ON keystroke_events(skill_id);

CREATE TABLE skills (
  id              TEXT PRIMARY KEY,
  layer           TEXT NOT NULL,
  key_id          TEXT NOT NULL,
  ewma_error      REAL NOT NULL,
  ewma_latency_ms REAL NOT NULL,
  samples         INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE days (
  date              TEXT PRIMARY KEY,
  session_completed INTEGER NOT NULL DEFAULT 0,
  streak            INTEGER NOT NULL DEFAULT 0,
  reminder_fired_at INTEGER,
  snoozed_until     INTEGER
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

PRAGMA user_version = 1;
"#;

/// Bring `conn` up to `SCHEMA_VERSION`. Safe to call on every open.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(MIGRATION_V1)?;
    }
    Ok(())
}
