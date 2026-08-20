<script lang="ts">
  import KeyboardMap from "../lib/components/KeyboardMap.svelte";
  import { LAYOUT } from "../lib/layout/layout-data";
  import { LOWER_KEY_ID, RAISE_KEY_ID } from "../lib/layout/reverse-index";
  import {
    buildWizardPlan,
    describeOutput,
    isIgnoredKey,
    matchStep,
    reportJson,
    type Mismatch,
  } from "../lib/layout/wizard";

  const plan = buildWizardPlan(LAYOUT);
  const HOLD_IDS: Record<"lower" | "raise", string> = {
    lower: LOWER_KEY_ID,
    raise: RAISE_KEY_ID,
  };

  let index = $state(0);
  let attempted = $state(0); // keys actually presented — finish() moves index without touching this
  let mismatches = $state<Mismatch[]>([]);
  let skipped = $state<string[]>([]);
  let reportText = $state("");
  let copied = $state(false);

  const done = $derived(index >= plan.length);
  const step = $derived(done ? null : plan[index]);
  const holdIds = $derived(step && step.hold ? [HOLD_IDS[step.hold]] : []);
  const holdLabel = $derived(step?.hold === "lower" ? "Lower (Fn 1)" : "Raise (Fn 2)");
  const promptText = $derived(
    step === null
      ? ""
      : step.hold === null
        ? `Press the highlighted key — it should type ${describeOutput(step.expected)}`
        : `Hold ${holdLabel} and press the highlighted key — it should type ${describeOutput(step.expected)}`
  );

  function blur(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).blur();
  }

  function skip(ev: MouseEvent): void {
    blur(ev);
    if (step === null) return;
    skipped = [...skipped, step.skillId];
    attempted += 1;
    index += 1;
  }

  function finish(ev: MouseEvent): void {
    blur(ev);
    index = plan.length;
  }

  function restart(ev: MouseEvent): void {
    blur(ev);
    index = 0;
    attempted = 0;
    mismatches = [];
    skipped = [];
    reportText = "";
    copied = false;
  }

  function handleKey(ev: KeyboardEvent): void {
    if (done || ev.repeat) return;
    if (isIgnoredKey(ev.key)) return;
    ev.preventDefault();
    const current = plan[index];
    if (!matchStep(current, ev.key)) {
      mismatches = [
        ...mismatches,
        {
          skillId: current.skillId,
          layer: current.layer,
          keyId: current.keyId,
          expected: current.expected,
          got: ev.key,
        },
      ];
    }
    attempted += 1;
    index += 1;
  }

  async function copyReport(ev: MouseEvent): Promise<void> {
    blur(ev);
    const json = reportJson(
      LAYOUT.board,
      plan,
      mismatches,
      skipped,
      attempted,
      new Date().toISOString()
    );
    reportText = json;
    try {
      await navigator.clipboard.writeText(json);
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<h1>Layout verification wizard</h1>
<p class="lede">
  Confirms every trainable key on every layer against <code>layout.json</code>. Press what the prompt
  asks for; anything else is recorded as a mismatch and the wizard moves on. Media and RGB keys are
  not included — the webview never sees them.
</p>

{#if !done}
  <section class="stage">
    <p data-testid="wizard-prompt" class="prompt">{promptText}</p>
    <p class="meta">
      {step?.layer} layer · key <code>{step?.keyId}</code> · legend <code>{step?.label}</code>
    </p>
    <p data-testid="wizard-progress" class="progress">{index} / {plan.length}</p>
    <div class="bar"><span style="width: {(index / plan.length) * 100}%"></span></div>

    <KeyboardMap
      layer={step ? step.layer : "base"}
      highlightKeyIds={step ? [step.keyId] : []}
      holdKeyIds={holdIds}
    />

    <div class="actions">
      <button data-testid="wizard-skip" onclick={skip}>Skip this key</button>
      <button data-testid="wizard-finish" onclick={finish}>Finish &amp; review</button>
    </div>
    <p class="hint">
      {mismatches.length} mismatch{mismatches.length === 1 ? "" : "es"} · {skipped.length} skipped
    </p>
  </section>
{:else}
  <section class="stage" data-testid="wizard-summary">
    <h2>Verification report</h2>
    <p class="progress">
      {attempted - mismatches.length - skipped.length} verified ·
      {mismatches.length} mismatched · {skipped.length} skipped · {plan.length} total
    </p>

    {#if mismatches.length === 0}
      <p data-testid="wizard-clean">No mismatches — layout.json matches the firmware.</p>
    {:else}
      <ul class="mismatches">
        {#each mismatches as m (m.skillId)}
          <li data-testid="mismatch-row">
            <code>{m.skillId}</code> expected {describeOutput(m.expected)} got
            {describeOutput(m.got)}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="actions">
      <button data-testid="copy-report" onclick={copyReport}>Copy report</button>
      <button data-testid="wizard-restart" onclick={restart}>Run again</button>
    </div>
    {#if copied}<p class="hint" data-testid="copy-confirm">Report copied to the clipboard.</p>{/if}
    {#if reportText}
      <textarea data-testid="report-json" readonly rows="12">{reportText}</textarea>
    {/if}
  </section>
{/if}

<style>
  .lede {
    max-width: 46rem;
    color: #8b949e;
  }
  .stage {
    padding: 1rem;
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #161b22;
  }
  .prompt {
    margin: 0 0 0.25rem;
    font-size: 1.25rem;
    color: #c9d1d9;
  }
  .meta,
  .hint {
    margin: 0.25rem 0;
    font-size: 0.8rem;
    color: #8b949e;
  }
  .progress {
    margin: 0.5rem 0 0.25rem;
    font-variant-numeric: tabular-nums;
    color: #22d3ee;
  }
  .bar {
    height: 6px;
    margin-bottom: 1rem;
    border-radius: 3px;
    background: #0d1117;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: #22d3ee;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .actions button {
    padding: 0.4rem 0.9rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #0d1117;
    color: #c9d1d9;
    cursor: pointer;
  }
  .actions button:hover {
    border-color: #22d3ee;
    color: #22d3ee;
  }
  .mismatches {
    margin: 0.5rem 0;
    padding-left: 1.1rem;
    line-height: 1.7;
  }
  textarea {
    width: 100%;
    margin-top: 0.75rem;
    padding: 0.5rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #0d1117;
    color: #c9d1d9;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
  }
</style>
