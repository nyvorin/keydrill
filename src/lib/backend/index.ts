import type { Backend } from "./api";
import { MockBackend } from "./mock";

let instance: Backend | null = null;

/**
 * Single app-wide Backend. Task 17 adds the branch that returns a TauriBackend
 * when `'__TAURI_INTERNALS__' in window`; until then everything runs on the mock.
 */
export function getBackend(): Backend {
  if (instance === null) instance = new MockBackend();
  return instance;
}
