import type { BundledLanguage, Highlighter } from "shiki";

export const PLAIN_COLOR = "#c9d1d9";

const THEME = "github-dark-default";

/**
 * The shiki grammars we bundle — the same ten ids `SHIKI_LANG` maps LangId onto in
 * `src/lib/corpus/index.ts`. Kept local so the highlighter has no dependency on the corpus module.
 */
const LANGS: BundledLanguage[] = [
  "javascript",
  "typescript",
  "html",
  "css",
  "php",
  "rust",
  "go",
  "java",
  "kotlin",
  "sql",
];

/** Narrows an arbitrary lang string to one of the grammars we actually bundle. */
function isBundled(lang: string): lang is BundledLanguage {
  return (LANGS as string[]).includes(lang);
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  // Dynamic import so plain drills (stages 1-5) never pay for the shiki bundle.
  highlighterPromise ??= import("shiki").then((m) =>
    m.createHighlighter({ themes: [THEME], langs: LANGS }),
  );
  return highlighterPromise;
}

function plainRows(code: string): { char: string; color: string }[][] {
  return code.split("\n").map((line) => [...line].map((char) => ({ char, color: PLAIN_COLOR })));
}

/** Per-line arrays of per-character colored cells, for TypingPane's char-by-char overlay. */
export async function highlightTokens(
  code: string,
  lang: string,
): Promise<{ char: string; color: string }[][]> {
  if (lang === "plain" || !isBundled(lang)) return plainRows(code);
  const highlighter = await getHighlighter();
  const { tokens } = highlighter.codeToTokens(code, { lang, theme: THEME });
  return tokens.map((line) =>
    line.flatMap((token) =>
      [...token.content].map((char) => ({ char, color: token.color ?? PLAIN_COLOR })),
    ),
  );
}
