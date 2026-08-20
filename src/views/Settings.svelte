<script lang="ts">
  import { onMount } from "svelte";
  import { getBackend } from "../lib/backend";
  import {
    buildReverseIndex,
    preferredRecipe,
    recipeHint,
    skillId,
    type Recipe,
  } from "../lib/layout/reverse-index";
  import { LAYOUT } from "../lib/layout/layout-data";
  import { routeOverrides, saveRouteOverride } from "../lib/route-overrides.svelte";
  import { navigate } from "../lib/router";

  const backend = getBackend();
  const LANGS = ["rotate", "js", "ts", "html", "css", "php", "rust", "go", "java", "kotlin", "sql"];
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  let strictWhitespace = $state(false);
  let gateAccuracy = $state(96);
  let gateLatency = $state(400);
  let reminderEnabled = $state(true);
  let reminderHour = $state(9);
  let sessionLang = $state("rotate");
  let autostartOn = $state(false);

  // Chars with more than one physical route — the only ones worth overriding.
  const index = buildReverseIndex(LAYOUT);
  const multiRoute: Array<{ ch: string; recipes: Recipe[] }> = [...index.entries()]
    .filter(([ch, recipes]) => ch.length === 1 && recipes.length > 1)
    .map(([ch, recipes]) => ({ ch, recipes }))
    .sort((a, b) => a.ch.localeCompare(b.ch));

  onMount(() => {
    void (async () => {
      strictWhitespace = (await backend.getSetting("typing.strictWhitespace")) === "true";
      gateAccuracy = Number((await backend.getSetting("gates.accuracy")) ?? "96");
      gateLatency = Number((await backend.getSetting("gates.latencyMs")) ?? "400");
      reminderEnabled = (await backend.getSetting("reminder.enabled")) !== "false";
      reminderHour = Number((await backend.getSetting("reminder.hour")) ?? "9");
      sessionLang = (await backend.getSetting("session.lang")) ?? "rotate";
      if (isTauri) {
        const { isEnabled } = await import("@tauri-apps/plugin-autostart");
        autostartOn = await isEnabled();
      }
    })();
  });

  function save(key: string, value: string): void {
    void backend.setSetting(key, value);
  }

  async function toggleAutostart(): Promise<void> {
    const { enable, disable } = await import("@tauri-apps/plugin-autostart");
    if (autostartOn) await enable();
    else await disable();
  }

  /** Composite `"layer:keyId"` — the same shape stored in `route.overrides` and rendered
   *  as each `<option value>`, so the `<select>` round-trips even for the ten chars that
   *  the same key produces on two layers (`(`, `!`, `@`, `#`, `$`, `%`, `^`, `&`, `*`, `)`). */
  function currentRouteFor(ch: string, recipes: Recipe[]): string {
    return routeOverrides.map[ch] ?? skillId(preferredRecipe(recipes));
  }
</script>

<h1>Settings</h1>

<section>
  <h2>Typing</h2>
  <label>
    <input
      type="checkbox"
      data-testid="strict-whitespace"
      bind:checked={strictWhitespace}
      onchange={() => save("typing.strictWhitespace", String(strictWhitespace))}
    />
    Strict whitespace (type leading indentation yourself)
  </label>
  <label>
    Session language
    <select
      data-testid="session-lang"
      bind:value={sessionLang}
      onchange={() => save("session.lang", sessionLang)}
    >
      {#each LANGS as l (l)}<option value={l}>{l}</option>{/each}
    </select>
  </label>
</section>

<section>
  <h2>Mastery gates</h2>
  <label>
    Accuracy %
    <input
      type="number"
      min="50"
      max="100"
      data-testid="gate-accuracy"
      bind:value={gateAccuracy}
      onchange={() => save("gates.accuracy", String(gateAccuracy))}
    />
  </label>
  <label>
    Median latency (ms)
    <input
      type="number"
      min="100"
      max="99999"
      data-testid="gate-latency"
      bind:value={gateLatency}
      onchange={() => save("gates.latencyMs", String(gateLatency))}
    />
  </label>
</section>

<section>
  <h2>Daily reminder</h2>
  <label>
    <input
      type="checkbox"
      data-testid="reminder-enabled"
      bind:checked={reminderEnabled}
      onchange={() => save("reminder.enabled", String(reminderEnabled))}
    />
    Remind me once a day
  </label>
  <label>
    Hour (0–23)
    <input
      type="number"
      min="0"
      max="23"
      data-testid="reminder-hour"
      bind:value={reminderHour}
      onchange={() => save("reminder.hour", String(reminderHour))}
    />
  </label>
  {#if isTauri}
    <label>
      <input
        type="checkbox"
        data-testid="autostart"
        bind:checked={autostartOn}
        onchange={() => void toggleAutostart()}
      />
      Launch keydrill at login (hidden in the menu bar)
    </label>
  {/if}
</section>

<section>
  <h2>Preferred routes</h2>
  <p>Characters reachable more than one way. Pick which route hints and drills should teach.</p>
  <table data-testid="route-overrides">
    <tbody>
      {#each multiRoute as row (row.ch)}
        <tr>
          <td><code>{row.ch}</code></td>
          <td>
            <select
              data-testid={`route-select-${row.ch}`}
              value={currentRouteFor(row.ch, row.recipes)}
              onchange={(e) =>
                void saveRouteOverride(row.ch, (e.currentTarget as HTMLSelectElement).value)}
            >
              {#each row.recipes as r (`${r.layer}:${r.keyId}`)}
                <option value={`${r.layer}:${r.keyId}`}>{r.layer}: {recipeHint(r)}</option>
              {/each}
            </select>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section>
  <h2>Layout</h2>
  <button onclick={() => navigate("/wizard")}>Run the layout verification wizard</button>
</section>

<style>
  section {
    margin-bottom: 1.75rem;
  }
  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8b949e;
    margin-bottom: 0.6rem;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  input[type="number"],
  select {
    padding: 0.3rem 0.5rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #161b22;
    color: #c9d1d9;
    font: inherit;
  }
  input[type="number"] {
    width: 6rem;
  }
  table {
    border-collapse: collapse;
  }
  td {
    padding: 0.15rem 0.75rem 0.15rem 0;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #22d3ee;
  }
  button {
    padding: 0.45rem 0.9rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #161b22;
    color: #c9d1d9;
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    border-color: #22d3ee;
  }
  p {
    opacity: 0.7;
  }
</style>
