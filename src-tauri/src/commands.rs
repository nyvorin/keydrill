use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use crate::core::clock::SystemClock;
use crate::core::stats::{
    DrillSummary, HeatCell, KeystrokeLog, LatencyTrendPoint, SkillStat, TrendPoint,
};
use crate::store::{DayState, SessionMeta, Store, StoreError};

pub type AppState = Mutex<Store>;

fn err_str(e: StoreError) -> String {
    match e {
        StoreError::Sqlite(inner) => format!("sqlite: {inner}"),
        StoreError::UnknownSession(id) => format!("unknown session: {id}"),
    }
}

// ---------- inbound DTOs (camelCase from the webview) ----------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeystrokeLogDto {
    pub ts: f64,
    pub expected: String,
    pub got: String,
    pub correct: bool,
    pub latency_ms: Option<f64>,
    pub skill_id: Option<String>,
}

impl From<KeystrokeLogDto> for KeystrokeLog {
    fn from(d: KeystrokeLogDto) -> Self {
        KeystrokeLog {
            ts: d.ts,
            expected: d.expected,
            got: d.got,
            correct: d.correct,
            latency_ms: d.latency_ms,
            skill_id: d.skill_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillSummaryDto {
    pub wpm: f64,
    pub accuracy: f64,
    pub duration_ms: f64,
    pub keystrokes: i64,
    pub errors: i64,
    pub layer_latency_ms: Option<f64>,
    pub base_latency_ms: Option<f64>,
}

impl From<DrillSummaryDto> for DrillSummary {
    fn from(d: DrillSummaryDto) -> Self {
        DrillSummary {
            wpm: d.wpm,
            accuracy: d.accuracy,
            duration_ms: d.duration_ms,
            keystrokes: d.keystrokes,
            errors: d.errors,
            layer_latency_ms: d.layer_latency_ms,
            base_latency_ms: d.base_latency_ms,
        }
    }
}

// ---------- outbound DTOs (camelCase to the webview) ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetaDto {
    pub id: String,
    pub mode: String,
    pub language: Option<String>,
    pub started_at: i64,
}

impl From<SessionMeta> for SessionMetaDto {
    fn from(m: SessionMeta) -> Self {
        SessionMetaDto {
            id: m.id,
            mode: m.mode,
            language: m.language,
            started_at: m.started_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStatDto {
    pub skill_id: String,
    pub ewma_error: f64,
    pub ewma_latency_ms: f64,
    pub samples: i64,
}

impl From<SkillStat> for SkillStatDto {
    fn from(s: SkillStat) -> Self {
        SkillStatDto {
            skill_id: s.skill_id,
            ewma_error: s.ewma_error,
            ewma_latency_ms: s.ewma_latency_ms,
            samples: s.samples,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPointDto {
    pub date: String,
    pub wpm: f64,
    pub accuracy: f64,
}

impl From<TrendPoint> for TrendPointDto {
    fn from(t: TrendPoint) -> Self {
        TrendPointDto {
            date: t.date,
            wpm: t.wpm,
            accuracy: t.accuracy,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatCellDto {
    pub key_id: String,
    pub layer: String,
    pub error_rate: f64,
    pub median_latency_ms: f64,
    pub samples: i64,
}

impl From<HeatCell> for HeatCellDto {
    fn from(h: HeatCell) -> Self {
        HeatCellDto {
            key_id: h.key_id,
            layer: h.layer,
            error_rate: h.error_rate,
            median_latency_ms: h.median_latency_ms,
            samples: h.samples,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStateDto {
    pub date: String,
    pub session_completed: bool,
    pub streak: i64,
}

impl From<DayState> for DayStateDto {
    fn from(d: DayState) -> Self {
        DayStateDto {
            date: d.date,
            session_completed: d.session_completed,
            streak: d.streak,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyTrendPointDto {
    pub date: String,
    pub base_ms: Option<f64>,
    pub layer_ms: Option<f64>,
}

impl From<LatencyTrendPoint> for LatencyTrendPointDto {
    fn from(p: LatencyTrendPoint) -> Self {
        LatencyTrendPointDto {
            date: p.date,
            base_ms: p.base_ms,
            layer_ms: p.layer_ms,
        }
    }
}

// ---------- commands ----------

#[tauri::command]
pub fn start_session(
    state: State<'_, AppState>,
    mode: String,
    language: Option<String>,
) -> Result<SessionMetaDto, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store
        .start_session(&mode, language.as_deref(), &SystemClock)
        .map(SessionMetaDto::from)
        .map_err(err_str)
}

#[tauri::command]
pub fn ingest_keystrokes(
    state: State<'_, AppState>,
    session_id: String,
    logs: Vec<KeystrokeLogDto>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let logs: Vec<KeystrokeLog> = logs.into_iter().map(KeystrokeLog::from).collect();
    store
        .ingest_keystrokes(&session_id, &logs, &SystemClock)
        .map_err(err_str)
}

#[tauri::command]
pub fn end_session(
    state: State<'_, AppState>,
    session_id: String,
    summary: DrillSummaryDto,
    completed_daily_session: bool,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store
        .end_session(
            &session_id,
            &summary.into(),
            completed_daily_session,
            &SystemClock,
        )
        .map_err(err_str)
}

#[tauri::command]
pub fn get_skill_stats(state: State<'_, AppState>) -> Result<Vec<SkillStatDto>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store
        .get_skill_stats()
        .map(|v| v.into_iter().map(SkillStatDto::from).collect())
        .map_err(err_str)
}

#[tauri::command]
pub fn get_trends(
    state: State<'_, AppState>,
    days: i64,
    mode: Option<String>,
) -> Result<Vec<TrendPointDto>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store
        .get_trends(days, mode.as_deref(), &SystemClock)
        .map(|v| v.into_iter().map(TrendPointDto::from).collect())
        .map_err(err_str)
}

#[tauri::command]
pub fn get_recent_days(state: State<'_, AppState>, limit: i64) -> Result<Vec<DayStateDto>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store
        .get_recent_days(limit)
        .map(|v| v.into_iter().map(DayStateDto::from).collect())
        .map_err(err_str)
}

#[tauri::command]
pub fn get_latency_trend(
    state: State<'_, AppState>,
    days: i64,
) -> Result<Vec<LatencyTrendPointDto>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store
        .get_latency_trend(days, &SystemClock)
        .map(|v| v.into_iter().map(LatencyTrendPointDto::from).collect())
        .map_err(err_str)
}

#[tauri::command]
pub fn get_heatmap(state: State<'_, AppState>, layer: String) -> Result<Vec<HeatCellDto>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store
        .get_heatmap(&layer)
        .map(|v| v.into_iter().map(HeatCellDto::from).collect())
        .map_err(err_str)
}

#[tauri::command]
pub fn get_day_state(state: State<'_, AppState>) -> Result<DayStateDto, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store
        .get_day_state(&SystemClock)
        .map(DayStateDto::from)
        .map_err(err_str)
}

#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.get_setting(&key).map_err(err_str)
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.set_setting(&key, &value).map_err(err_str)
}

/// Open the store at the platform app-data dir and put it into managed state.
/// Called from `lib.rs` setup.
pub fn init_store(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let store =
        Store::open(&dir.join("keydrill.db")).map_err(|e| format!("open store: {}", err_str(e)))?;
    app.manage(Mutex::new(store));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keystroke_dto_maps_field_for_field() {
        let dto: KeystrokeLogDto = serde_json::from_str(
            r#"{"ts":12.0,"expected":"{","got":"[","correct":false,"latencyMs":250.0,"skillId":"lower:L35"}"#,
        )
        .unwrap();
        let log: KeystrokeLog = dto.into();
        assert_eq!(log.expected, "{");
        assert_eq!(log.got, "[");
        assert!(!log.correct);
        assert_eq!(log.latency_ms, Some(250.0));
        assert_eq!(log.skill_id.as_deref(), Some("lower:L35"));
    }

    #[test]
    fn summary_dto_accepts_camel_case_and_nulls() {
        let dto: DrillSummaryDto = serde_json::from_str(
            r#"{"wpm":41.5,"accuracy":0.97,"durationMs":60000.0,"keystrokes":200,"errors":6,"layerLatencyMs":null,"baseLatencyMs":180.0}"#,
        )
        .unwrap();
        let s: DrillSummary = dto.into();
        assert_eq!(s.keystrokes, 200);
        assert_eq!(s.layer_latency_ms, None);
        assert_eq!(s.base_latency_ms, Some(180.0));
    }

    #[test]
    fn outbound_dtos_serialize_camel_case() {
        let json = serde_json::to_string(&SkillStatDto {
            skill_id: "lower:R11".into(),
            ewma_error: 0.1,
            ewma_latency_ms: 300.0,
            samples: 5,
        })
        .unwrap();
        assert!(json.contains("\"skillId\""));
        assert!(json.contains("\"ewmaLatencyMs\""));
        let json = serde_json::to_string(&DayStateDto {
            date: "2026-08-20".into(),
            session_completed: true,
            streak: 3,
        })
        .unwrap();
        assert!(json.contains("\"sessionCompleted\""));
    }
}
