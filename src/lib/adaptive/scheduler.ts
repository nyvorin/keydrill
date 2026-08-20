import type { SkillInfo } from "../layout/skills";
import type { SkillStat } from "./ewma";

export const W_ERROR = 0.7;
export const W_LATENCY = 0.3;
export const LATENCY_NORM_MS = 1500;
export const EXPLORE_WEAKNESS = 0.75;
export const MIN_SAMPLES = 10;

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * How badly a skill needs practice, in [0, 1].
 * Under-sampled skills get a fixed exploration bonus so the scheduler keeps
 * probing keys it knows nothing about instead of grinding the same few.
 */
export function weakness(s: SkillStat | undefined): number {
  if (!s || s.samples < MIN_SAMPLES) return EXPLORE_WEAKNESS;
  return W_ERROR * s.ewmaError + W_LATENCY * clamp(s.ewmaLatencyMs / LATENCY_NORM_MS, 0, 1);
}

/** Top-n skill ids by weakness (descending); ties broken by skill id ascending so the
 *  result is independent of the order stats arrive in. */
export function pickWeakSkills(stats: SkillStat[], vocab: SkillInfo[], n: number): string[] {
  const byId = new Map<string, SkillStat>();
  for (const s of stats) byId.set(s.skillId, s);
  const scored = vocab.map((v) => ({ id: v.id, score: weakness(byId.get(v.id)) }));
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, Math.max(0, n)).map((s) => s.id);
}
