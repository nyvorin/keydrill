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

export function preferredRecipe(recipes: Recipe[], overrideRoute?: string | null): Recipe {
  const first = recipes[0];
  if (first === undefined) throw new Error("preferredRecipe: no recipes");
  if (overrideRoute) {
    const hit = recipes.find((r) => `${r.layer}:${r.keyId}` === overrideRoute);
    if (hit !== undefined) return hit;
  }
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

/**
 * Physical modifier keys, per the board's key table:
 * LT2 = left inner thumb (Lower / Fn 1), RT2 = right inner thumb (Raise / Fn 2),
 * L30 = left Shift (row 3 pinky), R35 = right Shift (row 3 pinky).
 */
export const LOWER_KEY_ID = "LT2";
export const RAISE_KEY_ID = "RT2";
export const SHIFT_KEY_ID_LEFT = "L30";
export const SHIFT_KEY_ID_RIGHT = "R35";

/**
 * The physical keys that must be held down to execute `r`.
 * Shift resolves to the Shift key on the hand OPPOSITE the tapped key, which is
 * how the chord is actually played (left-hand letter → right Shift, and vice versa).
 */
export function holdKeyIds(r: Recipe): string[] {
  const ids: string[] = [];
  for (const hold of r.holds) {
    if (hold === "lower") ids.push(LOWER_KEY_ID);
    else if (hold === "raise") ids.push(RAISE_KEY_ID);
    else ids.push(r.hand === "left" ? SHIFT_KEY_ID_RIGHT : SHIFT_KEY_ID_LEFT);
  }
  return ids;
}
