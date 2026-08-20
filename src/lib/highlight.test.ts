import { describe, expect, it } from "vite-plus/test";
import { PLAIN_COLOR, highlightTokens } from "./highlight";

describe("highlightTokens", () => {
  it("returns one row per line and one cell per char in plain mode", async () => {
    const rows = await highlightTokens("ab\ncd", "plain");
    expect(rows).toHaveLength(2);
    expect(rows[0].map((c) => c.char).join("")).toBe("ab");
    expect(rows[1].map((c) => c.char).join("")).toBe("cd");
    expect([...new Set(rows.flat().map((c) => c.color))]).toEqual([PLAIN_COLOR]);
  });

  it("falls back to plain for a language it does not carry", async () => {
    const rows = await highlightTokens("x", "brainfuck");
    expect(rows[0][0]).toEqual({ char: "x", color: PLAIN_COLOR });
  });

  it("colors typescript with at least two distinct token colors", async () => {
    const rows = await highlightTokens("const a = 1;", "typescript");
    expect(rows).toHaveLength(1);
    expect(rows[0].map((c) => c.char).join("")).toBe("const a = 1;");
    expect(new Set(rows[0].map((c) => c.color)).size).toBeGreaterThanOrEqual(2);
  }, 30000);
});
