import { describe, expect, it } from "vite-plus/test";
import { DIFFICULTIES, LANG_IDS, SHIKI_LANG, loadCorpus, validateEntry } from "./index";

const corpus = loadCorpus();

describe("corpus loader", () => {
  it("knows all ten languages and a shiki grammar for each", () => {
    expect(LANG_IDS).toEqual([
      "js",
      "ts",
      "html",
      "css",
      "php",
      "rust",
      "go",
      "java",
      "kotlin",
      "sql",
    ]);
    for (const lang of LANG_IDS) {
      expect(SHIKI_LANG[lang]).toMatch(/^[a-z]+$/);
    }
  });

  it("loads every data file through the glob", () => {
    expect(corpus.all.length).toBeGreaterThan(0);
    const langs = new Set(corpus.all.map((e) => e.lang));
    expect(langs.has("rust")).toBe(true);
    expect(langs.has("sql")).toBe(true);
  });

  it("validates every bundled entry against the schema", () => {
    const problems = corpus.all.flatMap((e) =>
      validateEntry(e).map((p) => `${e.lang}/${e.kind}: ${p}`),
    );
    expect(problems).toEqual([]);
  });

  it("reports problems for a malformed entry", () => {
    const problems = validateEntry({
      lang: "rust",
      kind: "idiom",
      difficulty: "easy",
      tags: [],
      text: "",
    });
    expect(problems).toContain("tags must be a non-empty array");
    expect(problems).toContain("text must be a non-empty string");
  });

  it("ships the rust starter set", () => {
    expect(corpus.idioms("rust").length).toBeGreaterThanOrEqual(10);
    expect(corpus.snippets("rust").length).toBeGreaterThanOrEqual(5);
    expect(corpus.snippets("rust", "easy").length).toBeGreaterThanOrEqual(1);
  });

  it("ships the sql starter set", () => {
    expect(corpus.idioms("sql").length).toBeGreaterThanOrEqual(10);
    expect(corpus.snippets("sql").length).toBeGreaterThanOrEqual(5);
    expect(corpus.snippets("sql", "easy").length).toBeGreaterThanOrEqual(1);
  });

  it("filters by language, kind and difficulty", () => {
    expect(corpus.byLang("rust").every((e) => e.lang === "rust")).toBe(true);
    expect(corpus.idioms("sql").every((e) => e.kind === "idiom")).toBe(true);
    for (const difficulty of DIFFICULTIES) {
      expect(corpus.snippets("rust", difficulty).every((e) => e.difficulty === difficulty)).toBe(
        true,
      );
    }
  });

  it("keeps snippets multi-line and idioms single-line", () => {
    expect(corpus.idioms("rust").every((e) => !e.text.includes("\n"))).toBe(true);
    expect(corpus.snippets("rust").every((e) => e.text.split("\n").length >= 3)).toBe(true);
  });
});
