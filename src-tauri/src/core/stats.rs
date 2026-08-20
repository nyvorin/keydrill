use chrono::{FixedOffset, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// EWMA smoothing factors. These MUST match `src/lib/adaptive/ewma.ts`.
pub const ALPHA_ERROR: f64 = 0.15;
pub const ALPHA_LATENCY: f64 = 0.1;

/// Mirrors the TS `KeystrokeLog` (camelCase over the IPC boundary).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeystrokeLog {
    pub ts: f64,
    pub expected: String,
    pub got: String,
    pub correct: bool,
    pub latency_ms: Option<f64>,
    pub skill_id: Option<String>,
}

/// Mirrors the TS `SkillStat`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStat {
    pub skill_id: String,
    pub ewma_error: f64,
    pub ewma_latency_ms: f64,
    pub samples: i64,
}

/// Mirrors the TS `DrillSummary`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillSummary {
    pub wpm: f64,
    pub accuracy: f64,
    pub duration_ms: f64,
    pub keystrokes: i64,
    pub errors: i64,
    pub layer_latency_ms: Option<f64>,
    pub base_latency_ms: Option<f64>,
}

/// Exponentially-weighted moving average of a skill's error rate and latency.
/// Semantics are locked to `src/lib/adaptive/ewma.ts`:
/// * the first sample SEEDS (`error = correct ? 0 : 1`, `latency = latencyMs ?? 0`);
/// * later samples blend `prev + alpha * (observed - prev)`;
/// * a `None` latency on a later sample leaves the latency EWMA unchanged
///   (a missing inter-key gap is not evidence of a zero-millisecond keystroke),
///   while still counting toward `samples`.
pub fn update_skill(prev: Option<&SkillStat>, log: &KeystrokeLog) -> SkillStat {
    let observed_error = if log.correct { 0.0 } else { 1.0 };
    match prev {
        None => SkillStat {
            skill_id: log.skill_id.clone().unwrap_or_default(),
            ewma_error: observed_error,
            ewma_latency_ms: log.latency_ms.unwrap_or(0.0),
            samples: 1,
        },
        Some(p) => SkillStat {
            skill_id: p.skill_id.clone(),
            ewma_error: p.ewma_error + ALPHA_ERROR * (observed_error - p.ewma_error),
            ewma_latency_ms: match log.latency_ms {
                Some(l) => p.ewma_latency_ms + ALPHA_LATENCY * (l - p.ewma_latency_ms),
                None => p.ewma_latency_ms,
            },
            samples: p.samples + 1,
        },
    }
}

/// Median of a slice. Even counts average the two middle values — same rule as
/// the TS `summarize` helper, so Rust and TS medians never disagree.
pub fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    Some(if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    })
}

/// One finished session, as read out of the store.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionRow {
    pub started_at_ms: i64,
    pub wpm: f64,
    pub accuracy: f64,
}

/// Mirrors the TS `TrendPoint`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint {
    pub date: String,
    pub wpm: f64,
    pub accuracy: f64,
}

/// One keystroke, reduced to just what the heatmap needs.
#[derive(Debug, Clone, PartialEq)]
pub struct SkillEvent {
    pub skill_id: String,
    pub correct: bool,
    pub latency_ms: Option<f64>,
}

/// Mirrors the TS `HeatCell`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatCell {
    pub key_id: String,
    pub layer: String,
    pub error_rate: f64,
    pub median_latency_ms: f64,
    pub samples: i64,
}

/// Epoch millis -> `YYYY-MM-DD` in the supplied offset. The offset is an
/// argument (not `Local::now()`) so this stays pure and machine-independent.
pub fn local_date(ts_ms: i64, offset: &FixedOffset) -> String {
    match offset.timestamp_millis_opt(ts_ms).single() {
        Some(dt) => dt.format("%Y-%m-%d").to_string(),
        None => "1970-01-01".to_string(),
    }
}

