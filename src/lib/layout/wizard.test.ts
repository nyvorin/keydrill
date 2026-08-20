import { describe, expect, it } from "vite-plus/test";
import { LAYOUT } from "./layout-data";
import {
  buildWizardPlan,
  describeOutput,
  isIgnoredKey,
  matchStep,
  reportJson,
  type Mismatch,
  type WizardStep,
} from "./wizard";

const plan = buildWizardPlan(LAYOUT);
const byId = (skillId: string): WizardStep | undefined => plan.find((s) => s.skillId === skillId);

describe("buildWizardPlan", () => {
  it("walks base first, then lower, then raise", () => {
    expect(plan[0].layer).toBe("base");
    const firstLower = plan.findIndex((s) => s.layer === "lower");
    const firstRaise = plan.findIndex((s) => s.layer === "raise");
    const lastBase = plan.map((s) => s.layer).lastIndexOf("base");
    expect(lastBase).toBeLessThan(firstLower);
    expect(firstLower).toBeLessThan(firstRaise);
  });

  it("covers every trainable pair and orders each layer by key id", () => {
    expect(plan.length).toBeGreaterThan(100);
    const baseIds = plan.filter((s) => s.layer === "base").map((s) => s.keyId);
    expect([...baseIds].sort()).toEqual(baseIds);
  });

  it("marks the Lower hold for lower-layer steps and no hold for base steps", () => {
    const brace = byId("lower:L35");
    expect(brace).toBeDefined();
    expect(brace?.expected).toBe("{");
    expect(brace?.hold).toBe("lower");
    const enter = byId("base:LT4");
    expect(enter?.expected).toBe("Enter");
    expect(enter?.hold).toBeNull();
  });

  it("carries the layer legend as the label and expects named keys verbatim", () => {
    expect(byId("lower:R11")?.label).toBe("P7");
    expect(byId("lower:R11")?.expected).toBe("7");
    expect(byId("raise:L00")?.expected).toBe("F12");
    expect(byId("base:RT4")?.expected).toBe(" ");
  });

  it("excludes modifier and system keys", () => {
    expect(plan.some((s) => s.keyId === "LT2")).toBe(false); // mod:Lower
    expect(byId("base:L30")).toBeUndefined(); // mod:Shift
    expect(byId("lower:L14")).toBeUndefined(); // sys:Boot
    expect(byId("raise:L21")).toBeUndefined(); // sys:Prev Track
  });
});

describe("isIgnoredKey / matchStep / describeOutput", () => {
  it("ignores bare modifiers only", () => {
    expect(isIgnoredKey("Shift")).toBe(true);
    expect(isIgnoredKey("Meta")).toBe(true);
    expect(isIgnoredKey("a")).toBe(false);
    expect(isIgnoredKey("Enter")).toBe(false);
  });

  it("matches exactly, case sensitively", () => {
    const step: WizardStep = {
      skillId: "base:L11",
      layer: "base",
      keyId: "L11",
      label: "Q",
      expected: "q",
      hold: null,
    };
    expect(matchStep(step, "q")).toBe(true);
    expect(matchStep(step, "Q")).toBe(false);
    expect(matchStep(step, "1")).toBe(false);
  });

  it("describes outputs for humans", () => {
    expect(describeOutput(" ")).toBe("Space");
    expect(describeOutput("{")).toBe('"{"');
    expect(describeOutput("Enter")).toBe("Enter");
  });
});

describe("reportJson", () => {
  it("summarises attempts, mismatches and skips", () => {
    const steps = plan.slice(0, 3);
    const mismatches: Mismatch[] = [
      {
        skillId: steps[1].skillId,
        layer: steps[1].layer,
        keyId: steps[1].keyId,
        expected: steps[1].expected,
        got: "x",
      },
    ];
    const parsed = JSON.parse(
      reportJson(
        "iris-class split 4x6+4",
        steps,
        mismatches,
        [steps[2].skillId],
        3,
        "2026-01-01T00:00:00.000Z",
      ),
    );
    expect(parsed.board).toBe("iris-class split 4x6+4");
    expect(parsed.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.total).toBe(3);
    expect(parsed.attempted).toBe(3);
    expect(parsed.verified).toBe(1);
    expect(parsed.mismatches).toHaveLength(1);
    expect(parsed.mismatches[0].got).toBe("x");
    expect(parsed.skipped).toEqual([steps[2].skillId]);
  });
});
