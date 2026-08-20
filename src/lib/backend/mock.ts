import type { SkillStat } from "../adaptive/ewma";
import { updateSkill } from "../adaptive/ewma";
import type { LangId } from "../curriculum/stages";
import type { DrillSummary } from "../engine/metrics";
import type { KeystrokeLog } from "../engine/typing-reducer";
import type { LayerId } from "../layout/types";
import type {
  Backend,
  DayState,
  HeatCell,
  LatencyTrendPoint,
  SessionMeta,
  SessionMode,
  TrendPoint,
} from "./api";
import { SESSION_COUNT_KEY } from "./api";

export const MOCK_STORAGE_KEY = "keydrill.mock.v1";

declare global {
  interface Window {
    __keydrillSeed?: (days: number) => void;
  }
}

/** Key ids used by the dev seeder. All exist in layout.json. */
const SEED_BASE_KEYS = [
  "L11",
  "L12",
  "L13",
  "L14",
  "L15",
  "L21",
  "L22",
  "L23",
  "L24",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R20",
  "R21",
  "R22",
  "R23",
  "RT4",
];
const SEED_LOWER_KEYS = [
  "L25",
  "L35",
  "LT3",
  "R11",
  "R12",
  "R13",
  "R14",
  "R20",
  "R24",
  "R25",
  "R30",
  "RT4",
];
const SEED_RAISE_KEYS = ["L00", "L01", "L02", "L03", "R00", "R01", "R20"];

/** Local midnight, in ms, for a 'YYYY-MM-DD' key produced by dateKey(). */
function dayStartMs(key: string): number {
  const parts = key.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
}

/** Stable per-skill noise in [0,1) so seeded data looks varied but is deterministic. */
function seedNoise(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export interface MockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MockOptions {
  now?: () => Date;
  storage?: MockStorage | null;
}

interface StoredSession {
  id: string;
  mode: SessionMode;
  language: LangId | null;
  startedAt: number;
  endedAt: number | null;
  date: string;
  wpm: number;
  accuracy: number;
  completed: boolean;
}

interface MockState {
  version: 1;
  skills: SkillStat[];
  days: DayState[];
  sessions: StoredSession[];
  settings: Record<string, string>;
  /** Raw per-day keystroke latencies, split base vs layer — feeds getLatencyTrend(). */
  latencyDaily?: Record<string, { base: number[]; layer: number[] }>;
}

function emptyState(): MockState {
  return { version: 1, skills: [], days: [], sessions: [], settings: {} };
}

function defaultStorage(): MockStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDate(key: string, deltaDays: number): string {
  const parts = key.split("-");
  return dateKey(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + deltaDays));
}

/** Median of a sample set. `src/lib/engine/metrics.ts` keeps its own private, so this is the copy. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Browser-only Backend: aggregates in memory, mirrored into localStorage. */
export class MockBackend implements Backend {
  private readonly now: () => Date;
  private readonly storage: MockStorage | null;
  private state: MockState;

  constructor(opts: MockOptions = {}) {
    this.now = opts.now ?? ((): Date => new Date());
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.state = this.load();
    if (typeof window !== "undefined" && import.meta.env.DEV) {
      window.__keydrillSeed = (days: number): void => this.seed(days);
    }
  }

  /** Find-or-replace a session row by id, so seeding twice never duplicates rows. */
  private putSession(row: StoredSession): void {
    const i = this.state.sessions.findIndex((s) => s.id === row.id);
    if (i >= 0) this.state.sessions[i] = row;
    else this.state.sessions.push(row);
  }

  /** Find-or-replace a skill row by skillId. */
  private putSkill(stat: SkillStat): void {
    const i = this.state.skills.findIndex((s) => s.skillId === stat.skillId);
    if (i >= 0) this.state.skills[i] = stat;
    else this.state.skills.push(stat);
  }

