import type { SkillStat } from "../adaptive/ewma";

export interface ChartGeom {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

/** Default frame for the stats trend charts (viewBox units). */
export const CHART_GEOM: ChartGeom = {
  width: 480,
  height: 160,
  padLeft: 40,
  padRight: 12,
  padTop: 12,
  padBottom: 24,
};

export interface Bounds {
  min: number;
  max: number;
}

export interface ChartPoint {
  x: number;
  y: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function niceBounds(values: number[], floorAtZero: boolean): Bounds {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = floorAtZero ? 0 : Math.min(...values);
  let max = Math.max(...values);
  if (max <= min) max = min + 1;
  const pad = (max - min) * 0.1;
  if (!floorAtZero) min = round2(min - pad);
  max = round2(max + pad);
  return { min, max };
}

export function yFor(value: number, bounds: Bounds, geom: ChartGeom): number {
  const plotHeight = geom.height - geom.padTop - geom.padBottom;
  const span = bounds.max - bounds.min || 1;
  return round2(geom.padTop + plotHeight - ((value - bounds.min) / span) * plotHeight);
}

export function toPoints(values: number[], bounds: Bounds, geom: ChartGeom): ChartPoint[] {
  const plotWidth = geom.width - geom.padLeft - geom.padRight;
  const last = values.length - 1;
  return values.map((value, i) => ({
    x: round2(geom.padLeft + (last <= 0 ? plotWidth / 2 : (plotWidth * i) / last)),
    y: yFor(value, bounds, geom),
  }));
}

export function toPolyline(values: number[], bounds: Bounds, geom: ChartGeom): string {
  return toPoints(values, bounds, geom)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
}

export function yTicks(bounds: Bounds, count: number): number[] {
  if (count < 2) return [bounds.min];
  const step = (bounds.max - bounds.min) / (count - 1);
  return Array.from({ length: count }, (_, i) => round2(bounds.min + step * i));
}

export interface LatencySplit {
  baseMs: number;
  layerMs: number;
  baseSamples: number;
  layerSamples: number;
}

/** Layer-chord (lower/raise) vs base keystroke latency, sample-weighted. */
export function latencySplit(stats: SkillStat[]): LatencySplit {
  let baseTotal = 0;
  let baseSamples = 0;
  let layerTotal = 0;
  let layerSamples = 0;
  for (const s of stats) {
    if (s.samples <= 0) continue;
    if (s.skillId.startsWith("lower:") || s.skillId.startsWith("raise:")) {
      layerTotal += s.ewmaLatencyMs * s.samples;
      layerSamples += s.samples;
    } else if (s.skillId.startsWith("base:")) {
      baseTotal += s.ewmaLatencyMs * s.samples;
      baseSamples += s.samples;
    }
  }
  return {
    baseMs: baseSamples > 0 ? baseTotal / baseSamples : 0,
    layerMs: layerSamples > 0 ? layerTotal / layerSamples : 0,
    baseSamples,
    layerSamples,
  };
}
