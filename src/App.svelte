<script lang="ts">
  import { currentRoute, onRouteChange, type Route } from "./lib/router";
  import CodeCopy from "./views/CodeCopy.svelte";
  import Drill from "./views/Drill.svelte";
  import Home from "./views/Home.svelte";
  import Reference from "./views/Reference.svelte";
  import Session from "./views/Session.svelte";
  import Settings from "./views/Settings.svelte";
  import Stats from "./views/Stats.svelte";
  import Train from "./views/Train.svelte";
  import Wizard from "./views/Wizard.svelte";

  const NAV: Array<{ path: string; label: string }> = [
    { path: "/reference", label: "Reference" },
    { path: "/train", label: "Train" },
    { path: "/code", label: "Code" },
    { path: "/stats", label: "Stats" },
    { path: "/settings", label: "Settings" },
  ];

  let route = $state<Route>(currentRoute());

  $effect(() =>
    onRouteChange((next) => {
      route = next;
    })
  );
</script>

<header class="shell-header">
  <h1 class="brand">keydrill</h1>
  <nav>
    {#each NAV as item (item.path)}
      <a href={`#${item.path}`} class:active={route.path === item.path}>{item.label}</a>
    {/each}
  </nav>
</header>

<main>
  {#if route.path === "/reference"}
    <Reference />
  {:else if route.path === "/train"}
    <Train />
  {:else if route.path === "/drill"}
    <Drill />
  {:else if route.path === "/code"}
    <CodeCopy />
  {:else if route.path === "/session"}
    <Session />
  {:else if route.path === "/stats"}
    <Stats />
  {:else if route.path === "/settings"}
    <Settings />
  {:else if route.path === "/wizard"}
    <Wizard />
  {:else}
    <Home />
  {/if}
</main>
