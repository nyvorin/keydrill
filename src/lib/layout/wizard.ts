import type { LayerId, Layout } from "./types";
import { skillVocabulary } from "./skills";

export interface WizardStep {
  skillId: string;
  layer: LayerId;
  keyId: string;
  label: string;
  /** Printable char or named key the OS should report when this step is performed. */
  expected: string;
  hold: "lower" | "raise" | null;
}

export interface Mismatch {
  skillId: string;
  layer: LayerId;
  keyId: string;
  expected: string;
  got: string;
}

/** Bare modifiers never advance the wizard — they are held, not tapped. */
export const IGNORED_KEYS: readonly string[] = [
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "Fn",
  "FnLock",
  "ContextMenu",
  "Dead",
  "Unidentified",
];

const LAYER_ORDER: LayerId[] = ["base", "lower", "raise"];

export function buildWizardPlan(layout: Layout): WizardStep[] {
  const defById = new Map(layout.keys.map((k) => [k.id, k]));
  const vocab = skillVocabulary(layout);
  const steps: WizardStep[] = [];
  for (const layer of LAYER_ORDER) {
    const forLayer = vocab
      .filter((info) => info.layer === layer)
      .sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
    for (const info of forLayer) {
      const def = defById.get(info.keyId);
      if (!def) continue;
      const out = def.output[layer];
      if (!out || out.role) continue;
      const expected = out.char ?? out.key;
      if (expected === undefined) continue;
      steps.push({
        skillId: info.id,
        layer,
        keyId: info.keyId,
        label: info.label,
        expected,
        hold: layer === "base" ? null : layer,
      });
    }
  }
  return steps;
}

export function isIgnoredKey(key: string): boolean {
  return IGNORED_KEYS.includes(key);
}

export function matchStep(step: WizardStep, got: string): boolean {
  return step.expected === got;
}

export function describeOutput(out: string): string {
  if (out === " ") return "Space";
  return out.length === 1 ? `"${out}"` : out;
}

export function reportJson(
  board: string,
  plan: WizardStep[],
  mismatches: Mismatch[],
  skipped: string[],
  attempted: number,
  nowIso: string,
): string {
  return JSON.stringify(
    {
      board,
      generatedAt: nowIso,
      total: plan.length,
      attempted,
      verified: attempted - mismatches.length - skipped.length,
      mismatches,
      skipped,
    },
    null,
    2,
  );
}
