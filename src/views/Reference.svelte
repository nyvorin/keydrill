<script lang="ts">
  import KeyboardMap from "../lib/components/KeyboardMap.svelte";
  import { LAYOUT } from "../lib/layout/layout-data";
  import {
    buildReverseIndex,
    holdKeyIds,
    preferredRecipe,
    recipeHint,
  } from "../lib/layout/reverse-index";
  import type { Recipe } from "../lib/layout/reverse-index";
  import type { LayerId } from "../lib/layout/types";
  import { routeOverrides } from "../lib/route-overrides.svelte";

  const TABS: ReadonlyArray<{ id: LayerId; label: string }> = [
    { id: "base", label: "Base" },
    { id: "lower", label: "Lower (Fn 1)" },
    { id: "raise", label: "Raise (Fn 2)" },
  ];

  const INDEX = buildReverseIndex(LAYOUT);

  let layer = $state<LayerId>("base");
  let query = $state("");

  let recipes: Recipe[] = $derived(query === "" ? [] : (INDEX.get(query) ?? []));
  let best: Recipe | null = $derived(
    recipes.length > 0 ? preferredRecipe(recipes, routeOverrides.map[query] ?? null) : null
  );
  /** Preferred route first, then the rest in board order. */
  let routes: Recipe[] = $derived(best === null ? [] : [best, ...recipes.filter((r) => r !== best)]);
  /** Only keys on the layer currently drawn — a keyId from another layer would glow wrongly. */
  let highlightIds: string[] = $derived(
    recipes.filter((r) => r.layer === layer).map((r) => r.keyId)
  );
  let matchLayers: Set<LayerId> = $derived(new Set(recipes.map((r) => r.layer)));
  let holdIds: string[] = $derived(best ? holdKeyIds(best) : []);
  let recipeText: string = $derived(
    query === ""
      ? "Type a character to see how to produce it."
      : best
        ? `${query} — ${recipeHint(best)}`
        : `No key on this layout produces "${query}".`
  );

  function setQuery(next: string) {
    query = next;
    const found = next === "" ? [] : (INDEX.get(next) ?? []);
    if (found.length > 0) layer = preferredRecipe(found, routeOverrides.map[next] ?? null).layer;
  }

  function handleInput(ev: Event) {
    const el = ev.currentTarget as HTMLInputElement;
    const ch = [...el.value].slice(-1).join("");
    el.value = ch;
    setQuery(ch);
  }

  function handleKeyClick(keyId: string) {
    const key = LAYOUT.keys.find((k) => k.id === keyId);
    const out = key?.output[layer];
    const produced = out?.char ?? out?.key ?? "";
    if (produced !== "") setQuery(produced);
  }

  /** Carried over from Task 3 — the guard now matters, because this view owns a text input. */
  function handleShortcut(ev: KeyboardEvent): void {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
    const index = ["1", "2", "3"].indexOf(ev.key);
    if (index === -1) return;
    layer = TABS[index].id;
  }
</script>

<svelte:window onkeydown={handleShortcut} />

<section class="reference">
  <h1>Reference</h1>

  <div class="tabs">
    {#each TABS as tab (tab.id)}
      <button
        type="button"
        data-testid={`layer-tab-${tab.id}`}
        class:active={layer === tab.id}
        class:has-match={matchLayers.has(tab.id)}
        aria-pressed={layer === tab.id}
        onclick={() => (layer = tab.id)}>{tab.label}</button
      >
    {/each}
  </div>

  <div class="lookup">
    <input
      data-testid="char-lookup"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder="Type a character…"
      aria-label="Character lookup"
      oninput={handleInput}
    />
    <p data-testid="recipe-text" class="recipe">{recipeText}</p>
  </div>

  <div class="board">
    <KeyboardMap
      {layer}
      highlightKeyIds={highlightIds}
      holdKeyIds={holdIds}
      onkeyclick={handleKeyClick}
    />

    {#if routes.length > 0}
      <ul class="routes" data-testid="route-list">
        {#each routes as r, i}
          <li data-testid="route-row" class:preferred={i === 0}>
            {r.layer}: {recipeHint(r)}{#if i === 0} — preferred{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .reference {
    padding: 1rem 1.5rem 2rem;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin: 0 0 1rem;
  }
  .tabs button {
    padding: 0.4rem 0.9rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #161b22;
    color: #c9d1d9;
    font: inherit;
    cursor: pointer;
  }
  .tabs button:hover {
    border-color: #4b5563;
  }
  .tabs button.active {
    border-color: #22d3ee;
    color: #22d3ee;
    box-shadow: inset 0 0 0 1px #22d3ee;
  }
  .tabs button.has-match {
    border-color: #f59e0b;
  }
  .lookup {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0 0 1.25rem;
  }
  .board {
    display: flex;
    align-items: flex-start;
    gap: 1.25rem;
    flex-wrap: wrap;
  }
  .routes {
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 14rem;
    color: #8b949e;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  .routes li {
    padding: 0.2rem 0;
  }
  .routes li.preferred {
    color: #22d3ee;
  }
  .lookup input {
    width: 3.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #0d1117;
    color: #c9d1d9;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 1.1rem;
    text-align: center;
  }
  .lookup input:focus {
    outline: none;
    border-color: #22d3ee;
  }
  .recipe {
    margin: 0;
    color: #8b949e;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
