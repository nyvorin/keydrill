import type { SkillStat } from "../adaptive/ewma";
import { updateSkill } from "../adaptive/ewma";
import type { LangId } from "../curriculum/stages";
import type { DrillSummary } from "../engine/metrics";
import type { KeystrokeLog } from "../engine/typing-reducer";
import type { LayerId } from "../layout/types";
import type { Backend, DayState, HeatCell, SessionMeta, SessionMode, TrendPoint } from "./api";
import { SESSION_COUNT_KEY } from "./api";

export const MOCK_STORAGE_KEY = "keydrill.mock.v1";

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

/** Browser-only Backend: aggregates in memory, mirrored into localStorage. */
export class MockBackend implements Backend {
  private readonly now: () => Date;
  private readonly storage: MockStorage | null;
  private state: MockState;

  constructor(opts: MockOptions = {}) {
    this.now = opts.now ?? ((): Date => new Date());
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.state = this.load();
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

  async getTrends(days: number): Promise<TrendPoint[]> {
    const byDate = new Map<string, { wpm: number; accuracy: number; n: number }>();
    for (const s of this.state.sessions) {
      if (!s.completed) continue;
      const acc = byDate.get(s.date) ?? { wpm: 0, accuracy: 0, n: 0 };
      acc.wpm += s.wpm;
      acc.accuracy += s.accuracy;
      acc.n += 1;
      byDate.set(s.date, acc);
    }
    const points = [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, a]) => ({ date, wpm: a.wpm / a.n, accuracy: a.accuracy / a.n }));
    return points.slice(Math.max(0, points.length - days));
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
      };
    } catch {
      return emptyState();
    }
  }

  private persist(): void {
    this.storage?.setItem(MOCK_STORAGE_KEY, JSON.stringify(this.state));
  }
}
