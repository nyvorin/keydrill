<script lang="ts">
  import { onMount } from "svelte";
  import { getBackend } from "../lib/backend";
  import type { DayState } from "../lib/backend/api";
  import { navigate } from "../lib/router";

  let day = $state<DayState | null>(null);

  onMount(async () => {
    day = await getBackend().getDayState();
  });
</script>

<h1>keydrill</h1>

<p class="streak">Streak <strong data-testid="streak">{day?.streak ?? 0}</strong> days</p>

{#if day?.sessionCompleted}
  <p class="done" data-testid="today-done">Done for today</p>
  <p class="hint">Free roam is always open — <a href="#/train">Train</a> or <a href="#/code">Code copy</a>.</p>
{:else}
  <button class="start" data-testid="start-session" onclick={() => navigate("/session")}>
    Start today's session
  </button>
  <p class="hint">Warmup → weak spots → one code snippet. About ten minutes.</p>
{/if}

<style>
  .streak strong {
    color: #f59e0b;
    font-size: 1.4em;
  }
  .start {
    padding: 0.8rem 1.4rem;
    font: inherit;
    font-size: 1.05rem;
    color: #0d1117;
    background: #22d3ee;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
  }
  .start:hover {
    filter: brightness(1.1);
  }
  .done {
    font-size: 1.2rem;
    color: #22d3ee;
  }
  .hint {
    opacity: 0.65;
  }
</style>
