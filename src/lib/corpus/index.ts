import type { LangId } from "../curriculum/stages";

export interface CorpusEntry {
  lang: LangId;
  kind: "idiom" | "snippet";
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  text: string;
}

export interface CorpusIndex {
  all: CorpusEntry[];
  byLang(lang: LangId): CorpusEntry[];
  idioms(lang: LangId): CorpusEntry[];
  snippets(lang: LangId, difficulty?: "easy" | "medium" | "hard"): CorpusEntry[];
}

/** Shiki grammar id per language — also the source of truth for the language list. */
export const SHIKI_LANG: Record<LangId, string> = {
  js: "javascript",
  ts: "typescript",
  html: "html",
  css: "css",
  php: "php",
  rust: "rust",
  go: "go",
  java: "java",
  kotlin: "kotlin",
  sql: "sql",
};

export const LANG_IDS: LangId[] = Object.keys(SHIKI_LANG) as LangId[];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

const modules = import.meta.glob<{ default: CorpusEntry[] }>("./data/*.json", { eager: true });

/** Returns a list of schema problems; an empty list means the entry is valid. */
export function validateEntry(entry: CorpusEntry): string[] {
  const problems: string[] = [];
  // Entries come from hand-edited JSON, so the declared types are a claim, not a guarantee.
  // `kind` is widened before the check so the failure branch still has a value to report.
  const kind: string = entry.kind;
  if (!LANG_IDS.includes(entry.lang)) problems.push(`unknown lang "${entry.lang}"`);
  if (kind !== "idiom" && kind !== "snippet") problems.push(`unknown kind "${kind}"`);
  if (!DIFFICULTIES.includes(entry.difficulty))
    problems.push(`unknown difficulty "${entry.difficulty}"`);
  if (!Array.isArray(entry.tags) || entry.tags.length === 0) {
    problems.push("tags must be a non-empty array");
  } else if (entry.tags.some((t) => typeof t !== "string" || t.trim() === "")) {
    problems.push("tags must all be non-empty strings");
  }
  if (typeof entry.text !== "string" || entry.text.trim() === "") {
    problems.push("text must be a non-empty string");
  } else if (entry.kind === "idiom" && entry.text.includes("\n")) {
    problems.push("idiom text must be a single line");
  }
  return problems;
}

function makeIndex(all: CorpusEntry[]): CorpusIndex {
  return {
    all,
    byLang: (lang) => all.filter((e) => e.lang === lang),
    idioms: (lang) => all.filter((e) => e.lang === lang && e.kind === "idiom"),
    snippets: (lang, difficulty) =>
      all.filter(
        (e) =>
          e.lang === lang &&
          e.kind === "snippet" &&
          (difficulty === undefined || e.difficulty === difficulty),
      ),
  };
}

/** Eagerly bundles every JSON file under ./data into one queryable index. */
export function loadCorpus(): CorpusIndex {
  const all: CorpusEntry[] = [];
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    if (!mod) continue;
    for (const entry of mod.default) all.push(entry);
  }
  return makeIndex(all);
}
