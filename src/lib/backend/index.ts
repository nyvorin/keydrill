import type { Backend } from "./api";
import { MockBackend } from "./mock";
import { tauriBackend } from "./tauri";

let instance: Backend | null = null;

/**
 * Single app-wide Backend. Under Tauri (`__TAURI_INTERNALS__` present) all
 * persistence goes to the Rust/SQLite store; in a plain browser (vp dev,
 * Playwright, Vitest) the localStorage-backed mock serves everything.
 */
export function getBackend(): Backend {
  if (instance === null) {
    instance =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
        ? tauriBackend()
        : new MockBackend();
  }
  return instance;
}
