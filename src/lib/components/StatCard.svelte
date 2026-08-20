<script lang="ts">
  let {
    label,
    value,
    sub = null,
    testid,
  }: { label: string; value: string; sub?: string | null; testid: string } = $props();
</script>

<div class="stat-card" data-testid={testid}>
  <span class="label">{label}</span>
  <span class="value">{value}</span>
  {#if sub}<span class="sub">{sub}</span>{/if}
</div>

<style>
  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 8rem;
    padding: 0.85rem 1rem;
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #161b22;
  }
  .label {
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #8b949e;
  }
  /* Proportional figures: tabular-nums makes a standalone display number look loose. */
  .value {
    font-size: 1.7rem;
    font-weight: 600;
    line-height: 1.1;
    color: #c9d1d9;
  }
  .sub {
    font-size: 0.75rem;
    color: #8b949e;
  }
</style>
