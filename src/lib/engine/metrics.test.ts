import { describe, expect, it } from "vite-plus/test";
import { summarize } from "./metrics";
import type { KeystrokeLog } from "./typing-reducer";

function log(
  ts: number,
  expected: string,
  got: string,
  correct: boolean,
  latencyMs: number | null,
  skillId: string | null,
): KeystrokeLog {
  return { ts, expected, got, correct, latencyMs, skillId };
}

// Hand-computed fixture:
//   6 keystrokes, 5 correct, 1 error -> accuracy 5/6
//   duration 2500 - 1000 = 1500 ms = 0.025 min -> wpm (5/5)/0.025 = 40
//   layer latencies (correct only): [500, 400] -> median 450   (the wrong 200 ms is excluded)
//   base latencies  (correct only): [200, 400] -> median 300   (the null first latency is excluded)
const FIXTURE: KeystrokeLog[] = [
  log(1000, "a", "a", true, null, "base:L21"),
  log(1200, "{", "[", false, 200, "lower:L35"),
  log(1500, "{", "{", true, 500, "lower:L35"),
  log(1700, "x", "x", true, 200, "base:L32"),
  log(2100, "}", "}", true, 400, "lower:R30"),
  log(2500, " ", " ", true, 400, "base:RT4"),
];

describe("summarize", () => {
  it("matches the hand-computed fixture exactly", () => {
    const s = summarize(FIXTURE);
    expect(s.keystrokes).toBe(6);
    expect(s.errors).toBe(1);
    expect(s.durationMs).toBe(1500);
    expect(s.wpm).toBe(40);
    expect(s.accuracy).toBeCloseTo(5 / 6, 10);
    expect(s.layerLatencyMs).toBe(450);
    expect(s.baseLatencyMs).toBe(300);
  });

  it("uses the middle value for an odd number of latencies", () => {
    const s = summarize([
      log(0, "a", "a", true, 300, "base:L21"),
      log(100, "b", "b", true, 500, "base:L35"),
      log(200, "x", "x", true, 400, "base:L32"),
    ]);
    expect(s.baseLatencyMs).toBe(400);
    expect(s.layerLatencyMs).toBeNull();
  });

  it("counts raise-layer skills as layer chords", () => {
    const s = summarize([
      log(0, "=", "=", true, 600, "raise:R20"),
      log(100, "=", "=", true, 800, "raise:R20"),
    ]);
    expect(s.layerLatencyMs).toBe(700);
  });

  it("scales wpm by correct keystrokes over elapsed minutes", () => {
    const logs = Array.from({ length: 25 }, (_, i) =>
      log(i * 1250, "a", "a", true, i === 0 ? null : 1250, "base:L21"),
    );
    const s = summarize(logs);
    expect(s.durationMs).toBe(30000);
    expect(s.wpm).toBe(10);
  });

  it("returns a zeroed summary for no keystrokes", () => {
    expect(summarize([])).toEqual({
      wpm: 0,
      accuracy: 1,
      durationMs: 0,
      keystrokes: 0,
      errors: 0,
      layerLatencyMs: null,
      baseLatencyMs: null,
    });
  });

  it("avoids dividing by zero for a single keystroke", () => {
    const s = summarize([log(500, "a", "a", true, null, "base:L21")]);
    expect(s.durationMs).toBe(0);
    expect(s.wpm).toBe(0);
    expect(s.accuracy).toBe(1);
  });
});
