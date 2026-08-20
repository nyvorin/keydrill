<script lang="ts">
  import { onMount } from "svelte";
  import type { SkillStat } from "../lib/adaptive/ewma";
  import { getBackend } from "../lib/backend";
  import {
    GATE_ACCURACY,
    GATE_LATENCY_MS,
    STAGES,
    stageGate,
    type GateResult,
    type Stage,
  } from "../lib/curriculum/stages";
  import { LAYOUT } from "../lib/layout/layout-data";
  import { navigate } from "../lib/router";

  let stats = $state<SkillStat[]>([]);
  const backend = getBackend();

  let gateOpts = $state<{ minAccuracy?: number; maxMedianLatencyMs?: number }>({});

  const effectiveAccuracyPct = $derived(Math.round((gateOpts.minAccuracy ?? GATE_ACCURACY) * 100));
  const effectiveLatencyMs = $derived(gateOpts.maxMedianLatencyMs ?? GATE_LATENCY_MS);

  const gates = $derived(
    new Map<number, GateResult>(
      STAGES.map((s) => [s.id, stageGate(s.id, LAYOUT, stats, gateOpts)]),
    ),
  );

  onMount(async () => {
    stats = await backend.getSkillStats();
    const acc = await backend.getSetting("gates.accuracy");
    const lat = await backend.getSetting("gates.latencyMs");
    gateOpts = {
      minAccuracy: acc !== null ? Number(acc) / 100 : undefined,
      maxMedianLatencyMs: lat !== null ? Number(lat) : undefined,
    };
  });

  function open(stage: Stage, gate: GateResult): void {
    if (!gate.unlocked) return;
    navigate(stage.id === 7 ? "/code" : `/drill?stage=${stage.id}`);
  }

  function latencyLabel(ms: number): string {
    return Number.isFinite(ms) ? `${Math.round(ms)} ms` : "—";
  }
</script>

<h1>Train</h1>
<p class="gate-note" data-testid="gate-note">
  A stage unlocks at ≥{effectiveAccuracyPct}% accuracy and ≤{effectiveLatencyMs} ms median latency
  on the stage before it.
</p>

<ul class="stages">
  {#each STAGES as stage (stage.id)}
    {@const gate = gates.get(stage.id) ?? { unlocked: false, accuracy: 0, medianLatencyMs: 0 }}
    <li>
      <button
        class="stage-card"
        class:locked={!gate.unlocked}
        data-testid="stage-card-{stage.id}"
        disabled={!gate.unlocked}
        onclick={() => open(stage, gate)}
      >
        <span class="num">Stage {stage.id}</span>
        <span class="title">{stage.title}</span>
        <span class="state" data-testid="stage-state-{stage.id}">
          {gate.unlocked ? "Unlocked" : "Locked"}
        </span>
        <span class="gate" data-testid="stage-gate-{stage.id}">
          {(gate.accuracy * 100).toFixed(0)}% acc · {latencyLabel(gate.medianLatencyMs)} median
        </span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .gate-note {
    opacity: 0.7;
    margin-bottom: 1rem;
  }
  .stages {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }
  .stage-card {
    width: 100%;
    display: grid;
    grid-template-columns: 6rem 1fr 7rem;
    grid-template-areas: "num title state" "num gate state";
    gap: 0.15rem 1rem;
    align-items: center;
    text-align: left;
    padding: 0.9rem 1rem;
    border: 1px solid #30363d;
    border-radius: 10px;
    background: #161b22;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .stage-card:hover:not(:disabled) {
    border-color: #22d3ee;
  }
  .stage-card.locked {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .num {
    grid-area: num;
    color: #22d3ee;
  }
  .title {
    grid-area: title;
  }
  .state {
    grid-area: state;
    justify-self: end;
    color: #f59e0b;
  }
  .gate {
    grid-area: gate;
    opacity: 0.65;
    font-size: 0.85em;
  }
</style>
