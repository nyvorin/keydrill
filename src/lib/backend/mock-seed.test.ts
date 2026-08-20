import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { HeatCell } from "./api";
import { SESSION_COUNT_KEY } from "./api";
import { MockBackend } from "./mock";

function avgError(cells: HeatCell[]): number {
  return cells.reduce((sum, c) => sum + c.errorRate, 0) / cells.length;
}

describe("MockBackend.seed", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("produces one trend point per seeded day, oldest first, improving over time", async () => {
    const backend = new MockBackend();
    backend.seed(14);
    const trends = await backend.getTrends(30);
    expect(trends).toHaveLength(14);
    expect(trends[0].date < trends[13].date).toBe(true);
    expect(trends[13].wpm).toBeGreaterThan(trends[0].wpm);
    expect(trends[13].accuracy).toBeGreaterThan(trends[0].accuracy);
    expect(trends.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date))).toBe(true);
  });

  it("seeds heat cells per layer, with layer chords erroring more than base", async () => {
    const backend = new MockBackend();
    backend.seed(14);
    const base = await backend.getHeatmap("base");
    const lower = await backend.getHeatmap("lower");
    expect(base.length).toBeGreaterThan(0);
    expect(lower.length).toBeGreaterThan(0);
    expect(base.every((c) => c.layer === "base" && c.samples > 0)).toBe(true);
    expect(avgError(lower)).toBeGreaterThan(avgError(base));
  });

  it("sets the streak and the sessions count", async () => {
    const backend = new MockBackend();
    backend.seed(7);
    const day = await backend.getDayState();
    expect(day.sessionCompleted).toBe(true);
    expect(day.streak).toBe(7);
    // Two sessions per seeded day (one drill, one code).
    expect(await backend.getSetting(SESSION_COUNT_KEY)).toBe("14");
  });
});

/** Pinned clock + `storage: null` keep these cases off localStorage and off the wall clock. */
function seeded(days: number): MockBackend {
  const b = new MockBackend({ storage: null, now: () => new Date("2026-03-15T12:00:00") });
  b.seed(days);
  return b;
}

describe("seeded backend — dashboard completion", () => {
  it("getRecentDays returns the seeded days newest-first with completion flags", async () => {
    const b = seeded(14);
    const days = await b.getRecentDays(14);
    expect(days.length).toBe(14);
    expect(days[0].date > days[13].date).toBe(true);
    expect(days.filter((d) => d.sessionCompleted).length).toBeGreaterThanOrEqual(10);
  });

  it("getTrends filters by mode", async () => {
    const b = seeded(14);
    const all = await b.getTrends(30);
    const code = await b.getTrends(30, "code");
    expect(code.length).toBeGreaterThan(0);
    expect(code.length).toBeLessThan(all.length + 1);
    const allByDate = new Map(all.map((t) => [t.date, t.wpm]));
    const differs = code.some((t) => allByDate.get(t.date) !== t.wpm);
    expect(differs).toBe(true); // code sessions are seeded slower than drills
  });

  it("getLatencyTrend returns per-day base/layer medians with layer slower", async () => {
    const b = seeded(14);
    const pts = await b.getLatencyTrend(30);
    expect(pts.length).toBeGreaterThanOrEqual(7);
    for (const p of pts) {
      if (p.baseMs !== null && p.layerMs !== null) expect(p.layerMs).toBeGreaterThan(p.baseMs);
    }
  });
});
