import { describe, expect, it } from "vite-plus/test";
import { prepareTarget, type TargetChar } from "./target";
import {
  LATENCY_CAP_MS,
  expectedKeyFor,
  initTyping,
  isComplete,
  nextExpectedIndex,
  reduceKey,
  type KeystrokeLog,
  type TypingState,
} from "./typing-reducer";

const SKILLS: Record<string, string> = {
  a: "base:L21",
  b: "base:L35",
  x: "base:L32",
  " ": "base:RT4",
  "{": "lower:L35",
  Enter: "base:LT4",
  Tab: "base:L10",
};
const skillOf = (ch: string): string | null => SKILLS[ch] ?? null;

function play(
  target: TargetChar[],
  keys: Array<[string, number]>,
): { state: TypingState; logs: KeystrokeLog[] } {
  let state = initTyping();
  const logs: KeystrokeLog[] = [];
  for (const [key, ts] of keys) {
    const r = reduceKey(state, target, { key, ts }, skillOf);
    state = r.state;
    if (r.log) logs.push(r.log);
  }
  return { state, logs };
}

describe("expectedKeyFor", () => {
  it("normalizes newline and tab to named keys and leaves printables alone", () => {
    expect(expectedKeyFor("\n")).toBe("Enter");
    expect(expectedKeyFor("\t")).toBe("Tab");
    expect(expectedKeyFor("a")).toBe("a");
    expect(expectedKeyFor(" ")).toBe(" ");
  });
});

