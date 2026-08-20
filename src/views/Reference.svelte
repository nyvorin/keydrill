<script lang="ts">
  import KeyboardMap from "../lib/components/KeyboardMap.svelte";
  import type { LayerId } from "../lib/layout/types";

  const TABS: ReadonlyArray<{ id: LayerId; label: string }> = [
    { id: "base", label: "Base" },
    { id: "lower", label: "Lower (Fn 1)" },
    { id: "raise", label: "Raise (Fn 2)" },
  ];

  let layer = $state<LayerId>("base");

  /** Spec §3: `1`/`2`/`3` switch layers. Task 4 adds `[data-testid="char-lookup"]` to this
   *  view, so the shortcut must stay out of the way while a text field has focus. */
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
        aria-pressed={layer === tab.id}
        onclick={() => (layer = tab.id)}>{tab.label}</button
      >
    {/each}
  </div>

  <KeyboardMap {layer} />
</section>

<style>
  .reference {
    padding: 1rem 1.5rem 2rem;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin: 0 0 1.25rem;
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
</style>
