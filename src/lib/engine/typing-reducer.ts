import type { TargetChar } from "./target";

export interface KeyEventIn {
  key: string;
  ts: number;
}
export interface KeystrokeLog {
  ts: number;
  expected: string;
  got: string;
  correct: boolean;
  latencyMs: number | null;
  skillId: string | null;
}
export interface TypingState {
  pos: number;
  errorAt: number | null;
  startedAt: number | null;
  lastCorrectTs: number | null;
  done: boolean;
  errorCount: number;
}

export const LATENCY_CAP_MS = 5000;

/** Keys that produce nothing on their own — they never advance, error, or log. */
const IGNORED_KEYS = new Set(["Shift", "Meta", "Alt", "Control", "CapsLock", "Fn"]);

export function initTyping(): TypingState {
  return {
    pos: 0,
    errorAt: null,
    startedAt: null,
    lastCorrectTs: null,
    done: false,
    errorCount: 0,
  };
}

/** Target char -> the KeyboardEvent.key that satisfies it (also the reverse-index lookup key). */
export function expectedKeyFor(ch: string): string {
  if (ch === "\n") return "Enter";
  if (ch === "\t") return "Tab";
  return ch;
}

function skipAuto(target: TargetChar[], from: number): number {
  let i = from;
  while (i < target.length && target[i].autoSkip) i++;
  return i;
}

/** Index of the char the drill is waiting for; target.length once nothing is left. */
export function nextExpectedIndex(state: TypingState, target: TargetChar[]): number {
  return skipAuto(target, state.pos);
}

export function isComplete(state: TypingState, target: TargetChar[]): boolean {
  return state.done || skipAuto(target, state.pos) >= target.length;
}

/**
 * Pure keystroke reducer. No clock, no DOM: the caller supplies `ev.ts` and the skill lookup.
 * Strict mode — a wrong key blocks advancement until the right key or Backspace arrives.
 */
export function reduceKey(
  state: TypingState,
  target: TargetChar[],
  ev: KeyEventIn,
  skillOf: (ch: string) => string | null,
): { state: TypingState; log: KeystrokeLog | null } {
  if (state.done || IGNORED_KEYS.has(ev.key)) return { state, log: null };

  const idx = skipAuto(target, state.pos);
  if (idx >= target.length) {
    return { state: { ...state, pos: target.length, done: true }, log: null };
  }

  if (ev.key === "Backspace" && state.errorAt !== null) {
    return { state: { ...state, pos: idx, errorAt: null }, log: null };
  }

  const expected = expectedKeyFor(target[idx].ch);
  const correct = ev.key === expected;
  // Latency is the gap between *consecutive correct* keystrokes — a time-to-produce. A wrong key
  // and the first keystroke of a drill have no such gap, so they log null. Capped so a coffee
  // break never poisons the EWMA (spec §6).
  const latencyMs =
    correct && state.lastCorrectTs !== null
      ? Math.max(0, Math.min(ev.ts - state.lastCorrectTs, LATENCY_CAP_MS))
      : null;
  const log: KeystrokeLog = {
    ts: ev.ts,
    expected,
    got: ev.key,
    correct,
    latencyMs,
    skillId: skillOf(expected),
  };
  const startedAt = state.startedAt ?? ev.ts;

  if (!correct) {
    return {
      state: { ...state, pos: idx, errorAt: idx, errorCount: state.errorCount + 1, startedAt },
      log,
    };
  }

  const pos = skipAuto(target, idx + 1);
  return {
    state: {
      pos,
      errorAt: null,
      startedAt,
      lastCorrectTs: ev.ts,
      done: pos >= target.length,
      errorCount: state.errorCount,
    },
    log,
  };
}
