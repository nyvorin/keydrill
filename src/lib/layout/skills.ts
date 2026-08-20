import type { LayerId, Layout } from "./types";

/** label = legend for that layer */
export interface SkillInfo {
  id: string;
  layer: LayerId;
  keyId: string;
  label: string;
}

const LAYER_ORDER: LayerId[] = ["base", "lower", "raise"];

/** one per (layer, key) with trainable output (char or key, not role) */
export function skillVocabulary(layout: Layout): SkillInfo[] {
  const vocab: SkillInfo[] = [];
  for (const layer of LAYER_ORDER) {
    for (const key of layout.keys) {
      const out = key.output[layer];
      if (!out || out.role !== undefined) continue;
      if (out.char === undefined && out.key === undefined) continue;
      const label = key.legends[layer] ?? out.char ?? out.key ?? key.id;
      vocab.push({ id: `${layer}:${key.id}`, layer, keyId: key.id, label });
    }
  }
  return vocab;
}
