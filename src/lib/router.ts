export interface Route {
  path: string;
  query: URLSearchParams;
}

function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const trimmed = raw.length > 0 ? raw : "/";
  const qi = trimmed.indexOf("?");
  const path = qi === -1 ? trimmed : trimmed.slice(0, qi);
  const search = qi === -1 ? "" : trimmed.slice(qi + 1);
  return {
    path: path.length > 0 ? path : "/",
    query: new URLSearchParams(search),
  };
}

export function currentRoute(): Route {
  return parseHash(window.location.hash);
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("#") ? path : `#${path}`;
}

export function onRouteChange(cb: (r: Route) => void): () => void {
  const handler = (): void => cb(currentRoute());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
