import { getBackend } from "./backend";

export const ROUTE_OVERRIDES_KEY = "route.overrides";

/** `{ [char]: "layer:keyId" }` — values are FULL skill routes, matching `skillId(recipe)`. */
export const routeOverrides = $state<{ map: Record<string, string> }>({ map: {} });

export async function loadRouteOverrides(): Promise<void> {
  const raw = await getBackend().getSetting(ROUTE_OVERRIDES_KEY);
  routeOverrides.map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

export async function saveRouteOverride(char: string, route: string | null): Promise<void> {
  if (route === null) delete routeOverrides.map[char];
  else routeOverrides.map[char] = route;
  await getBackend().setSetting(ROUTE_OVERRIDES_KEY, JSON.stringify(routeOverrides.map));
}
