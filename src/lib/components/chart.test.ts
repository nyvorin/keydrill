import { describe, expect, it } from "vite-plus/test";
import type { SkillStat } from "../adaptive/ewma";
import {
  latencySplit,
  niceBounds,
  toPoints,
  toPolyline,
  yFor,
  yTicks,
  type ChartGeom,
} from "./chart";

const FLAT: ChartGeom = {
  width: 100,
  height: 100,
  padLeft: 0,
  padRight: 0,
  padTop: 0,
  padBottom: 0,
};

describe("niceBounds", () => {
  it("pads both ends by 10% of the span", () => {
    expect(niceBounds([10, 20, 30], false)).toEqual({ min: 8, max: 32 });
  });

  it("floors at zero when asked and still pads the top", () => {
    expect(niceBounds([10, 20, 30], true)).toEqual({ min: 0, max: 33 });
  });

  it("returns a unit range for empty input", () => {
    expect(niceBounds([], false)).toEqual({ min: 0, max: 1 });
  });

  it("widens a degenerate range so the line is not flat against the frame", () => {
    expect(niceBounds([5, 5], false)).toEqual({ min: 4.9, max: 6.1 });
  });
});

describe("toPoints / toPolyline", () => {
  it("maps the first value to the left edge and the last to the right edge, y inverted", () => {
    expect(toPoints([0, 10], { min: 0, max: 10 }, FLAT)).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ]);
  });

  it("centres a single point", () => {
    expect(toPoints([5], { min: 0, max: 10 }, FLAT)).toEqual([{ x: 50, y: 50 }]);
  });

  it("serialises rounded pairs separated by spaces", () => {
    expect(toPolyline([0, 5, 10], { min: 0, max: 10 }, FLAT)).toBe("0,100 50,50 100,0");
  });

  it("returns an empty string for no values", () => {
    expect(toPolyline([], { min: 0, max: 1 }, FLAT)).toBe("");
  });
});

describe("yFor / yTicks", () => {
  it("places the maximum at the top pad and the minimum at the bottom", () => {
    expect(yFor(10, { min: 0, max: 10 }, FLAT)).toBe(0);
    expect(yFor(0, { min: 0, max: 10 }, FLAT)).toBe(100);
  });

  it("produces evenly spaced ticks inclusive of both bounds", () => {
    expect(yTicks({ min: 0, max: 100 }, 3)).toEqual([0, 50, 100]);
  });
});

describe("latencySplit", () => {
  const stats: SkillStat[] = [
    { skillId: "base:L11", ewmaError: 0.02, ewmaLatencyMs: 200, samples: 10 },
    { skillId: "lower:L35", ewmaError: 0.2, ewmaLatencyMs: 400, samples: 5 },
    { skillId: "raise:R00", ewmaError: 0.3, ewmaLatencyMs: 600, samples: 5 },
    { skillId: "lower:R11", ewmaError: 0.4, ewmaLatencyMs: 9999, samples: 0 },
  ];

  it("averages lower+raise against base, weighted by samples, ignoring zero-sample skills", () => {
    expect(latencySplit(stats)).toEqual({
      baseMs: 200,
      layerMs: 500,
      baseSamples: 10,
      layerSamples: 10,
    });
  });

  it("reports zeroes when there is nothing to average", () => {
    expect(latencySplit([])).toEqual({ baseMs: 0, layerMs: 0, baseSamples: 0, layerSamples: 0 });
  });
});