/// Mean WPM and accuracy per local calendar date, ascending by date.
/// Dates with no sessions are simply absent.
pub fn aggregate_trends(rows: &[SessionRow], offset: &FixedOffset) -> Vec<TrendPoint> {
    let mut buckets: BTreeMap<String, (f64, f64, usize)> = BTreeMap::new();
    for r in rows {
        let entry = buckets
            .entry(local_date(r.started_at_ms, offset))
            .or_insert((0.0, 0.0, 0));
        entry.0 += r.wpm;
        entry.1 += r.accuracy;
        entry.2 += 1;
    }
    buckets
        .into_iter()
        .map(|(date, (wpm_sum, acc_sum, n))| TrendPoint {
            date,
            wpm: wpm_sum / n as f64,
            accuracy: acc_sum / n as f64,
        })
        .collect()
}

/// One timestamped keystroke, reduced to just what the latency trend needs.
#[derive(Debug, Clone, PartialEq)]
pub struct TimedSkillEvent {
    pub ts_ms: i64,
    pub skill_id: String,
    pub latency_ms: Option<f64>,
}

/// Mirrors the TS `LatencyTrendPoint`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyTrendPoint {
    pub date: String,
    pub base_ms: Option<f64>,
    pub layer_ms: Option<f64>,
}

/// Per-local-day median keystroke latency, split base vs layer (lower/raise) skills.
pub fn aggregate_latency_trend(
    events: &[TimedSkillEvent],
    offset: &FixedOffset,
) -> Vec<LatencyTrendPoint> {
    let mut buckets: BTreeMap<String, (Vec<f64>, Vec<f64>)> = BTreeMap::new();
    for ev in events {
        let Some(lat) = ev.latency_ms else { continue };
        let Some((layer, _)) = split_skill_id(&ev.skill_id) else {
            continue;
        };
        let day = local_date(ev.ts_ms, offset);
        let entry = buckets.entry(day).or_default();
        if layer == "lower" || layer == "raise" {
            entry.1.push(lat);
        } else {
            entry.0.push(lat);
        }
    }
    buckets
        .into_iter()
        .map(|(date, (base, layer))| LatencyTrendPoint {
            date,
            base_ms: median(&base),
            layer_ms: median(&layer),
        })
        .collect()
}

/// `"lower:R11"` -> `("lower", "R11")`. `None` for anything without a colon.
pub fn split_skill_id(skill_id: &str) -> Option<(&str, &str)> {
    skill_id.split_once(':')
}

