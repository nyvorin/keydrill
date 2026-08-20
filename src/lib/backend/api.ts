import type { SkillStat } from "../adaptive/ewma";
import type { LangId } from "../curriculum/stages";
import type { DrillSummary } from "../engine/metrics";
import type { KeystrokeLog } from "../engine/typing-reducer";
import type { LayerId } from "../layout/types";

export type SessionMode = "drill" | "code" | "session" | "wizard";

export interface SessionMeta {
  id: string;
  mode: SessionMode;
  language: LangId | null;
  startedAt: number;
}

export interface TrendPoint {
  date: string;
  wpm: number;
  accuracy: number;
}

export interface HeatCell {
  keyId: string;
  layer: LayerId;
  errorRate: number;
  medianLatencyMs: number;
  samples: number;
}

export interface DayState {
  date: string;
  sessionCompleted: boolean;
  streak: number;
}

/** Per-local-day median keystroke latency, split base vs layer (lower/raise) chords. */
export interface LatencyTrendPoint {
  date: string;
  baseMs: number | null;
  layerMs: number | null;
}

export interface Backend {
  startSession(mode: SessionMode, language: LangId | null): Promise<SessionMeta>;
  ingestKeystrokes(sessionId: string, logs: KeystrokeLog[]): Promise<void>;
  endSession(
    sessionId: string,
    summary: DrillSummary,
    completedDailySession: boolean,
  ): Promise<void>;
  getSkillStats(): Promise<SkillStat[]>;
  getTrends(days: number, mode?: SessionMode): Promise<TrendPoint[]>;
  getHeatmap(layer: LayerId): Promise<HeatCell[]>;
  getDayState(): Promise<DayState>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getRecentDays(limit: number): Promise<DayState[]>;
  getLatencyTrend(days: number): Promise<LatencyTrendPoint[]>;
}

/**
 * The Backend interface has no session-count method, so the count travels through
 * settings. EVERY Backend implementation increments this key inside endSession.
 */
export const SESSION_COUNT_KEY = "stats.sessionCount";