  /** Dev-only: inject `days` days of plausible history so the stats dashboard has something to draw. */
  seed(days: number): void {
    const today = dateKey(this.now());

    for (let i = days - 1; i >= 0; i--) {
      const date = shiftDate(today, -i);
      const progress = days > 1 ? (days - 1 - i) / (days - 1) : 1;
      const startedAt = dayStartMs(date) + 10 * 3_600_000;
      const wpm = 22 + progress * 18 + (i % 3) * 0.9;
      // Code copy trails free drilling AND has its own rhythm — a plain constant
      // offset would normalize to the exact same trend line, making the mode
      // toggle invisible on the chart.
      const codeWpm = wpm - 8 + (i % 2) * 2.5;
      const accuracy = 0.9 + progress * 0.07;

      // Synthetic keystroke latencies: base fast, layer chords slow, both improving.
      const bucket = ((this.state.latencyDaily ??= {})[date] ??= { base: [], layer: [] });
      bucket.base = [180 + i * 2, 200 + i * 2, 190 + i * 2];
      bucket.layer = [420 + i * 6, 460 + i * 6, 440 + i * 6];

      this.putSession({
        id: `seed-${date}-drill`,
        mode: "drill",
        language: null,
        startedAt,
        endedAt: startedAt + 9 * 60_000,
        date,
        wpm,
        accuracy,
        completed: true,
      });
      this.putSession({
        id: `seed-${date}-code`,
        mode: "code",
        language: "ts",
        startedAt: startedAt + 20 * 60_000,
        endedAt: startedAt + 29 * 60_000,
        date,
        wpm: codeWpm,
        accuracy,
        completed: true,
      });

      // The same streak logic real completions walk — consecutive seeded days go 1, 2, 3, …
      this.completeDay(date);
    }

    const seedSkills = (
      layer: LayerId,
      keys: string[],
      errBase: number,
      errSpread: number,
      latBase: number,
      latSpread: number,
      sampleBase: number,
    ): void => {
      for (const keyId of keys) {
        const skillId = `${layer}:${keyId}`;
        const noise = seedNoise(skillId);
        this.putSkill({
          skillId,
          ewmaError: errBase + noise * errSpread,
          ewmaLatencyMs: latBase + noise * latSpread,
          samples: sampleBase + Math.floor(noise * 40),
        });
      }
    };
    seedSkills("base", SEED_BASE_KEYS, 0.02, 0.06, 160, 120, 40);
    seedSkills("lower", SEED_LOWER_KEYS, 0.09, 0.18, 380, 260, 25);
    seedSkills("raise", SEED_RAISE_KEYS, 0.11, 0.2, 420, 280, 18);

    // The one and only sessions counter — same settings key endSession increments.
    this.state.settings[SESSION_COUNT_KEY] = String(
      this.state.sessions.filter((s) => s.completed).length,
    );
    this.persist();
  }

  async startSession(mode: SessionMode, language: LangId | null): Promise<SessionMeta> {
    const at = this.now();
    const meta: SessionMeta = { id: newId(), mode, language, startedAt: at.getTime() };
    this.state.sessions.push({
      id: meta.id,
      mode,
      language,
      startedAt: meta.startedAt,
      endedAt: null,
      date: dateKey(at),
      wpm: 0,
      accuracy: 0,
      completed: false,
    });
    this.persist();
    return meta;
  }

  async ingestKeystrokes(sessionId: string, logs: KeystrokeLog[]): Promise<void> {
    void sessionId; // the mock keeps aggregates only; raw events belong to the Tauri store
    for (const log of logs) {
      if (log.skillId === null) continue;
      const prev = this.state.skills.find((s) => s.skillId === log.skillId) ?? null;
      const next = updateSkill(prev, log);
      if (prev === null) this.state.skills.push(next);
      else this.state.skills[this.state.skills.indexOf(prev)] = next;
    }

    // Latency history, keyed by the same day key the session rows use.
    const date = dateKey(this.now());
    const daily = (this.state.latencyDaily ??= {});
    const bucket = (daily[date] ??= { base: [], layer: [] });
    for (const log of logs) {
      if (log.latencyMs === null || log.skillId === null) continue;
      if (log.skillId.startsWith("lower:") || log.skillId.startsWith("raise:")) {
        bucket.layer.push(log.latencyMs);
      } else {
        bucket.base.push(log.latencyMs);
      }
    }
    this.persist();
  }

