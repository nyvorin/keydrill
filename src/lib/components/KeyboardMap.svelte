<script lang="ts">
  import { LAYOUT } from "../layout/layout-data";
  import type { LayerId } from "../layout/types";

  // Structurally identical to `HeatCell` in src/lib/backend/api.ts (created in Task 8).
  // Declared locally because api.ts does not exist yet; keep the field names in sync.
  interface HeatCell {
    keyId: string;
    layer: LayerId;
    errorRate: number;
    medianLatencyMs: number;
    samples: number;
  }

  let {
    layer,
    highlightKeyIds = [],
    holdKeyIds = [],
    heat = null,
    mini = false,
    onkeyclick = null,
  }: {
    layer: LayerId;
    highlightKeyIds?: string[];
    holdKeyIds?: string[];
    heat?: HeatCell[] | null;
    mini?: boolean;
    onkeyclick?: ((keyId: string) => void) | null;
  } = $props();

  const UNIT = 60; // px per 1u of the layout grid
  const SIZE = 54; // key square
  const GAP = 3; // inset inside the 60px cell

  let highlighted = $derived(new Set(highlightKeyIds));
  let held = $derived(new Set(holdKeyIds));
  let heatByKey = $derived(
    new Map((heat ?? []).filter((c) => c.layer === layer).map((c) => [c.keyId, c] as const))
  );

  function heatFill(keyId: string): string | undefined {
    const cell = heatByKey.get(keyId);
    if (!cell || cell.samples === 0) return undefined;
    const t = Math.max(0, Math.min(1, cell.errorRate));
    const r = Math.round(30 + t * 195);
    const g = Math.round(41 - t * 21);
    const b = Math.round(59 - t * 39);
    return `fill:rgb(${r},${g},${b})`;
  }

  function activate(keyId: string) {
    onkeyclick?.(keyId);
  }
</script>

<svg
  data-testid="keyboard-map"
  class="board"
  class:mini
  viewBox="0 0 960 420"
  aria-label={`${layer} layer keyboard map`}
>
  {#each LAYOUT.keys as key (key.id)}
    {@const cx = key.x * UNIT + UNIT / 2}
    {@const cy = key.y * UNIT + UNIT / 2}
    {@const legend = key.legends[layer] ?? ""}
    <g
      data-key-id={key.id}
      class:highlight={highlighted.has(key.id)}
      class:hold={held.has(key.id)}
      class:blank={legend === ""}
      transform={key.rot ? `rotate(${key.rot} ${cx} ${cy})` : undefined}
      role="button"
      tabindex="-1"
      aria-label={legend === "" ? key.id : `${key.id} ${legend}`}
      onclick={() => activate(key.id)}
      onkeydown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          activate(key.id);
        }
      }}
    >
      <rect
        x={key.x * UNIT + GAP}
        y={key.y * UNIT + GAP}
        width={SIZE}
        height={SIZE}
        rx="6"
        style={heatFill(key.id)}
      />
      <text
        x={cx}
        y={cy}
        text-anchor="middle"
        dominant-baseline="central"
        class:sm={legend.length > 3}
        class:xs={legend.length > 6}>{legend}</text
      >
    </g>
  {/each}
</svg>

<style>
  .board {
    display: block;
    width: 100%;
    max-width: 960px;
    height: auto;
    user-select: none;
  }
  .board.mini {
    max-width: 520px;
  }
  rect {
    fill: #161b22;
    stroke: #30363d;
    stroke-width: 1.5;
  }
  text {
    fill: #c9d1d9;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 15px;
    font-weight: 500;
    pointer-events: none;
  }
  text.sm {
    font-size: 11px;
  }
  text.xs {
    font-size: 8.5px;
  }
  g.blank rect {
    fill: #0f141a;
    stroke: #21262d;
  }
  g.blank text {
    fill: #4b5563;
  }
  g.highlight rect {
    fill: #0b3b45;
    stroke: #22d3ee;
    stroke-width: 2.5;
  }
  g.highlight text {
    fill: #22d3ee;
  }
  g.hold rect {
    fill: #43290a;
    stroke: #f59e0b;
    stroke-width: 2.5;
  }
  g.hold text {
    fill: #f59e0b;
  }
  g {
    cursor: pointer;
    outline: none;
  }
</style>
