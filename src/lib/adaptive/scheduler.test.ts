import { describe, expect, it } from "vite-plus/test";
import type { SkillInfo } from "../layout/skills";
import type { SkillStat } from "./ewma";
import {
  EXPLORE_WEAKNESS,
  LATENCY_NORM_MS,
  MIN_SAMPLES,
  W_ERROR,
  W_LATENCY,
  pickWeakSkills,
  weakness,
} from "./scheduler";

function stat(skillId: string, ewmaError: number, ewmaLatencyMs: number, samples = 50): SkillStat {
  return { skillId, ewmaError, ewmaLatencyMs, samples };
}

function info(id: string): SkillInfo {
  const [layer, keyId] = id.split(":");
  return { id, layer: layer as SkillInfo["layer"], keyId, label: keyId };
}

const VOCAB: SkillInfo[] = ["base:L11", "base:L12", "lower:L35", "lower:R11"].map(info);

describe("weakness", () => {
  it("returns the exploration bonus for a skill that has never been seen", () => {
    expect(weakness(undefined)).toBe(EXPLORE_WEAKNESS);
  });

  it("returns the exploration bonus below MIN_SAMPLES", () => {
    expect(weakness(stat("lower:L35", 0, 0, MIN_SAMPLES - 1))).toBe(EXPLORE_WEAKNESS);
  });

  it("blends error rate and normalised latency once the skill is sampled enough", () => {
    const s = stat("lower:L35", 0.2, LATENCY_NORM_MS / 2, MIN_SAMPLES);
    expect(weakness(s)).toBeCloseTo(W_ERROR * 0.2 + W_LATENCY * 0.5, 10);
  });

  it("clamps latency at LATENCY_NORM_MS", () => {
    expect(weakness(stat("lower:L35", 0, LATENCY_NORM_MS * 4))).toBeCloseTo(W_LATENCY, 10);
  });

  it("scores a fast, error-free skill at zero", () => {
    expect(weakness(stat("base:L11", 0, 0))).toBe(0);
  });
});

describe("pickWeakSkills", () => {
  it("orders by weakness descending", () => {
    const stats = [
      stat("base:L11", 0.5, 200),
      stat("base:L12", 0.1, 200),
      stat("lower:L35", 0.3, 200),
      stat("lower:R11", 0.0, 200),
    ];
    expect(pickWeakSkills(stats, VOCAB, 4)).toEqual([
      "base:L11",
      "lower:L35",
      "base:L12",
      "lower:R11",
    ]);
  });

  it("takes only the top n", () => {
    const stats = [
      stat("base:L11", 0.5, 200),
      stat("base:L12", 0.1, 200),
      stat("lower:L35", 0.3, 200),
      stat("lower:R11", 0.0, 200),
    ];
    expect(pickWeakSkills(stats, VOCAB, 2)).toEqual(["base:L11", "lower:L35"]);
  });

  it("ranks unseen skills above well-practised ones, tiebreaking by id", () => {
    const stats = [stat("base:L11", 0.02, 120)];
    expect(pickWeakSkills(stats, VOCAB, 2)).toEqual(["base:L12", "lower:L35"]);
  });

  it("is stable under permutation of the stats input", () => {
    const a = [stat("lower:R11", 0.4, 100), stat("base:L11", 0.4, 100)];
    const b = [...a].reverse();
    expect(pickWeakSkills(a, VOCAB, 4)).toEqual(pickWeakSkills(b, VOCAB, 4));
    expect(pickWeakSkills(a, VOCAB, 4)).toEqual(["base:L12", "lower:L35", "base:L11", "lower:R11"]);
  });

  it("returns the whole vocabulary when n exceeds it", () => {
    expect(pickWeakSkills([], VOCAB, 99)).toHaveLength(4);
  });
});
