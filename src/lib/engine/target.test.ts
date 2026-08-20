import { describe, expect, it } from "vite-plus/test";
import { prepareTarget } from "./target";

const SRC = "if (x) {\n  y();\n}"; // 17 chars: '\n' at 8 and 15, indentation at 9 and 10

describe("prepareTarget", () => {
  it("emits one entry per character with string indices", () => {
    const t = prepareTarget(SRC, { strictWhitespace: false });
    expect(t).toHaveLength(17);
    expect(t.map((c) => c.ch).join("")).toBe(SRC);
    expect(t.map((c) => c.index)).toEqual(Array.from({ length: 17 }, (_, i) => i));
  });

  it("auto-skips only leading indentation when strictWhitespace is false", () => {
    const t = prepareTarget(SRC, { strictWhitespace: false });
    expect(t.filter((c) => c.autoSkip).map((c) => c.index)).toEqual([9, 10]);
  });

  it("never auto-skips anything when strictWhitespace is true", () => {
    const t = prepareTarget(SRC, { strictWhitespace: true });
    expect(t.some((c) => c.autoSkip)).toBe(false);
  });

  it("auto-skips indentation on the first line too", () => {
    const t = prepareTarget("  a", { strictWhitespace: false });
    expect(t.map((c) => c.autoSkip)).toEqual([true, true, false]);
  });

  it("treats a leading tab as indentation", () => {
    const t = prepareTarget("a\n\tb", { strictWhitespace: false });
    expect(t.filter((c) => c.autoSkip).map((c) => c.index)).toEqual([2]);
  });

  it("never marks a newline as auto-skip, even on a blank line", () => {
    const t = prepareTarget("a\n\nb", { strictWhitespace: false });
    expect(t.some((c) => c.autoSkip)).toBe(false);
  });

  it("auto-skips a trailing whitespace-only line", () => {
    const t = prepareTarget("a\n   ", { strictWhitespace: false });
    expect(t.filter((c) => c.autoSkip).map((c) => c.index)).toEqual([2, 3, 4]);
  });

  it("returns an empty array for empty text", () => {
    expect(prepareTarget("", { strictWhitespace: false })).toEqual([]);
  });
});
