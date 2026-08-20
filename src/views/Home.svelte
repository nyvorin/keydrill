<script lang="ts">
  import { onMount } from "svelte";
  import { getBackend } from "../lib/backend";
  import type { DayState } from "../lib/backend/api";
  import { navigate } from "../lib/router";

  const backend = getBackend();

  let day = $state<DayState | null>(null);
  let bannerDue = $state(false);

  onMount(async () => {
    day = await backend.getDayState();
    await refreshBanner();
  });

  async function refreshBanner(): Promise<void> {
    const today = await backend.getDayState();
    const enabled = (await backend.getSetting("reminder.enabled")) !== "false";
    const hour = Number((await backend.getSetting("reminder.hour")) ?? "9");
    const snoozedUntil = Number((await backend.getSetting("reminder.snoozedUntil")) ?? "0");
    bannerDue =
      enabled &&
      !today.sessionCompleted &&
      new Date().getHours() >= hour &&
      Date.now() >= snoozedUntil;
  }

  async function snoozeBanner(minutes: number): Promise<void> {
    await backend.setSetting("reminder.snoozedUntil", String(Date.now() + minutes * 60_000));
    bannerDue = false;
  }
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

{#if bannerDue}
  <div data-testid="reminder-banner" class="banner">
    <span>Time to train — 10 minutes keeps the streak.</span>
    <button onclick={() => navigate("/session")}>Start</button>
    <button data-testid="snooze-30" onclick={() => void snoozeBanner(30)}>30 min</button>
    <button data-testid="snooze-60" onclick={() => void snoozeBanner(60)}>1 hr</button>
    <button data-testid="snooze-360" onclick={() => void snoozeBanner(360)}>6 hrs</button>
  </div>
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
  .banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.5rem;
    padding: 0.75rem 1rem;
    border: 1px solid #f59e0b;
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.08);
  }
  .banner button {
    padding: 0.3rem 0.7rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #161b22;
    color: #c9d1d9;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .banner button:hover {
    border-color: #22d3ee;
  }
</style>
