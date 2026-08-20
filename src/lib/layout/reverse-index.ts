import type { Finger, Hand, KeyOutput, LayerId, Layout } from "./types";

export interface Recipe {
  layer: LayerId;
  keyId: string;
  hand: Hand;
  finger: Finger;
  holds: Array<"lower" | "raise" | "shift">;
}

/** key: printable char (e.g. '{', 'a', 'A') or named key ('Enter') */
export type ReverseIndex = Map<string, Recipe[]>;

const LAYER_ORDER: LayerId[] = ["base", "lower", "raise"];
const FINGER_ORDER: Finger[] = ["thumb", "index", "middle", "ring", "pinky"];
const HOLD_LABEL: Record<"lower" | "raise" | "shift", string> = {
  lower: "hold Lower",
  raise: "hold Raise",
  shift: "Shift",
};

export function buildReverseIndex(layout: Layout): ReverseIndex {
  const index: ReverseIndex = new Map();
  const add = (token: string, recipe: Recipe): void => {
    const bucket = index.get(token);
    if (bucket) bucket.push(recipe);
    else index.set(token, [recipe]);
  };
  for (const key of layout.keys) {
    for (const layer of LAYER_ORDER) {
      const out: KeyOutput | undefined = key.output[layer];
      if (!out || out.role !== undefined) continue;
      const holds: Array<"lower" | "raise" | "shift"> = layer === "base" ? [] : [layer];
      const at = { layer, keyId: key.id, hand: key.hand, finger: key.finger };
      if (out.char !== undefined) add(out.char, { ...at, holds: [...holds] });
      if (out.key !== undefined) add(out.key, { ...at, holds: [...holds] });
      if (layer === "base" && out.shift !== undefined) add(out.shift, { ...at, holds: ["shift"] });
    }
  }
  return index;
}

function compareRecipes(a: Recipe, b: Recipe): number {
  if (a.holds.length !== b.holds.length) return a.holds.length - b.holds.length;
  return FINGER_ORDER.indexOf(a.finger) - FINGER_ORDER.indexOf(b.finger);
}

export function preferredRecipe(recipes: Recipe[]): Recipe {
  const first = recipes[0];
  if (first === undefined) throw new Error("preferredRecipe: no recipes");
  let best = first;
  for (let i = 1; i < recipes.length; i += 1) {
    const candidate = recipes[i] as Recipe;
    if (compareRecipes(candidate, best) < 0) best = candidate;
  }
  return best;
}

/** `${layer}:${keyId}` — Shift adds no new skill. */
export function skillId(r: Recipe): string {
  return `${r.layer}:${r.keyId}`;
}

/** "hold Lower + right index" / "Shift + left pinky" / "right thumb" */
export function recipeHint(r: Recipe): string {
  const where = `${r.hand} ${r.finger}`;
  if (r.holds.length === 0) return where;
  return `${r.holds.map((h) => HOLD_LABEL[h]).join(" + ")} + ${where}`;
}