describe("reduceKey", () => {
  const AB = prepareTarget("ab", { strictWhitespace: false });

  it("advances on a correct char and logs it with a null first latency", () => {
    const { state, logs } = play(AB, [["a", 1000]]);
    expect(state).toEqual({
      pos: 1,
      errorAt: null,
      startedAt: 1000,
      lastCorrectTs: 1000,
      done: false,
      errorCount: 0,
    });
    expect(logs).toEqual([
      { ts: 1000, expected: "a", got: "a", correct: true, latencyMs: null, skillId: "base:L21" },
    ]);
  });

  it("blocks on a wrong char: errorAt set, pos unchanged, errorCount incremented", () => {
    const { state, logs } = play(AB, [["z", 1000]]);
    expect(state.pos).toBe(0);
    expect(state.errorAt).toBe(0);
    expect(state.errorCount).toBe(1);
    expect(state.lastCorrectTs).toBeNull();
    expect(logs).toEqual([
      { ts: 1000, expected: "a", got: "z", correct: false, latencyMs: null, skillId: "base:L21" },
    ]);
  });

  it("stays blocked for repeated wrong chars and clears the error on the correct one", () => {
    const { state, logs } = play(AB, [
      ["z", 1000],
      ["q", 1100],
      ["a", 1300],
    ]);
    expect(state.pos).toBe(1);
    expect(state.errorAt).toBeNull();
    expect(state.errorCount).toBe(2);
    expect(logs.map((l) => l.latencyMs)).toEqual([null, null, null]);
    expect(logs.map((l) => l.correct)).toEqual([false, false, true]);
  });

  it("clears the error on Backspace without logging a keystroke", () => {
    const { state, logs } = play(AB, [
      ["q", 1000],
      ["Backspace", 1100],
    ]);
    expect(state.errorAt).toBeNull();
    expect(state.errorCount).toBe(1);
    expect(state.pos).toBe(0);
    expect(logs).toHaveLength(1);
  });

  it("treats Backspace with no pending error as a wrong keystroke", () => {
    const { state, logs } = play(AB, [["Backspace", 1000]]);
    expect(state.errorAt).toBe(0);
    expect(state.errorCount).toBe(1);
    expect(logs[0]).toEqual({
      ts: 1000,
      expected: "a",
      got: "Backspace",
      correct: false,
      latencyMs: null,
      skillId: "base:L21",
    });
  });

  it("ignores pure modifier keys entirely", () => {
    for (const key of ["Shift", "Meta", "Alt", "Control", "CapsLock", "Fn"]) {
      const r = reduceKey(initTyping(), AB, { key, ts: 500 }, skillOf);
      expect(r.log).toBeNull();
      expect(r.state).toEqual(initTyping());
    }
  });

  it("expects 'Enter' for a newline and rejects a literal '\\n'", () => {
    const t = prepareTarget("a\nb", { strictWhitespace: false });
    const bad = play(t, [
      ["a", 0],
      ["\n", 10],
    ]);
    expect(bad.state.errorAt).toBe(1);
    expect(bad.logs[1]).toEqual({
      ts: 10,
      expected: "Enter",
      got: "\n",
      correct: false,
      latencyMs: null,
      skillId: "base:LT4",
    });
    const good = play(t, [
      ["a", 0],
      ["Enter", 10],
    ]);
    expect(good.state.pos).toBe(2);
    expect(good.logs[1].expected).toBe("Enter");
    expect(good.logs[1].skillId).toBe("base:LT4");
  });

  it("jumps over auto-skipped indentation after a correct keystroke", () => {
    const t = prepareTarget("a\n  b", { strictWhitespace: false });
    const { state } = play(t, [
      ["a", 0],
      ["Enter", 100],
    ]);
    expect(state.pos).toBe(4);
    expect(nextExpectedIndex(state, t)).toBe(4);
  });

  it("requires the indentation when strictWhitespace is true", () => {
    const t = prepareTarget("a\n  b", { strictWhitespace: true });
    const afterEnter = play(t, [
      ["a", 0],
      ["Enter", 100],
    ]);
    expect(afterEnter.state.pos).toBe(2);
    const afterSpace = play(t, [
      ["a", 0],
      ["Enter", 100],
      [" ", 200],
    ]);
    expect(afterSpace.state.pos).toBe(3);
    expect(afterSpace.logs[2]).toEqual({
      ts: 200,
      expected: " ",
      got: " ",
      correct: true,
      latencyMs: 100,
      skillId: "base:RT4",
    });
  });

  it("measures latency between correct keystrokes and caps it", () => {
    const t = prepareTarget("aba", { strictWhitespace: false });
    const { logs } = play(t, [
      ["a", 1000],
      ["b", 1250],
      ["a", 9000],
    ]);
    expect(logs.map((l) => l.latencyMs)).toEqual([null, 250, LATENCY_CAP_MS]);
  });

  it("finishes the drill and then ignores further keys", () => {
    const before = play(AB, [["a", 0]]);
    expect(isComplete(before.state, AB)).toBe(false);
    const { state, logs } = play(AB, [
      ["a", 0],
      ["b", 200],
    ]);
    expect(state.done).toBe(true);
    expect(state.pos).toBe(2);
    expect(isComplete(state, AB)).toBe(true);
    const after = reduceKey(state, AB, { key: "a", ts: 400 }, skillOf);
    expect(after.log).toBeNull();
    expect(after.state).toEqual(state);
    expect(logs).toHaveLength(2);
  });

  it("completes when only trailing auto-skipped whitespace remains", () => {
    const t = prepareTarget("a\n  ", { strictWhitespace: false });
    const { state } = play(t, [
      ["a", 0],
      ["Enter", 10],
    ]);
    expect(state.pos).toBe(4);
    expect(state.done).toBe(true);
  });

  it("reports a null skillId when the board cannot produce the char", () => {
    const t = prepareTarget("§", { strictWhitespace: false });
    const { logs } = play(t, [["§", 5]]);
    expect(logs[0].skillId).toBeNull();
  });

  it("never mutates the state it is given", () => {
    const s0 = initTyping();
    const r = reduceKey(s0, AB, { key: "a", ts: 5 }, skillOf);
    expect(s0).toEqual(initTyping());
    expect(r.state).not.toBe(s0);
  });
});

describe("nextExpectedIndex", () => {
  it("skips leading auto-skip chars before the first keystroke", () => {
    const t = prepareTarget("  a", { strictWhitespace: false });
    expect(nextExpectedIndex(initTyping(), t)).toBe(2);
  });
});
