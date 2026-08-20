import type { KeystrokeLog } from "../engine/typing-reducer";

export interface SkillStat {
  skillId: string;
  ewmaError: number;
  ewmaLatencyMs: number;
  samples: number;
}

export const ALPHA_ERROR = 0.15;
export const ALPHA_LATENCY = 0.1;

/**
 * Folds one keystroke into a per-skill EWMA.
 * First sample seeds ewmaError = correct ? 0 : 1 and ewmaLatencyMs = latencyMs ?? 0.
 * Later samples blend with ALPHA_*; a null latency leaves ewmaLatencyMs untouched
 * (samples still increments, so error rate keeps moving).
 */
export function updateSkill(prev: SkillStat | null, log: KeystrokeLog): SkillStat {
  const errorSample = log.correct ? 0 : 1;
  if (prev === null) {
    return {
      skillId: log.skillId ?? "",
      ewmaError: errorSample,
      ewmaLatencyMs: log.latencyMs ?? 0,
      samples: 1,
    };
  }
  const ewmaError = ALPHA_ERROR * errorSample + (1 - ALPHA_ERROR) * prev.ewmaError;
  const ewmaLatencyMs =
    log.latencyMs === null
      ? prev.ewmaLatencyMs
      : ALPHA_LATENCY * log.latencyMs + (1 - ALPHA_LATENCY) * prev.ewmaLatencyMs;
  return {
    skillId: prev.skillId || (log.skillId ?? ""),
    ewmaError,
    ewmaLatencyMs,
    samples: prev.samples + 1,
  };
}
