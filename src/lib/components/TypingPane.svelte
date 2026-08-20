<script module lang="ts">
  import { LAYOUT } from "../layout/layout-data";
  import { buildReverseIndex, preferredRecipe, skillId } from "../layout/reverse-index";
  import { PLAIN_COLOR } from "../highlight";

  const INDEX = buildReverseIndex(LAYOUT);

  /** Skill being trained by the expected key ('Enter', '{', 'a'…); null when the board can't produce it. */
  export function skillOfKey(expected: string): string | null {
    const recipes = INDEX.get(expected);
    if (!recipes || recipes.length === 0) return null;
    return skillId(preferredRecipe(recipes));
  }

  /** Flattens highlighter rows to one color per target index; falls back to plain on any mismatch. */
  function colorsFor(rows: { char: string; color: string }[][], src: string): string[] {
    const out: string[] = [];
    rows.forEach((row, i) => {
      for (const cell of row) out.push(cell.color);
      if (i < rows.length - 1) out.push(PLAIN_COLOR);
    });
    return out.length === src.length ? out : Array.from({ length: src.length }, () => PLAIN_COLOR);
  }

  const HANDLED_KEYS = new Set([
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Escape",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ]);
</script>

<script lang="ts">
  import { prepareNavTarget, prepareTarget } from "../engine/target";
  import {
    expectedKeyFor,
    initTyping,
    nextExpectedIndex,
    reduceKey,
    type KeystrokeLog,
    type TypingState,
  } from "../engine/typing-reducer";
  import { summarize, type DrillSummary } from "../engine/metrics";
  import { highlightTokens } from "../highlight";

  let {
    text,
    lang = "plain",
    strictWhitespace = false,
    navKeys = null,
    oncomplete,
    onprogress = null,
  }: {
    text: string;
    lang?: string;
    strictWhitespace?: boolean;
    navKeys?: string[] | null;
    oncomplete: (summary: DrillSummary, logs: KeystrokeLog[]) => void;
    onprogress?: ((nextExpected: string | null) => void) | null;
  } = $props();

  let paneEl: HTMLDivElement | null = $state(null);
  let state = $state<TypingState>(initTyping());
  let colors = $state<string[]>([]);
  // Deliberately non-reactive: nothing renders the raw log, and the completion callback wants a plain array.
  let logs: KeystrokeLog[] = [];
  let completed = false;

  // Nav mode: the target is a list of named keys, and `text`/`lang`/`strictWhitespace` are ignored.
  let isNav = $derived(navKeys !== null && navKeys.length > 0);
  let target = $derived(
    navKeys !== null && navKeys.length > 0
      ? prepareNavTarget(navKeys)
      : prepareTarget(text, { strictWhitespace }),
  );
  let cursorIndex = $derived(nextExpectedIndex(state, target));
  let nextExpected = $derived(
    cursorIndex < target.length ? expectedKeyFor(target[cursorIndex].ch) : null,
  );

  // Reset whenever the drill content (or whitespace policy) changes.
  $effect(() => {
    void text;
    void navKeys;
    void strictWhitespace;
    state = initTyping();
    logs = [];
    completed = false;
  });

  // Syntax colors arrive asynchronously; until then every char renders plain.
  // Nav pills are never syntax-highlighted.
  $effect(() => {
    const src = text;
    const language = lang;
    const nav = isNav;
    let cancelled = false;
    colors = [];
    if (nav) return;
    void highlightTokens(src, language).then((rows) => {
      if (!cancelled) colors = colorsFor(rows, src);
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    paneEl?.focus();
  });

  $effect(() => {
    const key = nextExpected;
    onprogress?.(key);
  });

  function classFor(i: number): string {
    if (state.errorAt === i) return "cursor error";
    if (i === cursorIndex) return "cursor";
    return i < cursorIndex ? "done" : "pending";
  }

  function colorFor(i: number): string | null {
    if (state.errorAt === i) return null; // let the red error style own the color
    return colors[i] ?? PLAIN_COLOR;
  }

  function display(ch: string): string {
    if (ch === " ") return " ";
    if (ch === "\t") return "⇥";
    return ch;
  }

  function handleKeydown(ev: KeyboardEvent) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return; // leave OS/browser shortcuts alone
    if (ev.key.length === 1 || HANDLED_KEYS.has(ev.key)) ev.preventDefault();
    const ts = Math.round(ev.timeStamp > 0 ? ev.timeStamp : performance.now());
    const result = reduceKey(state, target, { key: ev.key, ts }, skillOfKey);
    state = result.state;
    if (result.log) logs.push(result.log);
    if (result.state.done && !completed) {
      completed = true;
      oncomplete(summarize(logs), logs.slice());
    }
  }
</script>

<div
  class="typing-pane"
  data-testid="typing-pane"
  role="textbox"
  aria-multiline="true"
  aria-label="Typing target"
  tabindex="0"
  bind:this={paneEl}
  onkeydown={handleKeydown}
>
  {#if isNav}
    {#each target as t, i (i)}
      <kbd class="pill {classFor(i)}" data-index={i} data-testid="nav-pill">{t.ch}</kbd>
    {/each}
  {:else}
    {#each target as t, i (i)}
      {#if t.ch === "\n"}
        <span class={classFor(i)} style:color={colorFor(i)} data-index={i}>⏎</span><br />
      {:else}
        <span class={classFor(i)} style:color={colorFor(i)} data-index={i}>{display(t.ch)}</span>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .typing-pane {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 20px;
    line-height: 1.9;
    white-space: pre-wrap;
    padding: 16px;
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #0d1117;
    outline: none;
    cursor: text;
  }
  .typing-pane:focus {
    border-color: #22d3ee;
    box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.35);
  }
  .typing-pane span {
    border-radius: 2px;
  }
  .typing-pane :global(.pending) {
    opacity: 0.45;
  }
  .typing-pane :global(.done) {
    background: rgba(34, 197, 94, 0.16);
  }
  .typing-pane :global(.cursor) {
    background: rgba(34, 211, 238, 0.22);
    box-shadow: inset 2px 0 0 #22d3ee;
  }
  .typing-pane :global(.error) {
    background: rgba(239, 68, 68, 0.55);
    color: #ffffff;
  }
  .typing-pane :global(.pill) {
    display: inline-block;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 15px;
    line-height: 1.4;
    padding: 4px 10px;
    margin: 0 6px 6px 0;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
  }
</style>
