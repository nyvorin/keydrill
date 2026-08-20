import { invoke } from "@tauri-apps/api/core";
import type { SkillStat } from "../adaptive/ewma";
import type { LangId } from "../curriculum/stages";
import type { DrillSummary } from "../engine/metrics";
import type { KeystrokeLog } from "../engine/typing-reducer";
import type { LayerId } from "../layout/types";
import type { Backend, DayState, HeatCell, SessionMeta, SessionMode, TrendPoint } from "./api";

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Backend over Tauri IPC. The Rust DTOs serialize camelCase, so responses are
 * structurally identical to the TS interfaces — no mapping needed.
 * Factory form so tests can inject a fake invoke.
 *
 * `endSession` is a bare forwarder: the Rust store owns the SESSION_COUNT_KEY
 * increment (`Store::end_session`), so incrementing here too would double-count.
 */
export function createTauriBackend(invokeFn: InvokeFn): Backend {
  return {
    startSession(mode: SessionMode, language: LangId | null): Promise<SessionMeta> {
      return invokeFn<SessionMeta>("start_session", { mode, language });
    },
    ingestKeystrokes(sessionId: string, logs: KeystrokeLog[]): Promise<void> {
      return invokeFn<void>("ingest_keystrokes", { sessionId, logs });
    },
    endSession(
      sessionId: string,
      summary: DrillSummary,
      completedDailySession: boolean,
    ): Promise<void> {
      return invokeFn<void>("end_session", { sessionId, summary, completedDailySession });
    },
    getSkillStats(): Promise<SkillStat[]> {
      return invokeFn<SkillStat[]>("get_skill_stats");
    },
    getTrends(days: number): Promise<TrendPoint[]> {
      return invokeFn<TrendPoint[]>("get_trends", { days });
    },
    getHeatmap(layer: LayerId): Promise<HeatCell[]> {
      return invokeFn<HeatCell[]>("get_heatmap", { layer });
    },
    getDayState(): Promise<DayState> {
      return invokeFn<DayState>("get_day_state");
    },
    getSetting(key: string): Promise<string | null> {
      return invokeFn<string | null>("get_setting", { key });
    },
    setSetting(key: string, value: string): Promise<void> {
      return invokeFn<void>("set_setting", { key, value });
    },
  };
}

/** Production TauriBackend bound to the real IPC bridge. */
export function tauriBackend(): Backend {
  return createTauriBackend(invoke as InvokeFn);
}