/// Per-key error rate and median latency for one layer, ascending by key id.
/// Events whose skill id is malformed or on another layer are ignored.
pub fn aggregate_heatmap(events: &[SkillEvent], layer: &str) -> Vec<HeatCell> {
    let mut buckets: BTreeMap<&str, (i64, i64, Vec<f64>)> = BTreeMap::new();
    for e in events {
        let Some((event_layer, key_id)) = split_skill_id(&e.skill_id) else {
            continue;
        };
        if event_layer != layer {
            continue;
        }
        let bucket = buckets.entry(key_id).or_insert((0, 0, Vec::new()));
        bucket.0 += 1;
        if !e.correct {
            bucket.1 += 1;
        }
        if let Some(ms) = e.latency_ms {
            bucket.2.push(ms);
        }
    }
    buckets
        .into_iter()
        .map(|(key_id, (samples, errors, latencies))| HeatCell {
            key_id: key_id.to_string(),
            layer: layer.to_string(),
            error_rate: if samples == 0 {
                0.0
            } else {
                errors as f64 / samples as f64
            },
            median_latency_ms: median(&latencies).unwrap_or(0.0),
            samples,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log(correct: bool, latency_ms: Option<f64>) -> KeystrokeLog {
        KeystrokeLog {
            ts: 0.0,
            expected: "{".to_string(),
            got: if correct { "{".to_string() } else { "[".to_string() },
            correct,
            latency_ms,
            skill_id: Some("lower:L35".to_string()),
        }
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    /// Canonical fixture — identical numbers to src/lib/adaptive/ewma.test.ts.
    /// Derived from: first sample seeds (error = correct ? 0 : 1, latency = latencyMs ?? 0);
    /// later samples blend `prev + alpha * (observed - prev)`.
    #[test]
    fn ewma_matches_the_shared_ts_fixture_table() {
        let inputs = [
            (false, Some(400.0)),
            (true, Some(300.0)),
            (true, Some(200.0)),
            (false, None),
        ];
        let expected = [
            (1.0, 400.0, 1_i64),
            (0.85, 390.0, 2),
            (0.7225, 371.0, 3),
            (0.764125, 371.0, 4),
        ];

        let mut acc: Option<SkillStat> = None;
        for (i, (correct, latency)) in inputs.iter().enumerate() {
            let next = update_skill(acc.as_ref(), &log(*correct, *latency));
            assert_eq!(next.skill_id, "lower:L35");
            assert_close(next.ewma_error, expected[i].0);
            assert_close(next.ewma_latency_ms, expected[i].1);
            assert_eq!(next.samples, expected[i].2);
            acc = Some(next);
        }
    }

    /// Extra coverage beyond the canonical table: a longer all-latency walk that
    /// exercises the correct-first seeding path and larger latency swings.
    #[test]
    fn ewma_further_cases() {
        let inputs = [
            (true, Some(200.0)),
            (false, Some(600.0)),
            (true, Some(400.0)),
            (true, Some(300.0)),
            (false, Some(1000.0)),
        ];
        let expected = [
            (0.0, 200.0, 1_i64),
            (0.15, 240.0, 2),
            (0.1275, 256.0, 3),
            (0.108375, 260.4, 4),
            (0.24211875, 334.36, 5),
        ];

        let mut acc: Option<SkillStat> = None;
        for (i, (correct, latency)) in inputs.iter().enumerate() {
            let next = update_skill(acc.as_ref(), &log(*correct, *latency));
            assert_eq!(next.skill_id, "lower:L35");
            assert_close(next.ewma_error, expected[i].0);
            assert_close(next.ewma_latency_ms, expected[i].1);
            assert_eq!(next.samples, expected[i].2);
            acc = Some(next);
        }
    }

    #[test]
    fn first_sample_of_an_incorrect_keystroke_seeds_error_one() {
        let s = update_skill(None, &log(false, None));
        assert_close(s.ewma_error, 1.0);
        assert_close(s.ewma_latency_ms, 0.0);
        assert_eq!(s.samples, 1);
    }

    #[test]
    fn a_null_latency_leaves_the_latency_ewma_untouched_but_counts_a_sample() {
        let first = update_skill(None, &log(true, Some(500.0)));
        let second = update_skill(Some(&first), &log(true, None));
        assert_close(second.ewma_latency_ms, 500.0);
        assert_eq!(second.samples, 2);
    }

    #[test]
    fn median_handles_odd_even_and_empty() {
        assert_eq!(median(&[]), None);
        assert_eq!(median(&[7.0]), Some(7.0));
        assert_eq!(median(&[300.0, 100.0, 200.0]), Some(200.0));
        assert_eq!(median(&[400.0, 100.0, 300.0, 200.0]), Some(250.0));
    }

    fn pdt() -> chrono::FixedOffset {
        chrono::FixedOffset::west_opt(7 * 3600).expect("valid offset")
    }

    fn at(iso: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(iso)
            .expect("valid RFC3339")
            .timestamp_millis()
    }

    #[test]
    fn trends_group_sessions_by_local_calendar_date() {
        let rows = vec![
            SessionRow { started_at_ms: at("2026-08-17T09:00:00-07:00"), wpm: 40.0, accuracy: 0.90 },
            SessionRow { started_at_ms: at("2026-08-17T21:00:00-07:00"), wpm: 50.0, accuracy: 0.98 },
            SessionRow { started_at_ms: at("2026-08-18T08:00:00-07:00"), wpm: 60.0, accuracy: 0.94 },
        ];
        let out = aggregate_trends(&rows, &pdt());
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].date, "2026-08-17");
        assert_close(out[0].wpm, 45.0);
        assert_close(out[0].accuracy, 0.94);
        assert_eq!(out[1].date, "2026-08-18");
        assert_close(out[1].wpm, 60.0);
    }

    #[test]
    fn trends_use_the_supplied_offset_not_utc() {
        // 04:00 UTC on the 18th is still the 17th at UTC-07:00.
        let rows = vec![SessionRow {
            started_at_ms: at("2026-08-18T04:00:00+00:00"),
            wpm: 30.0,
            accuracy: 1.0,
        }];
        let out = aggregate_trends(&rows, &pdt());
        assert_eq!(out[0].date, "2026-08-17");
    }

    #[test]
    fn heatmap_computes_error_rate_and_median_latency_per_key() {
        let events = vec![
            SkillEvent { skill_id: "lower:L35".into(), correct: true, latency_ms: Some(300.0) },
            SkillEvent { skill_id: "lower:L35".into(), correct: false, latency_ms: Some(900.0) },
            SkillEvent { skill_id: "lower:L35".into(), correct: true, latency_ms: Some(500.0) },
            SkillEvent { skill_id: "lower:L35".into(), correct: true, latency_ms: None },
            SkillEvent { skill_id: "lower:R11".into(), correct: false, latency_ms: Some(700.0) },
            SkillEvent { skill_id: "base:L11".into(), correct: true, latency_ms: Some(120.0) },
        ];
        let cells = aggregate_heatmap(&events, "lower");
        assert_eq!(cells.len(), 2);

        let l35 = cells.iter().find(|c| c.key_id == "L35").expect("L35 present");
        assert_eq!(l35.layer, "lower");
        assert_eq!(l35.samples, 4);
        assert_close(l35.error_rate, 0.25);
        assert_close(l35.median_latency_ms, 500.0);

        let r11 = cells.iter().find(|c| c.key_id == "R11").expect("R11 present");
        assert_close(r11.error_rate, 1.0);
        assert_close(r11.median_latency_ms, 700.0);
    }

    #[test]
    fn heatmap_ignores_malformed_skill_ids() {
        let events = vec![
            SkillEvent { skill_id: "garbage".into(), correct: false, latency_ms: Some(100.0) },
            SkillEvent { skill_id: "lower:L35".into(), correct: true, latency_ms: Some(100.0) },
        ];
        let cells = aggregate_heatmap(&events, "lower");
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].key_id, "L35");
    }

    #[test]
    fn latency_trend_splits_and_medians_by_day() {
        let off = chrono::FixedOffset::east_opt(0).unwrap();
        let day1 = 1_787_000_000_000i64; // any fixed epoch ms
        let ev = |ts: i64, skill: &str, lat: f64| TimedSkillEvent {
            ts_ms: ts,
            skill_id: skill.into(),
            latency_ms: Some(lat),
        };
        let events = vec![
            ev(day1, "base:L11", 100.0),
            ev(day1, "base:L12", 200.0),
            ev(day1, "lower:L35", 500.0),
            ev(day1 + 86_400_000, "raise:R00", 450.0),
        ];
        let out = aggregate_latency_trend(&events, &off);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].base_ms, Some(150.0));
        assert_eq!(out[0].layer_ms, Some(500.0));
        assert_eq!(out[1].base_ms, None);
        assert_eq!(out[1].layer_ms, Some(450.0));
    }

    #[test]
    fn latency_trend_skips_events_without_a_latency_or_a_layer() {
        let off = chrono::FixedOffset::east_opt(0).unwrap();
        let events = vec![
            TimedSkillEvent { ts_ms: 0, skill_id: "base:L11".into(), latency_ms: None },
            TimedSkillEvent { ts_ms: 0, skill_id: "garbage".into(), latency_ms: Some(999.0) },
            TimedSkillEvent { ts_ms: 0, skill_id: "base:L11".into(), latency_ms: Some(120.0) },
        ];
        let out = aggregate_latency_trend(&events, &off);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].base_ms, Some(120.0));
        assert_eq!(out[0].layer_ms, None);
    }

    #[test]
    fn split_skill_id_splits_layer_from_key() {
        assert_eq!(split_skill_id("lower:R11"), Some(("lower", "R11")));
        assert_eq!(split_skill_id("nope"), None);
    }
}
