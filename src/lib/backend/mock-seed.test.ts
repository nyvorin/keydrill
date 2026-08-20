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
