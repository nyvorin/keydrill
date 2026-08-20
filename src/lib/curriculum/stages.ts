import type { SkillStat } from "../adaptive/ewma";
import type { Layout, LayerId } from "../layout/types";

export type LangId =
  | "js"
  | "ts"
  | "html"
  | "css"
  | "php"
  | "rust"
  | "go"
  | "java"
  | "kotlin"
  | "sql";

export interface Stage {
  id: number;
  slug: string;
  title: string;
  drillKind: "chars" | "nav" | "idiom" | "code";
}

export const STAGES: Stage[] = [
  {
    id: 1,
    slug: "base-letters",
    title: "Base refresh — letters & punctuation",
    drillKind: "chars",
  },
  {
    id: 2,
    slug: "base-shifted",
    title: "Base shifted — digits and !@#$%^&*()",
    drillKind: "chars",
  },
  { id: 3, slug: "lower-symbols", title: "Lower symbols — the coding core", drillKind: "chars" },
  { id: 4, slug: "lower-numpad", title: "Lower numpad — P0 to P9", drillKind: "chars" },
  {
    id: 5,
    slug: "navigation",
    title: "Navigation — arrows, Home/End, PgUp/PgDn",
    drillKind: "nav",
  },
  { id: 6, slug: "idioms", title: "Language idioms", drillKind: "idiom" },
  { id: 7, slug: "code-copy", title: "Code copy", drillKind: "code" },
];

export const GATE_ACCURACY = 0.96;
export const GATE_LATENCY_MS = 400;

const LAYERS: LayerId[] = ["base", "lower", "raise"];
/**
 * Documented v1 deviation from spec §4's "…F-keys, Esc" list: `Escape` and `F1`–`F12` are
 * exercised by the Task 19 verification wizard only. macOS intercepts several F-keys and
 * Esc cancels focus, so they stay out of the drill pool (decided).
 */
const NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);
/** Base punctuation that ships with stage 1 alongside the letters. */
const STAGE1_PUNCT = new Set([",", ".", ";", "'", "/", " "]);

function isLetter(ch: string): boolean {
  return /^[a-z]$/.test(ch);
}

function isDigit(ch: string): boolean {
  return /^[0-9]$/.test(ch);
}

/**
 * The skill ids a stage trains. One skill per (layer, key); Shift variants share the
 * base skill, so capitals never appear as skills of their own.
 */
export function stageSkills(stageId: number, layout: Layout): string[] {
  const ids: string[] = [];
  for (const key of layout.keys) {
    for (const layer of LAYERS) {
      const out = key.output[layer];
      if (!out || out.role) continue;
      const id = `${layer}:${key.id}`;
      const char = typeof out.char === "string" ? out.char : null;

      if (stageId === 1) {
        if (layer !== "base") continue;
        if ((char && (isLetter(char) || STAGE1_PUNCT.has(char))) || out.key === "Enter")
          ids.push(id);
      } else if (stageId === 2) {
        // Shifted base symbols: digits' !@#$%^&*() plus < > ? : ". Capitals are excluded
        // because Shift+letter reuses the letter's own skill.
        if (layer !== "base") continue;
        if (typeof out.shift === "string" && !/^[A-Z]$/.test(out.shift)) ids.push(id);
      } else if (stageId === 3) {
        if (layer !== "lower") continue;
        if (char && !isDigit(char)) ids.push(id);
      } else if (stageId === 4) {
        if (layer !== "lower") continue;
        if (char && isDigit(char)) ids.push(id);
      } else if (stageId === 5) {
        if (out.key && NAV_KEYS.has(out.key)) ids.push(id);
      }
      // Stages 6 and 7 reuse earlier skills in real code — they add none.
    }
  }
  return ids;
}

export interface GateResult {
  unlocked: boolean;
  accuracy: number;
  medianLatencyMs: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Which skills must be mastered before a stage opens. Stages 6 and 7 (idioms and code
 *  copy) need the symbol core AND the numpad, not merely the stage before them. */
function prerequisiteSkills(stageId: number, layout: Layout): string[] {
  if (stageId >= 6) return [...stageSkills(3, layout), ...stageSkills(4, layout)];
  return stageSkills(stageId - 1, layout);
}

export function stageGate(stageId: number, layout: Layout, stats: SkillStat[]): GateResult {
  if (stageId <= 1) return { unlocked: true, accuracy: 1, medianLatencyMs: 0 };

  const prereq = prerequisiteSkills(stageId, layout);
  if (prereq.length === 0) return { unlocked: true, accuracy: 1, medianLatencyMs: 0 };

  const byId = new Map<string, SkillStat>();
  for (const s of stats) byId.set(s.skillId, s);

  let unsampled = 0;
  const errors: number[] = [];
  const latencies: number[] = [];
  for (const id of prereq) {
    const s = byId.get(id);
    if (!s || s.samples <= 0) {
      unsampled += 1;
      errors.push(1);
      latencies.push(Number.POSITIVE_INFINITY);
      continue;
    }
    errors.push(s.ewmaError);
    latencies.push(s.ewmaLatencyMs);
  }

  const accuracy = 1 - errors.reduce((a, b) => a + b, 0) / errors.length;
  const medianLatencyMs = median(latencies);
  const unlocked =
    unsampled === 0 && accuracy >= GATE_ACCURACY && medianLatencyMs <= GATE_LATENCY_MS;

  return { unlocked, accuracy, medianLatencyMs };
}
