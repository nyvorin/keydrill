import { describe, expect, it } from "vite-plus/test";
import { LAYOUT } from "./layout-data";
import { buildReverseIndex, holdKeyIds, preferredRecipe } from "./reverse-index";

const index = buildReverseIndex(LAYOUT);

function best(ch: string) {
  const recipes = index.get(ch);
  expect(recipes, `no recipes for ${ch}`).toBeDefined();
  return preferredRecipe(recipes!);
}

describe("holdKeyIds", () => {
  it("maps a Lower-layer recipe to the Lower thumb key", () => {
    const r = best("{");
    expect(r.keyId).toBe("L35");
    expect(r.holds).toEqual(["lower"]);
    expect(holdKeyIds(r)).toEqual(["LT2"]);
  });

  it("maps a Raise-layer recipe to the Raise thumb key", () => {
    const r = best("F6");
    expect(r.keyId).toBe("R00");
    expect(holdKeyIds(r)).toEqual(["RT2"]);
  });

  it("returns no hold keys for a plain base recipe", () => {
    const r = best("a");
    expect(r.keyId).toBe("L21");
    expect(holdKeyIds(r)).toEqual([]);
  });

  it("uses the opposite-hand Shift key for shifted recipes", () => {
    const left = best("A");
    expect(left.hand).toBe("left");
    expect(holdKeyIds(left)).toEqual(["R35"]);

    const right = best(":");
    expect(right.hand).toBe("right");
    expect(holdKeyIds(right)).toEqual(["L30"]);
  });
});
