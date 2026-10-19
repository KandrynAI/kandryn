import type {
  UiStyleComponent,
  UiStyleConventions,
  UiStyleExemplar,
  UiStyleFramework,
  UiStyleToken,
  UiStyleTokens,
} from "@workspace/db";
import { extractCssTokens, extractFontFamilies, extractScssVariables } from "./cssTokens.js";
import { extractTailwindConfig } from "./tailwind.js";
import { readComponentsJson, readPackageManifest, readTsconfigAliases } from "./manifest.js";
import {
  discoverComponents,
  findUiRoots,
  importCountsFromGraph,
  primaryRoot,
  toImportPath,
} from "./components.js";
import { validPath } from "./validate.js";

/**
 * Turn a repository into a UI style profile (0042).
 *
 * The orchestrator is pure apart from the `read` callback it is handed, so the
 * whole thing runs against a fake repository in tests. Nothing from the
 * repository is executed at any point — files are fetched as text and parsed.
 */

/** At most this many files are fetched, whatever the repository's size. */
export const MAX_FILES = 40;
/** Files larger than this are skipped rather than parsed. */
export const MAX_FILE_BYTES = 200 * 1024;
/** Soft budget; checked between batches, never mid-parse. */
export const EXTRACT_BUDGET_MS = 60_000;

const CAPS = { colors: 40, typography: 12, radius: 8, spacing: 12, shadows: 6, other: 20 } as const;

export type FileReader = (path: string) => Promise<{ content: string; sha: string } | null>;

export interface ExtractInput {
  tree: string[];
  read: FileReader;
  graph?: { nodes: Array<{ id: string; sourceFile: string }>; edges: Array<{ target: string; relation: string }> } | null;
  /** Set by the caller when the user pinned a root; otherwise detected. */
  preferredRoot?: string | null;
  now?: () => number;
}

export interface ExtractResult {
  status: "ready" | "not_applicable";
  uiRoot: string | null;
  uiRootOptions: string[];
  framework: UiStyleFramework | null;
  tokens: UiStyleTokens | null;
  components: UiStyleComponent[] | null;
  conventions: UiStyleConventions | null;
  exemplars: UiStyleExemplar[] | null;
  warnings: string[];
}

const dirOf = (p: string) => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

const TOKEN_FILE = /(index|globals?|app|main|tokens?|variables?|theme|styles?)\.(css|scss|sass)$/i;
const IGNORED = /(^|\/)(node_modules|dist|build|out|\.next|coverage|vendor)(\/|$)/;

function groupToken(t: UiStyleToken): keyof UiStyleTokens {
  const n = t.name.toLowerCase();
  const v = t.value.toLowerCase();
  if (/radius/.test(n)) return "radius";
  if (/shadow/.test(n)) return "shadows";
  if (/font|text|leading|tracking|^fontsize|fontfamily/.test(n)) return "typography";
  if (/spacing|gap|space|^size/.test(n)) return "spacing";
  if (
    /color|bg|background|fg|foreground|ink|text-|border|accent|brand|primary|secondary|muted|destructive|ring|hairline|surface/.test(n) ||
    /^#|^rgb|^hsl|^oklch|^color\(/.test(v)
  ) {
    return "colors";
  }
  return "other";
}

/**
 * Extract a profile.
 *
 * Returns `not_applicable` when no UI root can be found from file markers —
 * deliberately NOT from `stack_profile.frontend`, which reports "react" for
 * any repository containing a package.json and would label every Node backend
 * as having an interface.
 */
