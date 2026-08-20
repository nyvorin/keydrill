import { describe, expect, it } from "vite-plus/test";
import { LAYOUT } from "../layout/layout-data";
import type { LayerId } from "../layout/types";
import { generateDrillLine, mulberry32 } from "./generator";

// Six Lower-layer skills whose characters are NOT part of the generator's fragment
// scaffolding, so "the line contains them" really proves they were requested.
const WEAK = [
  "lower:R11", // P7 -> '7'
  "lower:R12", // P8 -> '8'
  "lower:R13", // P9 -> '9'
  "lower:R14", // P0 -> '0'
  "lower:R24", // '+'
  "lower:R25", // '|'
];
const WEAK_CHARS = ["7", "8", "9", "0", "+", "|"];

function boardChars(): Set<string> {
  const set = new Set<string>();
  for (const key of LAYOUT.keys) {
    for (const layer of ["base", "lower", "raise"] as LayerId[]) {
      const out = key.output[layer];
      if (out && !out.role && typeof out.char === "string") set.add(out.char);
    }
  }
  return set;
}

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("stays inside [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 500; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("generateDrillLine", () => {
  it("produces the same line for the same seed", () => {
    expect(generateDrillLine(WEAK, LAYOUT, mulberry32(1234))).toBe(
      generateDrillLine(WEAK, LAYOUT, mulberry32(1234)),
    );
  });

  it("produces a different line for a different seed", () => {
    expect(generateDrillLine(WEAK, LAYOUT, mulberry32(1))).not.toBe(
      generateDrillLine(WEAK, LAYOUT, mulberry32(2)),
    );
  });

  it("always lands between 40 and 60 characters", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const line = generateDrillLine(WEAK, LAYOUT, mulberry32(seed));
      expect(line.length).toBeGreaterThanOrEqual(40);
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it("exercises at least three of the requested weak skills", () => {
    for (const seed of [0, 42, 777]) {
      const line = generateDrillLine(WEAK, LAYOUT, mulberry32(seed));
      const hits = WEAK_CHARS.filter((c) => line.includes(c));
      expect(hits.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("only uses characters this board can actually produce", () => {
    const allowed = boardChars();
    for (let seed = 0; seed < 20; seed += 1) {
      for (const ch of generateDrillLine(WEAK, LAYOUT, mulberry32(seed))) {
        expect(allowed.has(ch)).toBe(true);
      }
    }
  });

  it("falls back to symbol practice when no requested skill types a character", () => {
    // base:LT4 is Enter, lower:L21 is ArrowLeft — named keys, no printable char.
    const line = generateDrillLine(["base:LT4", "lower:L21"], LAYOUT, mulberry32(5));
    expect(line.length).toBeGreaterThanOrEqual(40);
    expect(line.length).toBeLessThanOrEqual(60);
    expect(line).toMatch(/[{}[\]();=]/);
  });
});
