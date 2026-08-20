import { expect, test } from "vite-plus/test";
import { LAYOUT } from "./layout-data";
import {
  buildReverseIndex,
  preferredRecipe,
  recipeHint,
  skillId,
  type Recipe,
} from "./reverse-index";

const index = buildReverseIndex(LAYOUT);
const at = (token: string): Recipe[] => index.get(token) ?? [];

test("the board has 56 keys", () => {
  expect(LAYOUT.keys).toHaveLength(56);
});

test("'{' has exactly one recipe: Lower + L35", () => {
  expect(at("{")).toEqual([
    { layer: "lower", keyId: "L35", hand: "left", finger: "index", holds: ["lower"] },
  ]);
});

test("'(' has several routes and prefers the Lower thumb LT3", () => {
  const recipes = at("(");
  expect(recipes.length).toBeGreaterThanOrEqual(3);
  const best = preferredRecipe(recipes);
  expect(best.keyId).toBe("LT3");
  expect(best.layer).toBe("lower");
  expect(best.finger).toBe("thumb");
});

test("'A' is Shift + the base 'a' key", () => {
  expect(at("A")).toEqual([
    { layer: "base", keyId: "L21", hand: "left", finger: "pinky", holds: ["shift"] },
  ]);
});

test("'Enter' is a bare base thumb key", () => {
  expect(at("Enter")).toEqual([
    { layer: "base", keyId: "LT4", hand: "left", finger: "thumb", holds: [] },
  ]);
});

test("modifier and system keys produce no recipes", () => {
  const keyIds = [...index.values()].flat().map((r) => `${r.layer}:${r.keyId}`);
  expect(keyIds).not.toContain("base:LT2");
  expect(keyIds).not.toContain("base:RT2");
  expect(keyIds).not.toContain("lower:L14");
  expect(keyIds).not.toContain("raise:L30");
});

test("every base char on the board round-trips through the index", () => {
  for (const key of LAYOUT.keys) {
    const char = key.output.base?.char;
    if (char === undefined) continue;
    const hit = at(char).some(
      (r) => r.layer === "base" && r.keyId === key.id && r.holds.length === 0,
    );
    expect(hit, `no base recipe for ${key.id} -> ${JSON.stringify(char)}`).toBe(true);
  }
});

test("skillId collapses Shift into the base skill", () => {
  expect(skillId(preferredRecipe(at("a")))).toBe("base:L21");
  expect(skillId(preferredRecipe(at("A")))).toBe("base:L21");
  expect(skillId(preferredRecipe(at("7")))).toBe("base:R01");
});

test("recipeHint spells out the chord", () => {
  expect(recipeHint(preferredRecipe(at("{")))).toBe("hold Lower + left index");
  expect(recipeHint(preferredRecipe(at("A")))).toBe("Shift + left pinky");
  expect(recipeHint(preferredRecipe(at(" ")))).toBe("right thumb");
  expect(recipeHint(preferredRecipe(at("=")))).toBe("hold Raise + right index");
});
