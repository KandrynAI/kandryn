import type { UiStyleComponent } from "@workspace/db";
import { validName } from "./validate.js";

/**
 * Finding a repository's UI roots and its components from the file tree
 * (0042). Pure: everything here takes a path list and returns values.
 */

const UI_EXTENSIONS = [".tsx", ".jsx", ".vue", ".svelte", ".razor"];
/** Angular components are plain .ts, identified by the .component.ts suffix. */
const ANGULAR_SUFFIX = ".component.ts";

const dirOf = (p: string) => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

const isComponentFile = (p: string) =>
  UI_EXTENSIONS.some((e) => p.endsWith(e)) || p.endsWith(ANGULAR_SUFFIX);

const IGNORED = /(^|\/)(node_modules|dist|build|out|\.next|coverage|vendor)(\/|$)/;

/**
 * Directories that look like the root of a UI.
 *
 * A root is a directory holding a manifest that declares a UI framework, an
 * angular.json, or a .csproj next to .razor files. A monorepo therefore
 * yields several, which is the honest answer — Kandryn's own repository has
 * four frontends, and picking one silently would be a guess.
 */
export function findUiRoots(input: {
  tree: string[];
  /** Directory → whether its package.json declares a UI framework. */
  uiManifests: Map<string, boolean>;
}): string[] {
  const roots = new Set<string>();

  for (const [dir, isUi] of input.uiManifests) {
    if (isUi) roots.add(dir);
  }
  for (const path of input.tree) {
    if (IGNORED.test(path)) continue;
    if (baseName(path) === "angular.json") roots.add(dirOf(path));
    if (path.endsWith(".razor")) {
      // The nearest ancestor holding a .csproj owns this Razor view.
      const csproj = input.tree.find(
        (p) => p.endsWith(".csproj") && dirOf(path).startsWith(dirOf(p)),
      );
      if (csproj) roots.add(dirOf(csproj));
    }
  }
  return [...roots].sort();
}

/** How many component files sit under a root — the tiebreak for "primary". */
export function componentFileCount(tree: string[], root: string): number {
  const prefix = root ? `${root}/` : "";
  return tree.filter((p) => p.startsWith(prefix) && !IGNORED.test(p) && isComponentFile(p)).length;
}

/** The root with the most component files; ties broken by the shorter path. */
export function primaryRoot(tree: string[], roots: string[]): string | null {
  if (roots.length === 0) return null;
  return [...roots].sort((a, b) => {
    const d = componentFileCount(tree, b) - componentFileCount(tree, a);
    return d !== 0 ? d : a.length - b.length || a.localeCompare(b);
  })[0];
}

/** Directory names that mark a shared primitive rather than a feature component. */
const PRIMITIVE_DIRS = ["components/ui", "components/common", "components/shared", "shared/ui", "ui"];

function isPrimitive(path: string): boolean {
  return PRIMITIVE_DIRS.some((d) => path.includes(`/${d}/`) || path.startsWith(`${d}/`));
}

/**
 * Turn a repository path into the specifier app code writes for it, using the
 * tsconfig `paths` aliases. "@/*" → "src/*" means src/components/ui/button.tsx
 * imports as "@/components/ui/button".
 */
export function toImportPath(path: string, root: string, aliases: Record<string, string>): string {
  const relToRoot = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const noExt = relToRoot.replace(/\.(tsx|ts|jsx|js|vue|svelte|razor)$/, "").replace(/\/index$/, "");

  for (const [alias, target] of Object.entries(aliases)) {
    // Only wildcard aliases ("@/*": ["./src/*"]) map a whole tree.
    if (!alias.endsWith("/*") || !target.endsWith("/*")) continue;
    const targetPrefix = target.slice(0, -2).replace(/^\.\//, "");
    if (targetPrefix && noExt.startsWith(`${targetPrefix}/`)) {
      return `${alias.slice(0, -2)}/${noExt.slice(targetPrefix.length + 1)}`;
    }
  }
  return noExt;
}

/** A PascalCase export that looks like a component declaration. */
const COMPONENT_EXPORT =
  /export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)|export\s*\{\s*([A-Z][A-Za-z0-9_]*)/;

/**
 * The components under a root.
 *
 * `text` is optional: with it, the exported name is read from the file; without
 * it, the file name is used. A Vue SFC, Svelte file or Razor view is named by
 * its file either way, which is the convention in those frameworks.
 */
export function discoverComponents(input: {
  tree: string[];
  root: string;
  aliases: Record<string, string>;
  /** path → file text, for the subset that was fetched. */
  texts?: Map<string, string>;
  /** sourceFile → inbound import count, from the Graphify graph. */
  importCounts?: Map<string, number> | null;
  limit?: number;
}): UiStyleComponent[] {
  const { tree, root, aliases, texts, importCounts, limit = 40 } = input;
  const prefix = root ? `${root}/` : "";
  const out: UiStyleComponent[] = [];

  for (const path of tree) {
    if (!path.startsWith(prefix) || IGNORED.test(path) || !isComponentFile(path)) continue;
    // Tests, stories and type declarations are not the house style.
    if (/\.(test|spec|stories|d)\.[a-z]+$/.test(path)) continue;

    const file = baseName(path);
    const fallback = file
      .replace(ANGULAR_SUFFIX, "")
      .replace(/\.(tsx|jsx|vue|svelte|razor)$/, "");
    const text = texts?.get(path);
    let name = fallback;
    if (text && (path.endsWith(".tsx") || path.endsWith(".jsx"))) {
      const m = COMPONENT_EXPORT.exec(text);
      if (m) name = m[1] ?? m[2] ?? fallback;
      else if (!/^[A-Z]/.test(fallback)) continue; // no export and not PascalCase
    }
    const safe = validName(name);
    if (!safe) continue;

    out.push({
      name: safe,
      path,
      group: isPrimitive(path) ? "primitive" : "composed",
      importPath: toImportPath(path, root, aliases),
      usedBy: importCounts ? (importCounts.get(path) ?? 0) : null,
      ...(text && /\bcva\s*\(/.test(text) ? { hasVariants: true } : {}),
    });
  }

  // Primitives first, then by measured usage when we have it, then by name —
  // a stable order, so two extractions of an unchanged repo agree.
  out.sort((a, b) => {
    if (a.group !== b.group) return a.group === "primitive" ? -1 : 1;
    if (a.usedBy != null && b.usedBy != null && a.usedBy !== b.usedBy) return b.usedBy - a.usedBy;
    return a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
  });

  return out.slice(0, limit);
}

/**
 * Inbound import counts per source file, from the Graphify graph.
 *
 * Returns null when there is no servable graph: a count derived from the
 * sampled files only would be a count of the sample, which reads as fact and
 * is not one. "Not measured" is the honest answer.
 */
export function importCountsFromGraph(
  graph: { nodes: Array<{ id: string; sourceFile: string }>; edges: Array<{ target: string; relation: string }> } | null,
): Map<string, number> | null {
  if (!graph?.nodes?.length) return null;
  const fileOfNode = new Map(graph.nodes.map((n) => [n.id, n.sourceFile]));
  const counts = new Map<string, number>();
  for (const edge of graph.edges ?? []) {
    if (edge.relation !== "imports" && edge.relation !== "imports_from") continue;
    const file = fileOfNode.get(edge.target);
    if (!file) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}
