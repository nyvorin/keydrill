<script lang="ts">
  import { onMount } from "svelte";
  import type { SkillStat } from "../lib/adaptive/ewma";
  import { MIN_SAMPLES } from "../lib/adaptive/scheduler";
  import { getBackend } from "../lib/backend";
  import type { DayState, HeatCell, LatencyTrendPoint, TrendPoint } from "../lib/backend/api";
  import { SESSION_COUNT_KEY } from "../lib/backend/api";
  import Calendar from "../lib/components/Calendar.svelte";
  import {
    CHART_GEOM,
    latencySplit,
    niceBounds,
    toPoints,
    toPolyline,
    yFor,
    yTicks,
  } from "../lib/components/chart";
  import KeyboardMap from "../lib/components/KeyboardMap.svelte";
  import StatCard from "../lib/components/StatCard.svelte";
  import { GATE_ACCURACY, GATE_LATENCY_MS } from "../lib/curriculum/stages";
  import { LAYOUT } from "../lib/layout/layout-data";
  import { skillVocabulary } from "../lib/layout/skills";
  import type { LayerId } from "../lib/layout/types";

  const backend = getBackend();

  let trends = $state<TrendPoint[]>([]);
  let skills = $state<SkillStat[]>([]);
  let heat = $state<HeatCell[]>([]);
  let heatLayer = $state<LayerId>("base");
  let streak = $state(0);
  let sessionCount = $state(0);
  let loaded = $state(false);
  let recentDays = $state<DayState[]>([]);
  let latencyTrend = $state<LatencyTrendPoint[]>([]);
  let trendMode = $state<"all" | "code">("all");

  const MASTERY_LAYERS: LayerId[] = ["base", "lower", "raise"];

  /** A day with no samples on one side carries the previous value forward so the two
   *  series stay index-aligned; leading gaps take the first real value. */
  function fillGaps(values: Array<number | null>): number[] {
    const firstReal = values.find((v) => v !== null);
    if (firstReal === undefined || firstReal === null) return [];
    let last: number = firstReal;
    return values.map((v) => {
      if (v !== null) last = v;
      return last;
    });
  }

  const latencyBaseValues = $derived(fillGaps(latencyTrend.map((p) => p.baseMs)));
  const latencyLayerValues = $derived(fillGaps(latencyTrend.map((p) => p.layerMs)));
  const latencyBounds = $derived(niceBounds([...latencyBaseValues, ...latencyLayerValues], false));
  const latencyBaseLine = $derived(toPolyline(latencyBaseValues, latencyBounds, CHART_GEOM));
  const latencyLayerLine = $derived(toPolyline(latencyLayerValues, latencyBounds, CHART_GEOM));
  const latencyBasePoints = $derived(toPoints(latencyBaseValues, latencyBounds, CHART_GEOM));
  const latencyLayerPoints = $derived(toPoints(latencyLayerValues, latencyBounds, CHART_GEOM));
  const hasLatencyCurve = $derived(latencyBaseValues.length > 0 && latencyLayerValues.length > 0);

  const wpmValues = $derived(trends.map((t) => t.wpm));
  const accValues = $derived(trends.map((t) => t.accuracy * 100));
  const wpmBounds = $derived(niceBounds(wpmValues, false));
  const accBounds = $derived(niceBounds(accValues, false));
  const wpmLine = $derived(toPolyline(wpmValues, wpmBounds, CHART_GEOM));
  const accLine = $derived(toPolyline(accValues, accBounds, CHART_GEOM));
  const wpmPoints = $derived(toPoints(wpmValues, wpmBounds, CHART_GEOM));
  const accPoints = $derived(toPoints(accValues, accBounds, CHART_GEOM));
  const split = $derived(latencySplit(skills));
  const latencyMax = $derived(Math.max(split.baseMs, split.layerMs, 1));

  const LAYERS: Array<{ id: LayerId; label: string }> = [
    { id: "base", label: "Base" },
    { id: "lower", label: "Lower (Fn 1)" },
    { id: "raise", label: "Raise (Fn 2)" },
  ];

  async function showLayer(layer: LayerId): Promise<void> {
    heatLayer = layer;
    heat = await backend.getHeatmap(layer);
  }

  function pct(n: number): string {
    return `${(n * 100).toFixed(1)}%`;
  }

  /** Mastery per layer, using exactly the rule the stage gates use. */
  function layerProgress(layer: LayerId): { mastered: number; total: number; pct: number } {
    const byId = new Map(skills.map((s) => [s.skillId, s]));
    const vocab = skillVocabulary(LAYOUT).filter((s) => s.layer === layer);
    let mastered = 0;
    for (const skill of vocab) {
      const stat = byId.get(skill.id);
      if (stat === undefined) continue;
      if (
        stat.samples >= MIN_SAMPLES &&
        1 - stat.ewmaError >= GATE_ACCURACY &&
        stat.ewmaLatencyMs <= GATE_LATENCY_MS
      ) {
        mastered += 1;
      }
    }
    const total = vocab.length;
    return { mastered, total, pct: total === 0 ? 0 : Math.round((mastered / total) * 100) };
  }

  async function toggleTrendMode(): Promise<void> {
    trendMode = trendMode === "code" ? "all" : "code";
    trends = await backend.getTrends(30, trendMode === "code" ? "code" : undefined);
  }

  /** Ride the end label just above the last point, clamped inside the plot frame. */
  function labelY(lastY: number): number {
    const top = CHART_GEOM.padTop + 10;
    const bottom = CHART_GEOM.height - CHART_GEOM.padBottom - 4;
    return Math.min(Math.max(lastY - 10, top), bottom);
  }

  onMount(() => {
    void (async () => {
      const [t, s, day, total, days, latency] = await Promise.all([
        backend.getTrends(30),
        backend.getSkillStats(),
        backend.getDayState(),
        backend.getSetting(SESSION_COUNT_KEY),
        backend.getRecentDays(35),
        backend.getLatencyTrend(30),
      ]);
      trends = t;
      skills = s;
      streak = day.streak;
      sessionCount = total === null ? 0 : Number(total);
      recentDays = days;
      latencyTrend = latency;
      await showLayer("base");
      loaded = true;
    })();
  });
