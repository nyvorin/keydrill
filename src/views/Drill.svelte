<script lang="ts">
  import { onMount } from "svelte";
  import { generateDrillLine, mulberry32 } from "../lib/adaptive/generator";
  import { pickWeakSkills } from "../lib/adaptive/scheduler";
  import { getBackend } from "../lib/backend";
  import type { SessionMeta } from "../lib/backend/api";
  import MiniMap from "../lib/components/MiniMap.svelte";
  import TypingPane from "../lib/components/TypingPane.svelte";
  import { SHIKI_LANG, loadCorpus, type CorpusEntry } from "../lib/corpus";
  import { STAGES, stageSkills } from "../lib/curriculum/stages";
  import type { DrillSummary } from "../lib/engine/metrics";
  import type { KeystrokeLog } from "../lib/engine/typing-reducer";
  import { LAYOUT } from "../lib/layout/layout-data";
  import { skillVocabulary } from "../lib/layout/skills";
  import type { LayerId } from "../lib/layout/types";
  import { currentRoute } from "../lib/router";

  type Lang = CorpusEntry["lang"];

  const LANGS: Lang[] = ["js", "ts", "html", "css", "php", "rust", "go", "java", "kotlin", "sql"];

  /** Last-resort lines: used only if the corpus has no idioms for the chosen language. */
  const FIXED_LINES: Record<number, string> = {
    1: "the quick brown fox jumps over a lazy dog today",
    2: "A1 B2 C3 $ % ^ & * ( ) ! @ # totals were fine",
    3: "x = { a: [1], b: (2 + 3) }; y = [x] | z;",
    4: "7 + 8 = 15; 40 / 4 = 10; 91 - 6 = 85; 3 * 3",
    5: "nav drill: use the arrow keys, Home and End",
    6: "const xs = items.map((n) => n * 2).filter(Boolean);",
  };

  const LAYER_IDS: LayerId[] = ["base", "lower", "raise"];

  /** The named keys a navigation drill may ask for (spec §5, stage 5). */
  const NAV_KEY_NAMES = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ]);

  const backend = getBackend();
  const route = currentRoute();
  const stage = Number(route.query.get("stage") ?? "3");

  let seed = Date.now();
  let session: SessionMeta | null = null;

  let line = $state<string>("");
  let summary = $state<DrillSummary | null>(null);
  let nextChar = $state<string | null>(null);
  let codeLang = $state<Lang>("rust");

  const isNavStage = STAGES[stage - 1]?.drillKind === "nav";

  let navKeys = $state<string[] | null>(null);

  /** 12 named keys drawn from stage 5's own skills, deterministically shuffled by `seed`. */
  function buildNavKeys(): string[] {
    const wanted = new Set(stageSkills(5, LAYOUT));
    const pool: string[] = [];
    for (const key of LAYOUT.keys) {
      for (const layer of LAYER_IDS) {
        const name = key.output[layer]?.key;
        if (name === undefined || !NAV_KEY_NAMES.has(name)) continue;
        if (!wanted.has(`${layer}:${key.id}`)) continue;
        if (!pool.includes(name)) pool.push(name);
      }
    }
    if (pool.length === 0) return [];
    const out: string[] = [];
    while (out.length < 12) out.push(...pool);
    out.length = 12;
    const rng = mulberry32(seed);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  async function buildLine(): Promise<string> {
    if (isNavStage) {
      navKeys = buildNavKeys();
      return navKeys.join(" ");
    }
    if (stage >= 6) {
      const idioms = loadCorpus().idioms(codeLang);
      if (idioms.length === 0) return FIXED_LINES[6];
      const rng = mulberry32(seed);
      return idioms[Math.floor(rng() * idioms.length) % idioms.length].text;
    }
    const stats = await backend.getSkillStats();
    const stageIds = new Set(stageSkills(stage, LAYOUT));
    const all = skillVocabulary(LAYOUT);
    const vocab = all.filter((s) => stageIds.has(s.id));
    const weak = pickWeakSkills(stats, vocab.length > 0 ? vocab : all, 6);
    return generateDrillLine(weak, LAYOUT, mulberry32(seed));
  }

  async function reload(): Promise<void> {
    seed += 1;
    summary = null;
    nextChar = null;
    line = await buildLine();
  }

  onMount(async () => {
    session = await backend.startSession(
      stage >= 6 ? "code" : "drill",
      stage >= 6 ? codeLang : null,
    );
    line = await buildLine();
  });

  async function handleComplete(s: DrillSummary, logs: KeystrokeLog[]): Promise<void> {
    summary = s;
    if (!session) return;
    await backend.ingestKeystrokes(session.id, logs);
    await backend.endSession(session.id, s, false);
  }
</script>

<h1>Drill — stage {stage}</h1>

{#if stage >= 6}
  <label class="lang">
    Language
    <select data-testid="drill-lang" bind:value={codeLang} onchange={reload}>
      {#each LANGS as l (l)}
        <option value={l}>{l}</option>
      {/each}
    </select>
  </label>
{/if}

<MiniMap nextExpected={nextChar} />

{#if line}
  {#key line}
    <TypingPane
      text={line}
      lang={stage >= 6 ? SHIKI_LANG[codeLang] : "plain"}
      strictWhitespace={false}
      {navKeys}
      oncomplete={handleComplete}
      onprogress={(c) => (nextChar = c)}
    />
  {/key}
{:else}
  <p class="loading">Generating a drill…</p>
{/if}

{#if summary}
  <div class="summary" data-testid="drill-summary">
    <span><strong>{summary.wpm.toFixed(1)}</strong> WPM</span>
    <span><strong>{(summary.accuracy * 100).toFixed(1)}%</strong> accuracy</span>
    <span>{summary.errors} errors</span>
    <button onclick={reload}>Next line</button>
  </div>
{/if}

<style>
  .lang {
    display: inline-flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .loading {
    opacity: 0.6;
  }
  .summary {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    margin-top: 1.25rem;
    padding: 0.75rem 1rem;
    border: 1px solid #30363d;
    border-radius: 8px;
  }
  .summary strong {
    color: #22d3ee;
  }
</style>
