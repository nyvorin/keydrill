<script lang="ts">
  import { onMount } from "svelte";
  import { generateDrillLine, mulberry32 } from "../lib/adaptive/generator";
  import { pickWeakSkills } from "../lib/adaptive/scheduler";
  import { getBackend } from "../lib/backend";
  import type { SessionMeta } from "../lib/backend/api";
  import { SHIKI_LANG, loadCorpus } from "../lib/corpus";
  import MiniMap from "../lib/components/MiniMap.svelte";
  import TypingPane from "../lib/components/TypingPane.svelte";
  import type { LangId } from "../lib/curriculum/stages";
  import { stageSkills } from "../lib/curriculum/stages";
  import type { DrillSummary } from "../lib/engine/metrics";
  import { summarize } from "../lib/engine/metrics";
  import type { KeystrokeLog } from "../lib/engine/typing-reducer";
  import { LAYOUT } from "../lib/layout/layout-data";
  import { skillVocabulary } from "../lib/layout/skills";
  import { navigate } from "../lib/router";

  const PHASES = [
    { id: "warmup", label: "Warmup" },
    { id: "weak", label: "Weak spots" },
    { id: "code", label: "Code" },
  ] as const;

  const LANGS: LangId[] = ["js", "ts", "html", "css", "php", "rust", "go", "java", "kotlin", "sql"];

  const FALLBACK_SNIPPET = "const total = items.reduce((a, b) => a + b, 0);";

  const backend = getBackend();
  const seed = Date.now();

  let session: SessionMeta | null = null;
  let collected: KeystrokeLog[] = [];

  let items = $state<string[][]>([[], [], []]);
  let phaseIndex = $state(0);
  let lineIndex = $state(0);
  let done = $state(false);
  let streak = $state(0);
  let nextChar = $state<string | null>(null);
  let lang = $state<LangId>("rust");
  let strictWhitespace = $state(false);

  const ready = $derived(items[0].length > 0);
  const currentLine = $derived(items[phaseIndex]?.[lineIndex] ?? "");

  /** Day-of-year rotation so the code phase cycles through the languages by default. */
  function dayOfYear(d: Date): number {
    const start = Date.UTC(d.getFullYear(), 0, 0);
    const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor((today - start) / 86400000);
  }

  function sample(ids: string[], n: number, rng: () => number): string[] {
    if (ids.length <= n) return [...ids];
    const picked: string[] = [];
    const used = new Set<number>();
    while (picked.length < n) {
      const i = Math.floor(rng() * ids.length) % ids.length;
      if (used.has(i)) continue;
      used.add(i);
      picked.push(ids[i]);
    }
    return picked;
  }

  function pickSnippet(rng: () => number): string {
    const corpus = loadCorpus();
    const easy = corpus.snippets(lang, "easy");
    const pool = easy.length > 0 ? easy : corpus.byLang(lang);
    if (pool.length === 0) return FALLBACK_SNIPPET;
    return pool[Math.floor(rng() * pool.length) % pool.length].text;
  }

  async function build(): Promise<void> {
    const stats = await backend.getSkillStats();
    const stageIds = new Set([1, 2, 3, 4, 5].flatMap((id) => stageSkills(id, LAYOUT)));
    const all = skillVocabulary(LAYOUT);
    const vocab = all.filter((s) => stageIds.has(s.id));
    const pool = vocab.length > 0 ? vocab : all;
    const ids = pool.map((s) => s.id);
    const rng = mulberry32(seed);

    const warmup = [
      generateDrillLine(sample(ids, 6, rng), LAYOUT, rng),
      generateDrillLine(sample(ids, 6, rng), LAYOUT, rng),
    ];
    const weakIds = pickWeakSkills(stats, pool, 6);
    const weak = [generateDrillLine(weakIds, LAYOUT, rng), generateDrillLine(weakIds, LAYOUT, rng)];
    items = [warmup, weak, [pickSnippet(rng)]];
  }

  onMount(async () => {
    strictWhitespace = (await backend.getSetting("typing.strictWhitespace")) === "true";
    const saved = await backend.getSetting("session.lang");
    lang =
      saved && (LANGS as string[]).includes(saved)
        ? (saved as LangId)
        : LANGS[dayOfYear(new Date()) % LANGS.length];
    session = await backend.startSession("session", lang);
    await build();
  });

  async function finish(): Promise<void> {
    done = true;
    if (session) await backend.endSession(session.id, summarize(collected), true);
    streak = (await backend.getDayState()).streak;
  }

  async function handleComplete(_summary: DrillSummary, logs: KeystrokeLog[]): Promise<void> {
    collected = [...collected, ...logs];
    if (session) await backend.ingestKeystrokes(session.id, logs);
    nextChar = null;
    if (lineIndex + 1 < items[phaseIndex].length) {
      lineIndex += 1;
    } else if (phaseIndex + 1 < PHASES.length) {
      phaseIndex += 1;
      lineIndex = 0;
    } else {
      await finish();
    }
  }
</script>

<h1>Today's session</h1>

{#if done}
  <div class="done" data-testid="session-done">
    <h2>Done for today</h2>
    <p>Streak <strong data-testid="streak">{streak}</strong> days</p>
    <button onclick={() => navigate("/")}>Back home</button>
  </div>
{:else if ready}
  <p class="phase" data-testid="phase">{PHASES[phaseIndex].label}</p>
  <p class="progress">
    Line {lineIndex + 1} of {items[phaseIndex].length} · {lang}
  </p>
  <span class="target" data-testid="session-target" hidden>{currentLine}</span>

  <MiniMap nextExpected={nextChar} />

  {#key currentLine}
    <TypingPane
      text={currentLine}
      lang={phaseIndex === 2 ? SHIKI_LANG[lang] : "plain"}
      {strictWhitespace}
      oncomplete={handleComplete}
      onprogress={(c) => (nextChar = c)}
    />
  {/key}
{:else}
  <p class="loading">Preparing your session…</p>
{/if}

<style>
  .phase {
    font-size: 1.2rem;
    color: #22d3ee;
    margin-bottom: 0.15rem;
  }
  .progress {
    opacity: 0.65;
    margin-top: 0;
  }
  .loading {
    opacity: 0.6;
  }
  .done h2 {
    color: #22d3ee;
  }
  .done strong {
    color: #f59e0b;
  }
</style>
