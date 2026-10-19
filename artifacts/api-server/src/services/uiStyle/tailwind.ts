import type { UiStyleToken } from "@workspace/db";
import { newDropCounter, validCssValue, validName, dropWarnings } from "./validate.js";

/**
 * Tailwind v3 config files, read STATICALLY (0042).
 *
 * The config is a module from the customer's repository. It is parsed into an
 * AST and walked; it is never imported, required, evaluated or run. That rules
 * out reading a config whose theme is computed — `colors: generatePalette()`,
 * a spread of a required module, a value behind a ternary — and that is the
 * correct outcome: the alternative is executing a stranger's code inside the
 * API server. Those cases produce a warning saying so, and the CSS variables
 * usually carry the same values anyway.
 */

export interface TailwindResult {
  tokens: {
    colors: UiStyleToken[];
    typography: UiStyleToken[];
    radius: UiStyleToken[];
    spacing: UiStyleToken[];
    shadows: UiStyleToken[];
  };
  warnings: string[];
}

const EMPTY: TailwindResult["tokens"] = { colors: [], typography: [], radius: [], spacing: [], shadows: [] };

/** Minimal shapes from the Babel AST — enough to walk a plain object literal. */
interface Node {
  type: string;
  loc?: { start: { line: number } };
  [k: string]: unknown;
}
interface Prop extends Node {
  key?: Node & { name?: string; value?: string | number };
  value?: Node;
  computed?: boolean;
}

const keyOf = (p: Prop): string | null => {
  if (!p.key || p.computed) return null;
  if (p.key.type === "Identifier") return p.key.name ?? null;
  if (p.key.type === "StringLiteral") return typeof p.key.value === "string" ? p.key.value : null;
  // A colour scale is written `{ 500: "#..." }` — numeric keys are the norm
  // in a Tailwind palette, not an edge case.
  if (p.key.type === "NumericLiteral") return p.key.value != null ? String(p.key.value) : null;
  return null;
};

const propsOf = (n: Node | undefined): Prop[] =>
  n && n.type === "ObjectExpression" ? ((n.properties as Prop[]) ?? []).filter((p) => p.type === "ObjectProperty") : [];

const findProp = (n: Node | undefined, name: string): Prop | undefined =>
  propsOf(n).find((p) => keyOf(p) === name);

/**
 * Flatten a theme group into name/value pairs. Tailwind allows one level of
 * nesting (`colors: { brand: { 500: '#...' } }`), which flattens to
 * `brand-500`. Anything that is not a literal is reported, not guessed.
 */
function flatten(
  node: Node | undefined,
  file: string,
  prefix = "",
  depth = 0,
): { pairs: Array<{ name: string; value: string; line: number }>; nonLiteral: number } {
  const pairs: Array<{ name: string; value: string; line: number }> = [];
  let nonLiteral = 0;
  if (!node || depth > 2) return { pairs, nonLiteral };

  // Members that are not plain properties — a spread such as
  // `{ ...require("./spacing") }` — are unreadable without running the file.
  const members = (node.properties as Node[]) ?? [];
  nonLiteral += members.filter((m) => m && m.type !== "ObjectProperty").length;

  for (const p of propsOf(node)) {
    const key = keyOf(p);
    if (!key) {
      nonLiteral++;
      continue;
    }
    const name = prefix ? `${prefix}-${key}` : key;
    const v = p.value;
    const line = p.loc?.start.line ?? v?.loc?.start.line ?? 0;

    if (v?.type === "StringLiteral") {
      pairs.push({ name, value: String(v.value), line });
    } else if (v?.type === "NumericLiteral") {
      pairs.push({ name, value: String(v.value), line });
    } else if (v?.type === "ArrayExpression") {
      // fontFamily: { sans: ["Inter", "system-ui"] }
      const parts = ((v.elements as Node[]) ?? [])
        .filter((e) => e && e.type === "StringLiteral")
        .map((e) => String((e as { value?: string }).value));
      if (parts.length > 0) pairs.push({ name, value: parts.join(", "), line });
      else nonLiteral++;
    } else if (v?.type === "ObjectExpression") {
      const nested = flatten(v, file, name, depth + 1);
      pairs.push(...nested.pairs);
      nonLiteral += nested.nonLiteral;
    } else {
      // A call, identifier, template literal, spread or ternary: computed at
      // build time, and we do not run build time.
      nonLiteral++;
    }
  }
  return { pairs, nonLiteral };
}

/**
 * Read a `tailwind.config.{js,cjs,mjs,ts}`.
 *
 * Never throws: a config this cannot parse yields empty tokens and a warning,
 * because one awkward config must not fail the whole extraction.
 */
