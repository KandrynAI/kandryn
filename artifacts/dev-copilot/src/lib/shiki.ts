import type { ThemedToken, HighlighterCore, LanguageRegistration } from "shiki/core";

// Explicit grammar loaders. Using the fine-grained core + per-language dynamic
// imports (rather than the full bundle) means only these grammars are emitted
// as lazy chunks — not Shiki's entire ~200-language registry. The JS regex
// engine keeps things wasm-free. Extend both this map and EXT_LANG together.
const GRAMMARS: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  csharp: () => import("@shikijs/langs/csharp"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  java: () => import("@shikijs/langs/java"),
  python: () => import("@shikijs/langs/python"),
  go: () => import("@shikijs/langs/go"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  rust: () => import("@shikijs/langs/rust"),
  json: () => import("@shikijs/langs/json"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  html: () => import("@shikijs/langs/html"),
  xml: () => import("@shikijs/langs/xml"),
  sql: () => import("@shikijs/langs/sql"),
  yaml: () => import("@shikijs/langs/yaml"),
  markdown: () => import("@shikijs/langs/markdown"),
  bash: () => import("@shikijs/langs/bash"),
};

// Extension → grammar name (a GRAMMARS key). The platform targets C#, TypeScript,
// Java, Python; a handful of common others are included. Unknown extensions fall
// back to plain text (return null) rather than guessing.
const EXT_LANG: Record<string, string> = {
  cs: "csharp",
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  java: "java",
  py: "python",
  go: "go",
  rb: "ruby",
  php: "php",
  rs: "rust",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
};

export function langForPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const THEME = "github-light";

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    // The core + JS engine are dynamically imported so they land in a lazy chunk
    // (loaded the first time a diff is highlighted) rather than the main bundle.
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        import("@shikijs/themes/github-light").then((m) => m.default),
      ]);
      return createHighlighterCore({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine() });
    })();
  }
  return highlighterPromise;
}

/**
 * Tokenise file content into per-line themed tokens (content + colour). Returns
 * null when the language is unknown or highlighting fails — the caller renders
 * plain text in that case.
 */
export async function tokenizeLines(content: string, lang: string): Promise<ThemedToken[][] | null> {
  try {
    const loader = GRAMMARS[lang];
    if (!loader) return null;
    const hl = await getHighlighter();
    if (!loadedLangs.has(lang)) {
      await hl.loadLanguage((await loader()).default);
      loadedLangs.add(lang);
    }
    return hl.codeToTokens(content, { lang, theme: THEME }).tokens;
  } catch {
    return null;
  }
}

export type { ThemedToken };
