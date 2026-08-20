<script lang="ts">
  import { onMount } from "svelte";
  import { getBackend } from "../lib/backend";
  import type { SessionMeta } from "../lib/backend/api";
  import MiniMap from "../lib/components/MiniMap.svelte";
  import TypingPane from "../lib/components/TypingPane.svelte";
  import type { DrillSummary } from "../lib/engine/metrics";
  import type { KeystrokeLog } from "../lib/engine/typing-reducer";
  import { currentRoute } from "../lib/router";

  // Placeholder content until Task 11 swaps in the adaptive generator.
  const FIXED_LINES: Record<number, string> = {
    1: "the quick brown fox jumps over a lazy dog and it runs",
    2: "Ada & Bob paid $45 for 7 apples (12% off) at Market!",
    3: "x = { a: [1], b: (2 + 3) };",
    4: "sum = 7 + 8 + 9 - 4 * 5 / 6 + 1 + 2 + 3 + 0;",
    5: "nav home end pageup pagedown left right up down",
    6: "const xs = items.map((n) => n * 2);",
    7: "let name = user.map(|u| u.name).unwrap_or_default();",
  };

  const route = currentRoute();
  const requested = Number(route.query.get("stage"));
  const stage = FIXED_LINES[requested] ? requested : 3;
  const line = FIXED_LINES[stage];

  const backend = getBackend();
  let session: SessionMeta | null = null;

  let runId = $state(0);
  let summary = $state<DrillSummary | null>(null);
  let nextExpected = $state<string | null>(null);

  function startNewSession(): void {
    session = null;
    void backend.startSession("drill", null).then((meta) => {
      session = meta;
    });
  }

  onMount(() => {
    startNewSession();
  });

  async function handleComplete(s: DrillSummary, logs: KeystrokeLog[]): Promise<void> {
    summary = s;
    if (session === null) return;
    await backend.ingestKeystrokes(session.id, logs);
    await backend.endSession(session.id, s, false);
  }

  function handleProgress(key: string | null) {
    nextExpected = key;
  }

  function restart() {
    summary = null;
    runId += 1;
    // The previous session is already ended; a re-run is a new session.
    startNewSession();
  }
</script>

<section class="drill">
  <header>
    <h1>Drill</h1>
    <p class="stage-label" data-testid="stage-label">Stage {stage}</p>
  </header>

  {#key runId}
    <TypingPane text={line} lang="plain" oncomplete={handleComplete} onprogress={handleProgress} />
  {/key}

  <MiniMap {nextExpected} />

  {#if summary}
    <div class="summary" data-testid="drill-summary">
      <span data-testid="summary-wpm">{summary.wpm.toFixed(1)} WPM</span>
      <span data-testid="summary-accuracy">{(summary.accuracy * 100).toFixed(1)}% accuracy</span>
      <span data-testid="summary-errors">{summary.errors} errors</span>
      <button type="button" onclick={restart}>Run it again</button>
    </div>
  {/if}
</section>

<style>
  .drill {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 960px;
  }
  .stage-label {
    color: #8b949e;
    margin: 4px 0 0;
  }
  .summary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #161b22;
    font-variant-numeric: tabular-nums;
  }
  .summary button {
    margin-left: auto;
    background: #22d3ee;
    color: #0d1117;
    border: 0;
    border-radius: 6px;
    padding: 6px 12px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