  async endSession(
    sessionId: string,
    summary: DrillSummary,
    completedDailySession: boolean,
  ): Promise<void> {
    const at = this.now();
    const record = this.state.sessions.find((s) => s.id === sessionId);
    if (record) {
      record.endedAt = at.getTime();
      record.date = dateKey(at);
      record.wpm = summary.wpm;
      record.accuracy = summary.accuracy;
      record.completed = true;
    }
    const count = Number(this.state.settings[SESSION_COUNT_KEY] ?? "0") + 1;
    this.state.settings[SESSION_COUNT_KEY] = String(count);
    if (completedDailySession) this.completeDay(dateKey(at));
    this.persist();
  }

  async getSkillStats(): Promise<SkillStat[]> {
    return this.state.skills.map((s) => ({ ...s }));
  }

  async getTrends(days: number, mode?: SessionMode): Promise<TrendPoint[]> {
    const cutoff = shiftDate(dateKey(this.now()), -(days - 1));
    const byDate = new Map<string, { wpm: number; accuracy: number; n: number }>();
    for (const s of this.state.sessions) {
      if (mode !== undefined && s.mode !== mode) continue;
      if (!s.completed || s.date < cutoff) continue;
      const agg = byDate.get(s.date) ?? { wpm: 0, accuracy: 0, n: 0 };
      agg.wpm += s.wpm;
      agg.accuracy += s.accuracy;
      agg.n += 1;
      byDate.set(s.date, agg);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([date, agg]) => ({ date, wpm: agg.wpm / agg.n, accuracy: agg.accuracy / agg.n }));
  }

  async getHeatmap(layer: LayerId): Promise<HeatCell[]> {
    const prefix = `${layer}:`;
    return this.state.skills
      .filter((s) => s.skillId.startsWith(prefix))
      .map((s) => ({
        keyId: s.skillId.slice(prefix.length),
        layer,
        errorRate: s.ewmaError,
        medianLatencyMs: s.ewmaLatencyMs,
        samples: s.samples,
      }));
  }

  async getDayState(): Promise<DayState> {
    const date = dateKey(this.now());
    const today = this.state.days.find((d) => d.date === date);
    if (today) return { ...today };
    const yesterday = this.state.days.find((d) => d.date === shiftDate(date, -1));
    return {
      date,
      sessionCompleted: false,
      streak: yesterday?.sessionCompleted ? yesterday.streak : 0,
    };
  }

  /** The newest `limit` day rows, newest-first — what the calendar renders. */
  async getRecentDays(limit: number): Promise<DayState[]> {
    return [...this.state.days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }

  /** Per-day median keystroke latency, base vs layer, ascending, most recent `days`. */
  async getLatencyTrend(days: number): Promise<LatencyTrendPoint[]> {
    const daily = this.state.latencyDaily ?? {};
    return Object.keys(daily)
      .sort()
      .slice(-days)
      .map((date) => ({
        date,
        baseMs: median(daily[date].base),
        layerMs: median(daily[date].layer),
      }));
  }

  async getSetting(key: string): Promise<string | null> {
    return this.state.settings[key] ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.state.settings[key] = value;
    this.persist();
  }

  private completeDay(date: string): void {
    const existing = this.state.days.find((d) => d.date === date);
    if (existing?.sessionCompleted) return;
    const yesterday = this.state.days.find((d) => d.date === shiftDate(date, -1));
    const streak = (yesterday?.sessionCompleted ? yesterday.streak : 0) + 1;
    if (existing) {
      existing.sessionCompleted = true;
      existing.streak = streak;
    } else {
      this.state.days.push({ date, sessionCompleted: true, streak });
    }
  }

  private load(): MockState {
    const raw = this.storage?.getItem(MOCK_STORAGE_KEY) ?? null;
    if (raw === null) return emptyState();
    try {
      const parsed = JSON.parse(raw) as Partial<MockState>;
      return {
        version: 1,
        skills: parsed.skills ?? [],
        days: parsed.days ?? [],
        sessions: parsed.sessions ?? [],
        settings: parsed.settings ?? {},
        latencyDaily: parsed.latencyDaily ?? {},
      };
    } catch {
      return emptyState();
    }
  }

  private persist(): void {
    this.storage?.setItem(MOCK_STORAGE_KEY, JSON.stringify(this.state));
  }
}