export async function extractTailwindConfig(file: string, text: string): Promise<TailwindResult> {
  const warnings: string[] = [];
  const counter = newDropCounter();

  let ast: Node;
  try {
    const { parse } = await import("@babel/parser");
    ast = parse(text, {
      sourceType: "unambiguous",
      // The config may be .ts with `satisfies Config`; plugins cover both.
      plugins: ["typescript", "jsx"],
      // Recover rather than abort, so one bad line does not lose a whole
      // theme — but report it below, because a config that only half-parsed
      // yielding "no tokens" must not look like a config that has none.
      errorRecovery: true,
    }) as unknown as Node;
  } catch {
    return { tokens: EMPTY, warnings: [`${file}: could not be parsed, Tailwind theme not read`] };
  }

  const parseErrors = ((ast.errors as unknown[]) ?? []).length;
  if (parseErrors > 0) {
    warnings.push(`${file}: ${parseErrors} syntax error(s); the theme may be read only in part`);
  }

  // Find the exported config object: `export default {…}`, `module.exports = {…}`,
  // `export default satisfies/as …`, or `const config = {…}; export default config`.
  const body = (ast.program as Node | undefined)?.body as Node[] | undefined;
  let configObj: Node | undefined;
  const unwrap = (n: Node | undefined): Node | undefined => {
    let cur = n;
    while (cur && (cur.type === "TSSatisfiesExpression" || cur.type === "TSAsExpression")) {
      cur = cur.expression as Node;
    }
    return cur;
  };
  const named = new Map<string, Node>();

  for (const stmt of body ?? []) {
    if (stmt.type === "VariableDeclaration") {
      for (const d of (stmt.declarations as Node[]) ?? []) {
        const id = (d.id as Node & { name?: string })?.name;
        const init = unwrap(d.init as Node | undefined);
        if (id && init?.type === "ObjectExpression") named.set(id, init);
      }
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const dec = unwrap(stmt.declaration as Node | undefined);
      if (dec?.type === "ObjectExpression") configObj = dec;
      else if (dec?.type === "Identifier") configObj = named.get((dec as { name?: string }).name ?? "");
    }
    if (stmt.type === "ExpressionStatement") {
      const expr = stmt.expression as Node;
      if (expr?.type === "AssignmentExpression") {
        const right = unwrap(expr.right as Node);
        if (right?.type === "ObjectExpression") configObj = right;
        else if (right?.type === "Identifier") configObj = named.get((right as { name?: string }).name ?? "");
      }
    }
  }

  if (!configObj) {
    return { tokens: EMPTY, warnings: [`${file}: no statically readable config object, Tailwind theme not read`] };
  }

  const theme = findProp(configObj, "theme")?.value;
  if (!theme) return { tokens: EMPTY, warnings: [`${file}: no theme block found`] };
  const extend = findProp(theme, "extend")?.value;

  const groups: Array<[keyof TailwindResult["tokens"], string[]]> = [
    ["colors", ["colors"]],
    ["typography", ["fontFamily", "fontSize"]],
    ["radius", ["borderRadius"]],
    ["spacing", ["spacing"]],
    ["shadows", ["boxShadow"]],
  ];

  const out: TailwindResult["tokens"] = { colors: [], typography: [], radius: [], spacing: [], shadows: [] };
  let nonLiteralTotal = 0;

  for (const [group, keys] of groups) {
    for (const key of keys) {
      // theme.extend wins where both exist, which is how Tailwind merges them.
      for (const source of [theme, extend]) {
        const node = findProp(source, key)?.value;
        if (!node) continue;
        // The group itself may be computed — `colors: generatePalette()` or
        // `spacing: { ...require("./spacing") }`. flatten only inspects an
        // object's members, so a non-object group would otherwise vanish
        // without a word, which is the one outcome worth avoiding: the user
        // would see an empty palette and no reason for it.
        if (node.type !== "ObjectExpression") {
          nonLiteralTotal += 1;
          continue;
        }
        const { pairs, nonLiteral } = flatten(node, file, key === "colors" ? "" : key);
        nonLiteralTotal += nonLiteral;
        for (const pair of pairs) {
          const name = validName(pair.name, counter);
          const value = validCssValue(pair.value, counter);
          if (!name || !value) continue;
          out[group].push({ name, value, source: { file, line: pair.line } });
        }
      }
    }
  }

  const readCount = Object.values(out).reduce((n, list) => n + list.length, 0);
  if (readCount === 0 && nonLiteralTotal === 0) {
    warnings.push(`${file}: a theme block was found but no values could be read from it`);
  }
  if (nonLiteralTotal > 0) {
    warnings.push(
      `${file}: ${nonLiteralTotal} theme value(s) are computed at build time and were not read (the config is never executed)`,
    );
  }
  warnings.push(...dropWarnings(counter, "Tailwind values"));
  return { tokens: out, warnings };
}
