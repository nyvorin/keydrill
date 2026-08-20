import type { KeystrokeLog } from "./typing-reducer";

export interface DrillSummary {
  wpm: number;
  accuracy: number;
  durationMs: number;
  keystrokes: number;
  errors: number;
  layerLatencyMs: number | null;
  baseLatencyMs: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const xs = [...values].sort((a, b) => a - b);
  const mid = xs.length >> 1;
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Latencies of *correct* keystrokes whose skill matches — an error's latency is not a time-to-produce. */
function latencies(logs: KeystrokeLog[], match: (skillId: string) => boolean): number[] {
  const out: number[] = [];
  for (const l of logs) {
    if (!l.correct || l.latencyMs === null || l.skillId === null) continue;
    if (match(l.skillId)) out.push(l.latencyMs);
  }
  return out;
}

/** wpm = (correct / 5) / minutes; accuracy = correct / (correct + errors); latencies are medians. */
export function summarize(logs: KeystrokeLog[]): DrillSummary {
  const keystrokes = logs.length;
  let correct = 0;
  for (const l of logs) if (l.correct) correct++;
  const errors = keystrokes - correct;
  const durationMs = keystrokes === 0 ? 0 : logs[keystrokes - 1].ts - logs[0].ts;
  const minutes = durationMs / 60000;
  return {
    wpm: minutes > 0 ? correct / 5 / minutes : 0,
    accuracy: keystrokes === 0 ? 1 : correct / keystrokes,
    durationMs,
    keystrokes,
    errors,
    layerLatencyMs: median(
      latencies(logs, (id) => id.startsWith("lower:") || id.startsWith("raise:")),
    ),
    baseLatencyMs: median(latencies(logs, (id) => id.startsWith("base:"))),
  };
}
