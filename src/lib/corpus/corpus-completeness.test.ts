import { describe, expect, it } from "vite-plus/test";
import type { LangId } from "../curriculum/stages";
import { DIFFICULTIES, LANG_IDS, loadCorpus, validateEntry } from "./index";

const MIN_IDIOMS = 30;
const MIN_SNIPPETS = 15;
const IDIOM_MIN_CHARS = 30;
const IDIOM_MAX_CHARS = 90;
const SNIPPET_MIN_LINES = 3;
const SNIPPET_MAX_LINES = 25;

const REQUIRED_TAGS: Record<LangId, string[]> = {
  js: ["closures", "destructuring", "template-literals", "async-await", "optional-chaining"],
  ts: ["generics", "unions", "interfaces", "type-guards", "mapped-types"],
  html: ["forms", "attributes", "semantic", "tables"],
  css: ["grid", "flexbox", "media-queries", "variables", "pseudo-selectors"],
  php: ["arrays", "null-coalescing", "match", "closures", "classes"],
  rust: ["match", "closures", "lifetimes", "iterators", "error-handling", "generics"],
  go: ["error-handling", "goroutines", "channels", "slices", "structs"],
  java: ["streams", "generics", "records", "lambdas"],
  kotlin: ["data-classes", "when", "null-safety", "extension-functions", "coroutines"],
  sql: ["cte", "window-functions", "joins", "jsonb", "intervals", "upsert"],
};

const corpus = loadCorpus();

describe("corpus completeness", () => {
  for (const lang of LANG_IDS) {
    describe(lang, () => {
      const entries = corpus.byLang(lang);
      const idioms = corpus.idioms(lang);
      const snippets = corpus.snippets(lang);

      it(`has at least ${MIN_IDIOMS} idioms`, () => {
        expect(idioms.length).toBeGreaterThanOrEqual(MIN_IDIOMS);
      });

      it(`has at least ${MIN_SNIPPETS} snippets`, () => {
        expect(snippets.length).toBeGreaterThanOrEqual(MIN_SNIPPETS);
      });

      it("covers easy, medium and hard among its snippets", () => {
        const seen = new Set(snippets.map((e) => e.difficulty));
        expect([...DIFFICULTIES].filter((d) => !seen.has(d))).toEqual([]);
      });

      it("validates every entry against the schema", () => {
        const problems = entries.flatMap((e) =>
          validateEntry(e).map((p) => `${p} :: ${e.text.slice(0, 40)}`),
        );
        expect(problems).toEqual([]);
      });

      it(`keeps idioms single-line and ${IDIOM_MIN_CHARS}-${IDIOM_MAX_CHARS} chars`, () => {
        const bad = idioms
          .filter(
            (e) =>
              e.text.includes("\n") ||
              e.text.length < IDIOM_MIN_CHARS ||
              e.text.length > IDIOM_MAX_CHARS,
          )
          .map((e) => `${e.text.length} chars :: ${e.text}`);
        expect(bad).toEqual([]);
      });

      it(`keeps snippets ${SNIPPET_MIN_LINES}-${SNIPPET_MAX_LINES} lines`, () => {
        const bad = snippets
          .filter((e) => {
            const lines = e.text.split("\n").length;
            return lines < SNIPPET_MIN_LINES || lines > SNIPPET_MAX_LINES;
          })
          .map((e) => `${e.text.split("\n").length} lines :: ${e.text.slice(0, 40)}`);
        expect(bad).toEqual([]);
      });

      it("covers every required tag", () => {
        const tags = new Set(entries.flatMap((e) => e.tags));
        expect((REQUIRED_TAGS[lang] ?? []).filter((t) => !tags.has(t))).toEqual([]);
      });

      it("has no duplicate texts", () => {
        const texts = entries.map((e) => e.text);
        const seen = new Set<string>();
        const dupes = texts.filter((t) => (seen.has(t) ? true : (seen.add(t), false)));
        expect(dupes).toEqual([]);
      });
    });
  }
});
