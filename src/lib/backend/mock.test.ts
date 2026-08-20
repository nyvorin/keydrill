import { describe, expect, it } from "vite-plus/test";
import type { DrillSummary } from "../engine/metrics";
import type { KeystrokeLog } from "../engine/typing-reducer";
import { SESSION_COUNT_KEY } from "./api";
import { MockBackend, MOCK_STORAGE_KEY, type MockStorage } from "./mock";

function memStorage(): MockStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key: string): string | null {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
  };
}

const SUMMARY: DrillSummary = {
  wpm: 42,
  accuracy: 0.97,
  durationMs: 60_000,
  keystrokes: 210,
  errors: 6,
  layerLatencyMs: 380,
  baseLatencyMs: 190,
};

function ks(skillId: string | null, correct: boolean, latencyMs: number | null): KeystrokeLog {
  return { ts: 0, expected: "{", got: correct ? "{" : "[", correct, latencyMs, skillId };
}

describe("MockBackend", () => {
  it("folds ingested keystrokes into per-skill EWMA stats and ignores skill-less logs", async () => {
    const backend = new MockBackend({ storage: null });
    const session = await backend.startSession("drill", null);
    await backend.ingestKeystrokes(session.id, [
      ks("lower:L35", true, null),
      ks("lower:L35", false, 500),
      ks(null, true, 400),
    ]);
    const stats = await backend.getSkillStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]?.skillId).toBe("lower:L35");
    expect(stats[0]?.samples).toBe(2);
    expect(stats[0]?.ewmaError).toBeCloseTo(0.15, 6);
    expect(stats[0]?.ewmaLatencyMs).toBeCloseTo(50, 6);
  });

  it("counts ended sessions under SESSION_COUNT_KEY", async () => {
    const backend = new MockBackend({ storage: null });
    expect(await backend.getSetting(SESSION_COUNT_KEY)).toBeNull();
    const a = await backend.startSession("drill", null);
    await backend.endSession(a.id, SUMMARY, false);
    const b = await backend.startSession("code", "rust");
    await backend.endSession(b.id, SUMMARY, false);
    expect(await backend.getSetting(SESSION_COUNT_KEY)).toBe("2");
  });

  it("tracks streaks across days", async () => {
    let today = new Date("2026-03-01T09:00:00");
    const backend = new MockBackend({ storage: null, now: () => today });

    const day1 = await backend.startSession("session", null);
    await backend.endSession(day1.id, SUMMARY, true);
    expect(await backend.getDayState()).toEqual({
      date: "2026-03-01",
      sessionCompleted: true,
      streak: 1,
    });

    today = new Date("2026-03-02T09:00:00");
    const day2 = await backend.startSession("session", null);
    await backend.endSession(day2.id, SUMMARY, true);
    expect((await backend.getDayState()).streak).toBe(2);

    // 2026-03-03 is skipped entirely.
    today = new Date("2026-03-04T09:00:00");
    expect(await backend.getDayState()).toEqual({
      date: "2026-03-04",
      sessionCompleted: false,
      streak: 0,
    });
    const day4 = await backend.startSession("session", null);
    await backend.endSession(day4.id, SUMMARY, true);
    expect((await backend.getDayState()).streak).toBe(1);
  });

  it("is idempotent for a second completion on the same day", async () => {
    const now = () => new Date("2026-03-01T09:00:00");
    const backend = new MockBackend({ storage: null, now });
    const a = await backend.startSession("session", null);
    await backend.endSession(a.id, SUMMARY, true);
    const b = await backend.startSession("session", null);
    await backend.endSession(b.id, SUMMARY, true);
    expect((await backend.getDayState()).streak).toBe(1);
  });

  it("persists skills, days, sessions and settings across instances", async () => {
    const storage = memStorage();
    const now = () => new Date("2026-03-01T09:00:00");
    const first = new MockBackend({ storage, now });
    const session = await first.startSession("drill", null);
    await first.ingestKeystrokes(session.id, [ks("lower:L35", false, 300)]);
    await first.endSession(session.id, SUMMARY, true);
    await first.setSetting("session.lang", "rust");
    expect(storage.data.has(MOCK_STORAGE_KEY)).toBe(true);

    const second = new MockBackend({ storage, now });
    expect(await second.getSetting(SESSION_COUNT_KEY)).toBe("1");
    expect(await second.getSetting("session.lang")).toBe("rust");
    expect((await second.getDayState()).streak).toBe(1);
    expect(await second.getSkillStats()).toHaveLength(1);
    const trends = await second.getTrends(30);
    expect(trends).toEqual([{ date: "2026-03-01", wpm: 42, accuracy: 0.97 }]);
  });

  it("returns heat cells only for the requested layer", async () => {
    const backend = new MockBackend({ storage: null });
    const session = await backend.startSession("drill", null);
    await backend.ingestKeystrokes(session.id, [
      ks("lower:L35", false, 500),
      ks("base:L11", true, 120),
    ]);
    const lower = await backend.getHeatmap("lower");
    expect(lower).toEqual([
      { keyId: "L35", layer: "lower", errorRate: 1, medianLatencyMs: 500, samples: 1 },
    ]);
    const base = await backend.getHeatmap("base");
    expect(base.map((c) => c.keyId)).toEqual(["L11"]);
  });
});
