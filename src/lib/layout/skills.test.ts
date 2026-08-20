import { expect, test } from "vite-plus/test";
import { LAYOUT } from "./layout-data";
import { skillVocabulary } from "./skills";

const vocab = skillVocabulary(LAYOUT);
const byId = new Map(vocab.map((s) => [s.id, s]));

test("numpad 7 is its own skill labelled P7", () => {
  expect(byId.get("lower:R11")).toEqual({
    id: "lower:R11",
    layer: "lower",
    keyId: "R11",
    label: "P7",
  });
});

test("base 7 and lower P7 are distinct skills", () => {
  expect(byId.get("base:R01")?.label).toBe("7");
  expect(byId.has("lower:R11")).toBe(true);
});

test("modifier and system keys are excluded", () => {
  expect(byId.has("base:LT2")).toBe(false);
  expect(byId.has("base:RT2")).toBe(false);
  expect(byId.has("base:L30")).toBe(false);
  expect(byId.has("lower:L14")).toBe(false);
  expect(byId.has("raise:R22")).toBe(false);
});

test("vocabulary is ordered base then lower then raise", () => {
  const layers = vocab.map((s) => s.layer);
  expect(layers.indexOf("lower")).toBeGreaterThan(layers.lastIndexOf("base"));
  expect(layers.indexOf("raise")).toBeGreaterThan(layers.lastIndexOf("lower"));
});

test("every skill points at a key with trainable output", () => {
  for (const skill of vocab) {
    const key = LAYOUT.keys.find((k) => k.id === skill.keyId);
    const out = key?.output[skill.layer];
    expect(out?.role).toBeUndefined();
    expect(out?.char ?? out?.key).toBeDefined();
    expect(skill.label.length).toBeGreaterThan(0);
  }
});
