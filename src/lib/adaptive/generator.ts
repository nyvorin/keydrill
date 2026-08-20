import type { LayerId, Layout } from "../layout/types";

const MIN_LEN = 40;
const LAYERS: LayerId[] = ["base", "lower", "raise"];

/**
 * Code-ish wrappers so weak characters are drilled in realistic context rather than
 * as bare runs. Every literal character used here is producible on the board
 * (braces/brackets/parens on Lower; letters, comma and space on Base), which keeps
 * generated lines typeable no matter which skills were requested.
 * Longest fragment is 5 chars, so the loop below can never overshoot 60.
 */
const FRAGMENTS: Array<(c: string) => string> = [
  (c) => `{${c}}`,
  (c) => `[${c}]`,
  (c) => `(${c})`,
  (c) => `p[${c}]`,
  (c) => `fn(${c})`,
  (c) => `x${c}y`,
  (c) => `${c}, ${c}`,
  (c) => `a${c}b`,
];

/** Used when none of the requested skills type a printable char (e.g. a nav-only stage). */
const FALLBACK_CHARS = ["{", "}", "[", "]", "(", ")", ";", "="];

function charBySkill(layout: Layout): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of layout.keys) {
    for (const layer of LAYERS) {
      const out = key.output[layer];
      if (!out || out.role || typeof out.char !== "string") continue;
      map.set(`${layer}:${key.id}`, out.char);
    }
  }
  return map;
}

/** Small, fast, seedable PRNG. Same seed → same stream, so drills are reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compose a 40–60 char practice line weighted toward the given weak skills.
 * Pure: all randomness comes from `rng`, so the caller owns the seed.
 */
export function generateDrillLine(
  weakSkillIds: string[],
  layout: Layout,
  rng: () => number,
): string {
  const charOf = charBySkill(layout);
  const wanted = weakSkillIds
    .map((id) => charOf.get(id))
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  const pool = wanted.length > 0 ? wanted : FALLBACK_CHARS;

  const parts: string[] = [];
  let len = 0;
  let i = 0;
  while (len < MIN_LEN) {
    const ch = pool[i % pool.length];
    const make = FRAGMENTS[Math.floor(rng() * FRAGMENTS.length) % FRAGMENTS.length];
    const fragment = make(ch);
    len += (parts.length === 0 ? 0 : 1) + fragment.length;
    parts.push(fragment);
    i += 1;
  }
  return parts.join(" ");
}
