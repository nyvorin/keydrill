<script module lang="ts">
  import { LAYOUT } from "../layout/layout-data";
  import { buildReverseIndex, preferredRecipe, type Recipe } from "../layout/reverse-index";
  import { routeOverrides } from "../route-overrides.svelte";

  const INDEX = buildReverseIndex(LAYOUT);

  /** Preferred way to produce the expected key, or null when the board can't produce it. */
  export function recipeFor(expected: string | null): Recipe | null {
    if (!expected) return null;
    const recipes = INDEX.get(expected);
    return recipes && recipes.length > 0
      ? preferredRecipe(recipes, routeOverrides.map[expected] ?? null)
      : null;
  }

  function labelFor(expected: string | null): string {
    if (expected === null) return "—";
    if (expected === " ") return "Space";
    return expected;
  }
</script>

<script lang="ts">
  import KeyboardMap from "./KeyboardMap.svelte";
  import { holdKeyIds, recipeHint } from "../layout/reverse-index";
  import type { LayerId } from "../layout/types";

  let { nextExpected = null }: { nextExpected?: string | null } = $props();

  let collapsed = $state(false);

  let recipe = $derived(recipeFor(nextExpected));
  let layer: LayerId = $derived(recipe ? recipe.layer : "base");
  let highlightKeyIds = $derived(recipe ? [recipe.keyId] : []);
  let holdIds = $derived(recipe ? holdKeyIds(recipe) : []);
  let hint = $derived(recipe ? recipeHint(recipe) : "—");
  let label = $derived(labelFor(nextExpected));
</script>

<div class="mini-map" data-testid="mini-map">
  <button
    type="button"
    class="toggle"
    data-testid="minimap-toggle"
    aria-expanded={!collapsed}
    onclick={() => (collapsed = !collapsed)}
  >
    {collapsed ? "Show mini map" : "Hide mini map"}
  </button>

  {#if !collapsed}
    <KeyboardMap {layer} {highlightKeyIds} holdKeyIds={holdIds} mini={true} />
    <p class="hint">
      <span class="hint-key" data-testid="hint-key">{label}</span>
      <span class="hint-layer" data-testid="hint-layer">{layer}</span>
      <span data-testid="hint-text">{hint}</span>
    </p>
  {/if}
</div>

<style>
  .mini-map {
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #161b22;
    padding: 12px;
  }
  .toggle {
    display: block;
    margin: 0 0 8px auto;
    background: transparent;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #8b949e;
    font-size: 12px;
    padding: 3px 10px;
    cursor: pointer;
  }
  .toggle:hover {
    color: #c9d1d9;
    border-color: #22d3ee;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 0 0;
    color: #c9d1d9;
  }
  .hint-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 18px;
    padding: 2px 10px;
    border: 1px solid #22d3ee;
    border-radius: 6px;
    color: #22d3ee;
  }
  .hint-layer {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 11px;
    color: #f59e0b;
  }
</style>
