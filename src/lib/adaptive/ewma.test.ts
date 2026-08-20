import { describe, expect, it } from "vite-plus/test";
import type { KeystrokeLog } from "../engine/typing-reducer";
import { ALPHA_ERROR, ALPHA_LATENCY, updateSkill, type SkillStat } from "./ewma";

function log(correct: boolean, latencyMs: number | null): KeystrokeLog {
  return {
    ts: 0,
    expected: "{",
    got: correct ? "{" : "[",
    correct,
    latencyMs,
    skillId: "lower:L35",
  };
}

// Canonical fixture: fed in order to updateSkill, starting from prev = null.
// Rust (Task 15) must reproduce these values exactly.
const FIXTURE: Array<{
  correct: boolean;
  latencyMs: number | null;
  ewmaError: number;
  ewmaLatencyMs: number;
  samples: number;
}> = [
  { correct: false, latencyMs: 400, ewmaError: 1, ewmaLatencyMs: 400, samples: 1 },
  { correct: true, latencyMs: 300, ewmaError: 0.85, ewmaLatencyMs: 390, samples: 2 },
  { correct: true, latencyMs: 200, ewmaError: 0.7225, ewmaLatencyMs: 371, samples: 3 },
  { correct: false, latencyMs: null, ewmaError: 0.764125, ewmaLatencyMs: 371, samples: 4 },
];

describe("updateSkill", () => {
  it("uses the agreed alphas", () => {
    expect(ALPHA_ERROR).toBe(0.15);
    expect(ALPHA_LATENCY).toBe(0.1);
  });

  it("seeds from the first sample", () => {
    const s = updateSkill(null, log(true, null));
    expect(s).toEqual({ skillId: "lower:L35", ewmaError: 0, ewmaLatencyMs: 0, samples: 1 });
  });

  it("walks the canonical fixture table", () => {
    let stat: SkillStat | null = null;
    for (const row of FIXTURE) {
      stat = updateSkill(stat, log(row.correct, row.latencyMs));
      expect(stat.samples).toBe(row.samples);
      expect(stat.ewmaError).toBeCloseTo(row.ewmaError, 6);
      expect(stat.ewmaLatencyMs).toBeCloseTo(row.ewmaLatencyMs, 6);
    }
  });

  it("keeps the previous latency when a sample has no latency", () => {
    const first = updateSkill(null, log(true, 250));
    const second = updateSkill(first, log(true, null));
    expect(second.ewmaLatencyMs).toBe(first.ewmaLatencyMs);
    expect(second.samples).toBe(2);
  });

  it("keeps the existing skillId even if the log has none", () => {
    const first = updateSkill(null, log(true, 250));
    const second = updateSkill(first, { ...log(true, 250), skillId: null });
    expect(second.skillId).toBe("lower:L35");
  });
});
