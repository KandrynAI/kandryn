import type { UiStyleToken } from "@workspace/db";
import { newDropCounter, validCssValue, validName, dropWarnings, type DropCounter } from "./validate.js";

/**
 * CSS custom properties and Tailwind v4 `@theme` blocks, read with a real
 * tokenizer rather than a regex (0042).
 *
 * A regex over CSS gets comments and nested blocks wrong, and the thing it
 * gets wrong is exactly the thing that matters here: which SELECTOR a value
 * was declared under. `--bg: white` in `:root` and `--bg: black` in `.dark`
 * are two different tokens, and collapsing them would hand a model one
 * arbitrary half of a theme.
 */

/** Declaration blocks worth reading; others are component styles, not tokens. */
function isTokenScope(selector: string): boolean {
  const s = selector.trim();
  return (
    s === ":root" ||
    s === "html" ||
    s === "@theme" ||
    /^\.dark\b/.test(s) ||
    /^\[data-theme/.test(s) ||
    /:root\s*:?not|^:root\b/.test(s) ||
    /^html\.dark\b/.test(s)
  );
}

export interface CssTokenResult {
  tokens: UiStyleToken[];
  warnings: string[];
}

/**
 * Parse one CSS/SCSS file for custom properties under token-bearing
 * selectors, plus Tailwind v4 `@theme { … }`.
 *
 * Uses postcss, so comments are comments and a brace inside a string cannot
 * desynchronise the scan. A file postcss refuses is skipped with a warning
 * rather than throwing — one unparseable stylesheet must not lose the rest.
 */
export async function extractCssTokens(file: string, text: string): Promise<CssTokenResult> {
  const tokens: UiStyleToken[] = [];
  const warnings: string[] = [];
  const counter: DropCounter = newDropCounter();

  const postcss = (await import("postcss")).default;
  let root;
  try {
    root = postcss.parse(text, { from: file });
  } catch {
    return { tokens: [], warnings: [`${file}: could not be parsed as CSS, skipped`] };
  }

  root.walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) return;
    const parent = decl.parent;
    if (!parent) return;
    // A rule's selector, or an at-rule's name (`@theme`).
    const scope =
      parent.type === "rule"
        ? (parent as { selector?: string }).selector ?? ""
        : parent.type === "atrule"
          ? `@${(parent as { name?: string }).name ?? ""}`
          : "";
    if (!isTokenScope(scope)) return;

    const name = validName(decl.prop, counter);
    const value = validCssValue(decl.value, counter);
    if (!name || !value) return;

    tokens.push({
      name,
      value,
      scope: scope.trim(),
      source: { file, line: decl.source?.start?.line ?? 0 },
    });
  });

  warnings.push(...dropWarnings(counter, "CSS values"));
  return { tokens, warnings };
}

/** Font families declared outright (not via a custom property). */
export async function extractFontFamilies(file: string, text: string): Promise<CssTokenResult> {
  const tokens: UiStyleToken[] = [];
  const counter = newDropCounter();
  const postcss = (await import("postcss")).default;
  let root;
  try {
    root = postcss.parse(text, { from: file });
  } catch {
    return { tokens: [], warnings: [] };
  }

  const seen = new Set<string>();
  root.walkDecls("font-family", (decl) => {
    const value = validCssValue(decl.value, counter);
    if (!value || seen.has(value)) return;
    seen.add(value);
    tokens.push({
      name: "font-family",
      value,
      source: { file, line: decl.source?.start?.line ?? 0 },
    });
  });

  return { tokens, warnings: dropWarnings(counter, "font values") };
}

/**
 * SCSS variables (`$name: value`) in files that look like token files.
 *
 * postcss cannot parse SCSS without a syntax plugin, so this is a line scan —
 * safe here because a `$var` declaration is a single line by convention, and
 * anything ambiguous is dropped rather than guessed.
 */
export function extractScssVariables(file: string, text: string): CssTokenResult {
  const tokens: UiStyleToken[] = [];
  const counter = newDropCounter();
  const lines = text.split(/\r?\n/);
  let inBlockComment = false;

  lines.forEach((raw, i) => {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const open = line.indexOf("/*");
    if (open !== -1) {
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        inBlockComment = true;
        line = line.slice(0, open);
      } else {
        line = line.slice(0, open) + line.slice(close + 2);
      }
    }
    const comment = line.indexOf("//");
    if (comment !== -1) line = line.slice(0, comment);

    const m = /^\s*\$([A-Za-z0-9_-]+)\s*:\s*([^;]+);/.exec(line);
    if (!m) return;
    const name = validName(`$${m[1]}`, counter);
    const value = validCssValue(m[2].replace(/!default\s*$/, ""), counter);
    if (!name || !value) return;
    tokens.push({ name, value, source: { file, line: i + 1 } });
  });

  return { tokens, warnings: dropWarnings(counter, "SCSS values") };
}
