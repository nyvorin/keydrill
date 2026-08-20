<script lang="ts">
  import MiniMap from "../lib/components/MiniMap.svelte";
  import TypingPane from "../lib/components/TypingPane.svelte";
  import { getBackend } from "../lib/backend";
  import type { SessionMeta } from "../lib/backend/api";
  import { LANG_IDS, SHIKI_LANG, loadCorpus, type CorpusEntry } from "../lib/corpus";
  import type { LangId } from "../lib/curriculum/stages";
  import type { DrillSummary } from "../lib/engine/metrics";
  import type { KeystrokeLog } from "../lib/engine/typing-reducer";

  const corpus = loadCorpus();
  const backend = getBackend();

  let lang = $state<LangId>("rust");
  let difficulty = $state<"easy" | "medium" | "hard">("easy");
  let index = $state(0);
  let summary = $state<DrillSummary | null>(null);
  let nextChar = $state<string | null>(null);
  let session: SessionMeta | null = null;

  const matches: CorpusEntry[] = $derived(corpus.snippets(lang, difficulty));
  const entry: CorpusEntry | null = $derived(
    matches.length === 0 ? null : (matches[index % matches.length] ?? null),
  );

  $effect(() => {
    const current = entry;
    if (current === null) return;
    summary = null;
    session = null;
    void backend.startSession("code", lang).then((meta) => {
      session = meta;
    });
  });

  function pickLang(value: string): void {
    lang = value as LangId;
    index = 0;
  }

  function pickDifficulty(value: string): void {
    difficulty = value as "easy" | "medium" | "hard";
    index = 0;
  }

  function nextSnippet(): void {
    if (matches.length === 0) return;
    index = (index + 1) % matches.length;
  }

  async function handleComplete(result: DrillSummary, logs: KeystrokeLog[]): Promise<void> {
    summary = result;
    if (session === null) return;
    await backend.ingestKeystrokes(session.id, logs);
    await backend.endSession(session.id, result, false);
  }
</script>

<h1>Code copy</h1>

<div class="controls">
  <label>
    Language
    <select data-testid="lang-picker" value={lang} onchange={(e) => pickLang(e.currentTarget.value)}>
      {#each LANG_IDS as id (id)}
        <option value={id}>{id}</option>
      {/each}
    </select>
  </label>

  <label>
    Difficulty
    <select
      data-testid="difficulty-picker"
      value={difficulty}
      onchange={(e) => pickDifficulty(e.currentTarget.value)}
    >
      <option value="easy">easy</option>
      <option value="medium">medium</option>
      <option value="hard">hard</option>
    </select>
  </label>

  <button data-testid="next-snippet" onclick={nextSnippet} disabled={matches.length < 2}>
    Next snippet
  </button>
</div>

{#if entry}
  <p class="tags" data-testid="snippet-tags">{entry.tags.join(" · ")}</p>
  {#key entry.text}
    <TypingPane
      text={entry.text}
      lang={SHIKI_LANG[lang]}
      oncomplete={handleComplete}
      onprogress={(n) => (nextChar = n)}
    />
  {/key}
  <MiniMap nextExpected={nextChar} />
{:else}
  <p data-testid="empty-corpus">No {lang} snippets at {difficulty} difficulty yet.</p>
{/if}

{#if summary}
  <div class="summary" data-testid="drill-summary">
    <span>{Math.round(summary.wpm)} WPM</span>
    <span>{Math.round(summary.accuracy * 100)}% accuracy</span>
  </div>
{/if}

<style>
  .controls {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8b949e;
  }
  select,
  button {
    padding: 0.35rem 0.6rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #161b22;
    color: #c9d1d9;
    font-size: 0.9rem;
  }
  button:disabled {
    opacity: 0.4;
  }
  .tags {
    margin: 0 0 0.5rem;
    color: #8b949e;
    font-size: 0.8rem;
  }
  .summary {
    display: flex;
    gap: 1.5rem;
    margin-top: 1rem;
    font-size: 1.25rem;
    color: #22d3ee;
  }
</style>
