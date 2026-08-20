<script lang="ts">
  import { onMount } from "svelte";
  import { getBackend } from "../lib/backend";
  import { SESSION_COUNT_KEY } from "../lib/backend/api";

  const backend = getBackend();
  let sessionCount = $state(0);
  let streak = $state(0);

  onMount(() => {
    void (async () => {
      sessionCount = Number((await backend.getSetting(SESSION_COUNT_KEY)) ?? "0");
      streak = (await backend.getDayState()).streak;
    })();
  });
</script>

<h1>Stats</h1>

<div class="cards">
  <div class="card">
    <span class="label">Sessions</span>
    <span class="value" data-testid="session-count">{sessionCount}</span>
  </div>
  <div class="card">
    <span class="label">Streak</span>
    <span class="value" data-testid="stats-streak">{streak}</span>
  </div>
</div>

<style>
  .cards {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 8rem;
    padding: 1rem 1.25rem;
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #161b22;
  }
  .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8b949e;
  }
  .value {
    font-size: 2rem;
    font-weight: 600;
    color: #22d3ee;
  }
</style>