export async function extractUiStyle(input: ExtractInput): Promise<ExtractResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const warnings: string[] = [];
  const tree = input.tree.filter((p) => !IGNORED.test(p));
  const treeSet = new Set(tree);
  let budget = MAX_FILES;

  /** Fetch one file, honouring the file and size caps. */
  const fetchText = async (path: string): Promise<string | null> => {
    if (budget <= 0) return null;
    if (!treeSet.has(path)) return null;
    budget -= 1;
    const file = await input.read(path);
    if (!file) return null;
    if (file.content.length > MAX_FILE_BYTES) {
      warnings.push(`${path}: larger than 200 KB, skipped`);
      return null;
    }
    return file.content;
  };

  // --- 1. Candidate roots, from manifests and framework markers ------------
  const manifestPaths = tree.filter((p) => base(p) === "package.json").slice(0, 12);
  const uiManifests = new Map<string, boolean>();
  const manifestByDir = new Map<string, ReturnType<typeof readPackageManifest>>();
  for (const path of manifestPaths) {
    const text = await fetchText(path);
    if (!text) continue;
    const info = readPackageManifest(path, text);
    warnings.push(...info.warnings);
    uiManifests.set(dirOf(path), info.isUi);
    manifestByDir.set(dirOf(path), info);
  }

  const roots = findUiRoots({ tree, uiManifests });
  if (roots.length === 0) {
    return {
      status: "not_applicable",
      uiRoot: null,
      uiRootOptions: [],
      framework: null,
      tokens: null,
      components: null,
      conventions: null,
      exemplars: null,
      warnings,
    };
  }

  const root =
    input.preferredRoot && roots.includes(input.preferredRoot)
      ? input.preferredRoot
      : (primaryRoot(tree, roots) ?? roots[0]);
  if (input.preferredRoot && !roots.includes(input.preferredRoot)) {
    warnings.push(`The chosen UI location "${input.preferredRoot}" no longer exists; used "${root}" instead`);
  }

  const underRoot = (p: string) => (root ? p.startsWith(`${root}/`) : true);
  const manifest = manifestByDir.get(root);
  const framework: UiStyleFramework = manifest?.framework ?? { ui: null, styling: [] };

  // --- 2. Aliases and the component-library marker -------------------------
  let aliases: Record<string, string> = {};
  const tsconfigPath = [`${root}/tsconfig.json`, "tsconfig.json"].find((p) => treeSet.has(p));
  if (tsconfigPath) {
    const text = await fetchText(tsconfigPath);
    if (text) aliases = readTsconfigAliases(text);
  }
  const componentsJsonPath = [`${root}/components.json`, "components.json"].find((p) => treeSet.has(p));
  if (componentsJsonPath) {
    const text = await fetchText(componentsJsonPath);
    const parsed = text ? readComponentsJson(text) : null;
    if (parsed) framework.componentLib = parsed.componentLib;
  }

  // --- 3. Tokens -----------------------------------------------------------
  const collected: UiStyleToken[] = [];
  // Tailwind v4 projects express dark mode as `@custom-variant dark (&:is(.dark *))`
  // rather than a `.dark { --token: … }` block, so scope alone cannot see it.
  let darkVariantDeclared = false;
  const styleFiles = tree
    .filter((p) => underRoot(p) && TOKEN_FILE.test(base(p)))
    .sort((a, b) => a.length - b.length)
    .slice(0, 8);

  for (const path of styleFiles) {
    if (now() - started > EXTRACT_BUDGET_MS) break;
    const text = await fetchText(path);
    if (!text) continue;
    if (path.endsWith(".scss") || path.endsWith(".sass")) {
      const scss = extractScssVariables(path, text);
      collected.push(...scss.tokens);
      warnings.push(...scss.warnings);
    }
    if (/@custom-variant\s+dark\b/.test(text)) darkVariantDeclared = true;
    const css = await extractCssTokens(path, text);
    collected.push(...css.tokens);
    warnings.push(...css.warnings);
    const fonts = await extractFontFamilies(path, text);
    collected.push(...fonts.tokens);
    warnings.push(...fonts.warnings);
  }

  const tokens: UiStyleTokens = { colors: [], typography: [], radius: [], spacing: [], shadows: [], other: [] };
  for (const t of collected) tokens[groupToken(t)].push(t);

  const tailwindPath = tree.find(
    (p) => underRoot(p) && /^tailwind\.config\.(js|cjs|mjs|ts)$/.test(base(p)),
  );
  if (tailwindPath) {
    const text = await fetchText(tailwindPath);
    if (text) {
      const tw = await extractTailwindConfig(tailwindPath, text);
      tokens.colors.push(...tw.tokens.colors);
      tokens.typography.push(...tw.tokens.typography);
      tokens.radius.push(...tw.tokens.radius);
      tokens.spacing.push(...tw.tokens.spacing);
      tokens.shadows.push(...tw.tokens.shadows);
      warnings.push(...tw.warnings);
    }
  }

  for (const key of Object.keys(tokens) as Array<keyof UiStyleTokens>) {
    const cap = CAPS[key];
    if (tokens[key].length > cap) {
      warnings.push(`${key}: ${tokens[key].length} found, kept the first ${cap}`);
      tokens[key] = tokens[key].slice(0, cap);
    }
  }

  // --- 4. Components -------------------------------------------------------
  const importCounts = importCountsFromGraph(input.graph ?? null);
  if (!importCounts) warnings.push("No current knowledge graph, so component usage was not measured");

  // Read a sample of component files so exported names and cva() are real
  // rather than inferred from file names.
  const sampleTexts = new Map<string, string>();
  const sampleCandidates = tree
    .filter((p) => underRoot(p) && /\.(tsx|jsx)$/.test(p) && !/\.(test|spec|stories|d)\./.test(p))
    .slice(0, Math.max(0, Math.min(budget - 2, 12)));
  for (const path of sampleCandidates) {
    if (now() - started > EXTRACT_BUDGET_MS) break;
    const text = await fetchText(path);
    if (text) sampleTexts.set(path, text);
  }

  const components = discoverComponents({ tree, root, aliases, texts: sampleTexts, importCounts });

  // --- 5. Conventions ------------------------------------------------------
  const utilsPath = tree.find((p) => underRoot(p) && /(^|\/)lib\/utils\.(ts|js)$/.test(p));
  const pascal = components.filter((c) => /^[A-Z]/.test(base(c.path))).length;
  const kebab = components.filter((c) => /^[a-z][a-z0-9-]*\./.test(base(c.path))).length;
  // Judged from everything collected, not from the capped lists: a repository
  // with 140 colours would otherwise lose its .dark block to the cap and be
  // reported as having no theming at all.
  const darkClass = darkVariantDeclared || collected.some((t) => t.scope?.includes(".dark"));
  const dataTheme = collected.some((t) => t.scope?.includes("data-theme"));
  const prefersScheme = collected.some((t) => t.scope?.includes("prefers-color-scheme"));

  const conventions: UiStyleConventions = {
    classHelper:
      manifest?.classHelper && utilsPath
        ? { name: "cn", importPath: toImportPath(utilsPath, root, aliases) }
        : manifest?.classHelper
          ? { name: manifest.classHelper, importPath: manifest.classHelper }
          : null,
    iconLibrary: manifest?.iconLibrary ?? null,
    primitives: manifest?.primitives ?? [],
    fileNaming: pascal > kebab * 2 ? "PascalCase" : kebab > pascal * 2 ? "kebab-case" : "mixed",
    colocatedStyles: tree.some((p) => underRoot(p) && /\.module\.(css|scss)$/.test(p)),
    theming: darkClass ? "class" : dataTheme ? "data-attribute" : prefersScheme ? "prefers-color-scheme" : "none",
    layoutShell:
      components.find((c) => /^(AppShell|Layout|Shell|Sidebar)$/.test(c.name))?.name ?? null,
  };

  // --- 6. Exemplars (paths only; contents are never stored or injected) ----
  const exemplars: UiStyleExemplar[] = [];
  // Prefer a feature component — it shows how the primitives are put together
  // — but never come back empty just because the cap filled with primitives.
  const composed = components.filter((c) => c.group === "composed");
  const exemplarCandidates = (composed.length > 0 ? composed : components).slice(0, 3).map((c) => c.path);
  for (const path of exemplarCandidates) {
    if (exemplars.length >= 3 || budget <= 0) break;
    const safe = validPath(path, treeSet);
    if (!safe) continue;
    const file = await input.read(safe);
    budget -= 1;
    if (file) exemplars.push({ path: safe, sha: file.sha });
  }

  if (now() - started > EXTRACT_BUDGET_MS) {
    warnings.push("Extraction hit its time budget; the profile may be incomplete");
  }

  return {
    status: "ready",
    uiRoot: root,
    uiRootOptions: roots,
    framework,
    tokens,
    components,
    conventions,
    exemplars,
    warnings,
  };
}
