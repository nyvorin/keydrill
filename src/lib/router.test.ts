import { expect, test } from "vite-plus/test";
import { currentRoute, navigate, onRouteChange } from "./router";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("empty hash is the root route", () => {
  window.location.hash = "";
  expect(currentRoute().path).toBe("/");
});

test("parses path and query string", () => {
  window.location.hash = "#/drill?stage=3&lang=rust";
  const route = currentRoute();
  expect(route.path).toBe("/drill");
  expect(route.query.get("stage")).toBe("3");
  expect(route.query.get("lang")).toBe("rust");
});

test("navigate writes the hash", () => {
  navigate("/reference");
  expect(window.location.hash).toBe("#/reference");
  expect(currentRoute().path).toBe("/reference");
});

test("onRouteChange fires until unsubscribed", async () => {
  navigate("/");
  await tick();
  const seen: string[] = [];
  const off = onRouteChange((r) => seen.push(r.path));
  navigate("/stats");
  await tick();
  off();
  navigate("/settings");
  await tick();
  expect(seen).toEqual(["/stats"]);
});
