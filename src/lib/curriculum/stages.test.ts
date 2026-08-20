import { describe, expect, it } from "vite-plus/test";
import type { SkillStat } from "../adaptive/ewma";
import { LAYOUT } from "../layout/layout-data";
import { GATE_ACCURACY, GATE_LATENCY_MS, STAGES, stageGate, stageSkills } from "./stages";

function passing(ids: string[], overrides: Partial<SkillStat> = {}): SkillStat[] {
  return ids.map((skillId) => ({
    skillId,
    ewmaError: 0.02,
    ewmaLatencyMs: 300,
    samples: 40,
    ...overrides,
  }));
}

describe("STAGES", () => {
  it("declares the seven curriculum stages in order", () => {
    expect(STAGES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(STAGES.map((s) => s.slug)).toEqual([
      "base-letters",
      "base-shifted",
      "lower-symbols",
      "lower-numpad",
      "navigation",
      "idioms",
      "code-copy",
    ]);
    expect(STAGES.every((s) => s.title.length > 0)).toBe(true);
  });
});

describe("stageSkills", () => {
  it("stage 1 covers base letters, base punctuation, space and Enter — but not digits", () => {
    const s = stageSkills(1, LAYOUT);
    expect(s).toContain("base:L11"); // q
    expect(s).toContain("base:R32"); // ,
    expect(s).toContain("base:RT4"); // space
    expect(s).toContain("base:LT4"); // Enter
    expect(s).not.toContain("base:L01"); // digit 1 belongs to stage 2
  });

  it("stage 2 covers shifted base symbols but not capitals", () => {
    const s = stageSkills(2, LAYOUT);
    expect(s).toContain("base:L01"); // 1 / !
    expect(s).toContain("base:R04"); // 0 / )
    expect(s).not.toContain("base:L11"); // q / Q — capitals share the base letter skill
  });

  it("stage 3 covers Lower printable symbols but not the numpad", () => {
    const s = stageSkills(3, LAYOUT);
    expect(s).toContain("lower:L35"); // {
    expect(s).toContain("lower:R30"); // }
    expect(s).toContain("lower:R24"); // +
    expect(s).not.toContain("lower:R11"); // P7 is stage 4
    expect(s).not.toContain("lower:L21"); // ArrowLeft is stage 5
  });

  it("stage 4 covers the Lower numpad", () => {
    const s = stageSkills(4, LAYOUT);
    expect(s).toContain("lower:R11"); // P7
    expect(s).toContain("lower:R14"); // P0
    expect(s).not.toContain("lower:L35");
  });

  it("stage 5 covers named navigation keys on any layer", () => {
    const s = stageSkills(5, LAYOUT);
    expect(s).toContain("lower:L21"); // ArrowLeft
    expect(s).toContain("base:LT3"); // Home
    expect(s).toContain("base:RT3"); // End
    expect(s).not.toContain("base:L11");
  });

  it("stages 6 and 7 introduce no new skills of their own", () => {
    expect(stageSkills(6, LAYOUT)).toEqual([]);
    expect(stageSkills(7, LAYOUT)).toEqual([]);
  });
});

describe("stageGate", () => {
  it("always unlocks stage 1", () => {
    expect(stageGate(1, LAYOUT, []).unlocked).toBe(true);
  });

  it("locks stage 2 on a fresh profile", () => {
    const gate = stageGate(2, LAYOUT, []);
    expect(gate.unlocked).toBe(false);
    expect(gate.accuracy).toBe(0);
  });

  it("unlocks stage 2 once every stage 1 skill is accurate and fast", () => {
    const gate = stageGate(2, LAYOUT, passing(stageSkills(1, LAYOUT)));
    expect(gate.accuracy).toBeCloseTo(0.98, 10);
    expect(gate.medianLatencyMs).toBe(300);
    expect(gate.unlocked).toBe(true);
  });

  it("treats a zero-sample prerequisite skill as failing", () => {
    const ids = stageSkills(1, LAYOUT);
    const stats = passing(ids);
    stats[0] = { ...stats[0], samples: 0 };
    expect(stageGate(2, LAYOUT, stats).unlocked).toBe(false);
  });

  it("fails when accuracy is under the gate", () => {
    const gate = stageGate(2, LAYOUT, passing(stageSkills(1, LAYOUT), { ewmaError: 0.05 }));
    expect(gate.accuracy).toBeCloseTo(0.95, 10);
    expect(gate.accuracy).toBeLessThan(GATE_ACCURACY);
    expect(gate.unlocked).toBe(false);
  });

  it("fails when median latency is over the gate", () => {
    const gate = stageGate(2, LAYOUT, passing(stageSkills(1, LAYOUT), { ewmaLatencyMs: 500 }));
    expect(gate.medianLatencyMs).toBeGreaterThan(GATE_LATENCY_MS);
    expect(gate.unlocked).toBe(false);
  });

  it("gates stages 6 and 7 on stages 3 AND 4 together", () => {
    const onlySymbols = passing(stageSkills(3, LAYOUT));
    expect(stageGate(6, LAYOUT, onlySymbols).unlocked).toBe(false);
    const both = passing([...stageSkills(3, LAYOUT), ...stageSkills(4, LAYOUT)]);
    expect(stageGate(6, LAYOUT, both).unlocked).toBe(true);
    expect(stageGate(7, LAYOUT, both).unlocked).toBe(true);
  });
});