</script>

<h1>Stats</h1>

{#if !loaded}
  <p data-testid="stats-loading">Loading…</p>
{:else}
  <div class="cards">
    <StatCard testid="streak" label="Streak" value={String(streak)} sub="days in a row" />
    <StatCard testid="session-count" label="Sessions" value={String(sessionCount)} sub="all time" />
    <StatCard
      testid="wpm-latest"
      label="WPM"
      value={trends.length ? trends[trends.length - 1].wpm.toFixed(1) : "—"}
      sub="latest day"
    />
    <StatCard
      testid="accuracy-latest"
      label="Accuracy"
      value={trends.length ? pct(trends[trends.length - 1].accuracy) : "—"}
      sub="latest day"
    />
  </div>

  <section class="panel">
    <h2>This month</h2>
    <Calendar days={recentDays} />
    <p class="caption">Cyan days are completed sessions; the orange outline is today.</p>
  </section>

  {#if trends.length === 0}
    <p data-testid="stats-empty">
      No finished sessions yet — complete a drill to start your history.
    </p>
  {:else}
    <section class="panel">
      <h2>Words per minute · last {trends.length} days</h2>
      <button
        class="mode-toggle"
        class:active={trendMode === "code"}
        data-testid="trend-mode-code"
        onclick={() => void toggleTrendMode()}
      >
        {trendMode === "code" ? "Showing code sessions" : "Code sessions only"}
      </button>
      <svg
        data-testid="wpm-trend"
        viewBox="0 0 {CHART_GEOM.width} {CHART_GEOM.height}"
        role="img"
        aria-label="Words per minute per day, {trends[0].date} to {trends[trends.length - 1].date}"
      >
        {#each yTicks(wpmBounds, 3) as tick}
          <line
            class="grid"
            x1={CHART_GEOM.padLeft}
            x2={CHART_GEOM.width - CHART_GEOM.padRight}
            y1={yFor(tick, wpmBounds, CHART_GEOM)}
            y2={yFor(tick, wpmBounds, CHART_GEOM)}
          />
          <text class="tick" x="4" y={yFor(tick, wpmBounds, CHART_GEOM) + 4}>{Math.round(tick)}</text
          >
        {/each}
        <polyline class="line wpm" points={wpmLine} />
        {#each wpmPoints as p, i}
          <circle class="hit" cx={p.x} cy={p.y} r="7"
            ><title>{trends[i].date}: {trends[i].wpm.toFixed(1)} wpm</title></circle
          >
        {/each}
        <circle
          class="dot wpm"
          cx={wpmPoints[wpmPoints.length - 1].x}
          cy={wpmPoints[wpmPoints.length - 1].y}
          r="4"
        />
        <text
          class="value"
          x={CHART_GEOM.width - CHART_GEOM.padRight}
          y={labelY(wpmPoints[wpmPoints.length - 1].y)}
          text-anchor="end">{trends[trends.length - 1].wpm.toFixed(1)} wpm</text
        >
        <text class="tick" x={CHART_GEOM.padLeft} y={CHART_GEOM.height - 6}>{trends[0].date}</text>
        <text
          class="tick"
          x={CHART_GEOM.width - CHART_GEOM.padRight}
          y={CHART_GEOM.height - 6}
          text-anchor="end">{trends[trends.length - 1].date}</text
        >
      </svg>
    </section>

    <section class="panel">
      <h2>Accuracy · last {trends.length} days</h2>
      <svg
        data-testid="accuracy-trend"
        viewBox="0 0 {CHART_GEOM.width} {CHART_GEOM.height}"
        role="img"
        aria-label="Accuracy percentage per day, {trends[0].date} to {trends[trends.length - 1]
          .date}"
      >
        {#each yTicks(accBounds, 3) as tick}
          <line
            class="grid"
            x1={CHART_GEOM.padLeft}
            x2={CHART_GEOM.width - CHART_GEOM.padRight}
            y1={yFor(tick, accBounds, CHART_GEOM)}
            y2={yFor(tick, accBounds, CHART_GEOM)}
          />
          <text class="tick" x="4" y={yFor(tick, accBounds, CHART_GEOM) + 4}
            >{Math.round(tick)}%</text
          >
        {/each}
        <polyline class="line acc" points={accLine} />
        {#each accPoints as p, i}
          <circle class="hit" cx={p.x} cy={p.y} r="7"
            ><title>{trends[i].date}: {pct(trends[i].accuracy)}</title></circle
          >
        {/each}
        <circle
          class="dot acc"
          cx={accPoints[accPoints.length - 1].x}
          cy={accPoints[accPoints.length - 1].y}
          r="4"
        />
        <text
          class="value"
          x={CHART_GEOM.width - CHART_GEOM.padRight}
          y={labelY(accPoints[accPoints.length - 1].y)}
          text-anchor="end">{pct(trends[trends.length - 1].accuracy)}</text
        >
        <text class="tick" x={CHART_GEOM.padLeft} y={CHART_GEOM.height - 6}>{trends[0].date}</text>
        <text
          class="tick"
          x={CHART_GEOM.width - CHART_GEOM.padRight}
          y={CHART_GEOM.height - 6}
          text-anchor="end">{trends[trends.length - 1].date}</text
        >
      </svg>
    </section>
  {/if}

  <section class="panel" data-testid="latency-split">
    <h2>Layer-chord vs base latency</h2>
    <div class="bar-row">
      <span class="bar-label">Base</span>
      <span class="bar-track"
        ><span class="bar base" style="width: {(split.baseMs / latencyMax) * 100}%"></span></span
      >
      <span class="bar-value" data-testid="latency-base">{Math.round(split.baseMs)} ms</span>
    </div>
    <div class="bar-row">
      <span class="bar-label">Lower / Raise</span>
      <span class="bar-track"
        ><span class="bar layer" style="width: {(split.layerMs / latencyMax) * 100}%"></span></span
      >
      <span class="bar-value" data-testid="latency-layer">{Math.round(split.layerMs)} ms</span>
    </div>
    <p class="caption">
      Layer chords cost {Math.round(split.layerMs - split.baseMs)} ms more per keystroke ({split.layerSamples}
      chord samples vs {split.baseSamples} base samples).
    </p>
  </section>

  <section class="panel">
    <h2>Layer progress</h2>
    {#each MASTERY_LAYERS as layer (layer)}
      {@const info = layerProgress(layer)}
      <div data-testid={`layer-progress-${layer}`} class="progress-row">
        <span class="progress-label">{layer}</span>
        <span class="bar-track"><span class="bar fill" style="width: {info.pct}%"></span></span>
        <span class="bar-value">{info.mastered}/{info.total} mastered</span>
      </div>
    {/each}
    <p class="caption">
      Mastered = ≥{MIN_SAMPLES} samples, ≥{Math.round(GATE_ACCURACY * 100)}% accuracy and ≤{GATE_LATENCY_MS}
      ms median latency — the same rule the stage gates use.
    </p>
  </section>

  <section class="panel">
    <h2>Latency trajectory · base vs layer chords</h2>
    {#if hasLatencyCurve}
      <svg
        data-testid="latency-trend"
        viewBox="0 0 {CHART_GEOM.width} {CHART_GEOM.height}"
        role="img"
        aria-label="Median keystroke latency per day, base keys versus layer chords"
      >
        {#each yTicks(latencyBounds, 3) as tick}
          <line
            class="grid"
            x1={CHART_GEOM.padLeft}
            x2={CHART_GEOM.width - CHART_GEOM.padRight}
            y1={yFor(tick, latencyBounds, CHART_GEOM)}
            y2={yFor(tick, latencyBounds, CHART_GEOM)}
          />
          <text class="tick" x="4" y={yFor(tick, latencyBounds, CHART_GEOM) + 4}
            >{Math.round(tick)}</text
          >
        {/each}
        <polyline class="line lat-base" data-testid="latency-trend-base" points={latencyBaseLine} />
        <polyline
          class="line lat-layer"
          data-testid="latency-trend-layer"
          points={latencyLayerLine}
        />
        <text
          class="value lat-base"
          x={latencyBasePoints[latencyBasePoints.length - 1].x - 4}
          y={latencyBasePoints[latencyBasePoints.length - 1].y - 6}
          text-anchor="end">base</text
        >
        <text
          class="value lat-layer"
          x={latencyLayerPoints[latencyLayerPoints.length - 1].x - 4}
          y={latencyLayerPoints[latencyLayerPoints.length - 1].y - 6}
          text-anchor="end">layer chords</text
        >
      </svg>
      <p class="caption">{latencyTrend[0].date} → {latencyTrend[latencyTrend.length - 1].date}</p>
    {:else}
      <p data-testid="latency-trend-empty">Not enough keystrokes yet to plot a trajectory.</p>
    {/if}
  </section>

  <section class="panel">
    <h2>Keyboard heatmap</h2>
    <div class="tabs" role="group" aria-label="Heatmap layer">
      {#each LAYERS as l}
        <button
          data-testid="heat-layer-{l.id}"
          class:active={heatLayer === l.id}
          onclick={() => void showLayer(l.id)}>{l.label}</button
        >
      {/each}
    </div>
    <KeyboardMap layer={heatLayer} {heat} />
    <p class="caption">Redder keys have a higher error rate on the selected layer.</p>
  </section>
{/if}

<style>
  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .panel {
    margin-bottom: 1.5rem;
    padding: 1rem;
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #161b22;
  }
  .panel h2 {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #8b949e;
  }
  svg {
    display: block;
    width: 100%;
    max-width: 640px;
    height: auto;
  }
  .grid {
    stroke: #30363d;
    stroke-width: 1;
  }
  .tick {
    fill: #8b949e;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .line.wpm {
    stroke: #22d3ee;
  }
  .line.acc {
    stroke: #7ee787;
  }
  /* End marker: >=8px across, with a 2px surface ring so it stays legible on the line. */
  .dot {
    stroke: #161b22;
    stroke-width: 2;
  }
  .dot.wpm {
    fill: #22d3ee;
  }
  .dot.acc {
    fill: #7ee787;
  }
  .hit {
    fill: transparent;
    pointer-events: all;
  }
  /* Values wear text ink, never the series hue — the coloured end dot carries identity. */
  .value {
    fill: #c9d1d9;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .caption {
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    color: #8b949e;
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .bar-label {
    width: 8rem;
    font-size: 0.8rem;
    color: #8b949e;
  }
  .bar-track {
    flex: 1;
    height: 14px;
    border-radius: 7px;
    background: #0d1117;
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    border-radius: 7px;
  }
  .bar.base {
    background: #22d3ee;
  }
  .bar.layer {
    background: #f59e0b;
  }
  .bar-value {
    width: 5rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .mode-toggle {
    margin-bottom: 0.6rem;
    padding: 0.25rem 0.6rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #0d1117;
    color: #8b949e;
    cursor: pointer;
  }
  .mode-toggle.active {
    border-color: #22d3ee;
    color: #c9d1d9;
  }
  .progress-row {
    display: grid;
    grid-template-columns: 5rem 1fr 9rem;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .progress-label {
    color: #8b949e;
    text-transform: capitalize;
  }
  /* The grid column already sizes this cell — drop the flex-row's fixed width. */
  .progress-row .bar-value {
    width: auto;
    text-align: left;
    font-size: 0.8rem;
  }
  .bar.fill {
    background: #22d3ee;
  }
  .line.lat-base,
  .value.lat-base {
    stroke: #22d3ee;
    fill: #22d3ee;
  }
  .line.lat-layer,
  .value.lat-layer {
    stroke: #f59e0b;
    fill: #f59e0b;
  }
  .value.lat-base,
  .value.lat-layer {
    stroke: none;
    font-size: 10px;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .tabs button {
    padding: 0.35rem 0.75rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #0d1117;
    color: #c9d1d9;
    cursor: pointer;
  }
  .tabs button.active {
    border-color: #22d3ee;
    color: #22d3ee;
  }
</style>
