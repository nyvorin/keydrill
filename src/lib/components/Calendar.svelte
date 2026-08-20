<script lang="ts">
  import type { DayState } from "../backend/api";

  let { days }: { days: DayState[] } = $props();

  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const leading = first.getDay(); // 0 = Sunday
  const doneSet = $derived(new Set(days.filter((d) => d.sessionCompleted).map((d) => d.date)));

  function key(day: number): string {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const todayKey = key(today.getDate());

  const HEADS = ["S", "M", "T", "W", "T", "F", "S"];
</script>

<div data-testid="calendar" class="calendar">
  {#each HEADS as d, i (i)}<span class="head">{d}</span>{/each}
  {#each Array.from({ length: leading }, (_, i) => i) as pad (pad)}<span class="pad"></span>{/each}
  {#each Array.from({ length: daysInMonth }, (_, i) => i + 1) as day (day)}
    <span
      class="cell"
      class:done={doneSet.has(key(day))}
      class:today={key(day) === todayKey}
      title="{key(day)}{doneSet.has(key(day)) ? ' · session completed' : ''}">{day}</span
    >
  {/each}
</div>

<style>
  .calendar {
    display: grid;
    grid-template-columns: repeat(7, 2rem);
    gap: 4px;
  }
  .head {
    color: #8b949e;
    text-align: center;
    font-size: 0.75rem;
  }
  .cell {
    text-align: center;
    padding: 4px 0;
    border-radius: 6px;
    /* Page ink, not panel ink — the cells sit ON a #161b22 panel. */
    background: #0d1117;
    color: #8b949e;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  /* Completed days wear the same cyan the base/WPM series wears elsewhere. */
  .cell.done {
    background: #22d3ee33;
    color: #c9d1d9;
    outline: 1px solid #22d3ee;
  }
  .cell.today {
    outline: 2px solid #f59e0b;
    color: #c9d1d9;
  }
</style>
