/**
 * The prompt side of the UI style profile (0042, part 2 PR-B): what to inject,
 * when to inject it, and which committed files make a profile out of date.
 *
 * Pure and db-free, like `contextPack.ts` and for the same reason — the budget
 * arithmetic, the applicability rules and the escaping are the parts worth
 * testing, and none of them need a database or a model.
 *
 * The block is REUSE GUIDANCE, not a requirement: it tells a generator what
 * the project already uses so it stops inventing a second design language. The
 * acceptance criteria still win, which the note says in as many words.
 */

import { estimateTokens, type ContextManifest, type ContextManifestUiStyle } from "../contextPack.js";
import type {
  UiStyleComponent,
  UiStyleConventions,
  UiStyleExemplar,
  UiStyleFramework,
  UiStyleToken,
  UiStyleTokens,
} from "@workspace/db";

/** The block's share of a prompt. Small on purpose: the code context is the point. */
export const STYLE_GUIDE_BUDGET_TOKENS = 700;

// Starting caps, before the budget trims anything further. Chosen so a typical
// profile renders whole and a 40-colour one does not drown the components.
const CAP_COLORS = 16;
const CAP_TYPOGRAPHY = 6;
const CAP_RADIUS = 4;
const CAP_SPACING = 6;
const CAP_SHADOWS = 2;
const CAP_COMPONENTS = 15;
const CAP_EXEMPLARS = 3;

const NOTE =
  "How this project's interface is already styled. Reuse it. Do not introduce new colors, fonts, spacing scales, icon sets or UI libraries unless the acceptance criteria require it.";

/** What the builder needs from a profile row. */
export interface StyleGuideInput {
  framework: UiStyleFramework | null;
  tokens: UiStyleTokens | null;
  components: UiStyleComponent[] | null;
  conventions: UiStyleConventions | null;
  exemplars: UiStyleExemplar[] | null;
}

export interface StyleGuideBlock {
  /** The prompt block, or "" when the profile had nothing to say. */
  text: string;
  approxTokens: number;
}

/**
 * Neutralise anything that could close the block early.
 *
 * Every value here passed validation at extraction, which already rejects
 * angle brackets in CSS values and restricts names to a conservative
 * character class. This is the second line: the block is assembled from
 * customer-controlled strings, and a delimiter that can be closed from inside
 * the data is a prompt-injection hole whether or not today's validator leaves
 * one open.
 */
function safe(value: string): string {
  return value.replace(/[<>]/g, "").replace(/"/g, "'").trim();
}

/** A token declared under a dark selector is the dark value of the same name. */
function isDark(token: UiStyleToken): boolean {
  const scope = (token.scope ?? "").toLowerCase();
  return scope.includes(".dark") || scope.includes('dark"') || scope.includes("dark'");
}

function renderToken(token: UiStyleToken): string {
  return `${safe(token.name)} ${safe(token.value)}${isDark(token) ? " (dark)" : ""}`;
}

/**
 * A name a generator can actually write in JSX.
 *
 * The extractor reads the exported identifier from the files it sampled and
 * falls back to the file stem for the rest. A stem is a fine LABEL for the
 * settings tab, but in a prompt "button from '@/components/ui/button'" invites
 * the model to write `<button>` — the HTML element — instead of `<Button>`.
 * Rather than guess the PascalCase form, the block carries only the names that
 * were genuinely read from source.
 */
function hasUsableName(c: UiStyleComponent): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(c.name);
}

/** Primitives first, then by how widely a component is used, then by name. */
export function rankComponents(components: UiStyleComponent[]): UiStyleComponent[] {
  return [...components].filter(hasUsableName).sort((a, b) => {
    if (a.group !== b.group) return a.group === "primitive" ? -1 : 1;
    if (a.usedBy != null && b.usedBy != null && a.usedBy !== b.usedBy) return b.usedBy - a.usedBy;
    return a.name.localeCompare(b.name);
  });
}

function frameworkLine(fw: UiStyleFramework | null): string | null {
  if (!fw) return null;
  const parts: string[] = [];
  if (fw.ui) parts.push(`Framework: ${safe(fw.ui)}${fw.uiVersion ? ` ${safe(fw.uiVersion)}` : ""}.`);
  if (fw.styling.length > 0) {
    parts.push(`Styling: ${fw.styling.map((s) => safe(s.name)).join(", ")}.`);
  }
  if (fw.componentLib) parts.push(`Component library: ${safe(fw.componentLib)}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

function conventionsLine(c: UiStyleConventions | null): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.classHelper) parts.push(`class helper ${safe(c.classHelper.name)} from "${safe(c.classHelper.importPath)}"`);
  if (c.iconLibrary) parts.push(`icons from ${safe(c.iconLibrary)}`);
  if (c.fileNaming && c.fileNaming !== "mixed") parts.push(`component files are ${c.fileNaming}`);
  if (c.theming && c.theming !== "none") {
    const how =
      c.theming === "class" ? "the .dark class" : c.theming === "data-attribute" ? "a data-theme attribute" : "prefers-color-scheme";
    parts.push(`dark mode via ${how}`);
  }
  if (c.colocatedStyles) parts.push("styles live beside their component");
  return parts.length > 0 ? `Conventions: ${parts.join("; ")}.` : null;
}

/**
 * Build the block.
 *
 * Over budget, parts are dropped in the order the spec fixes: spacing, then
 * shadows, then the lowest-ranked components one at a time, then the
 * lowest-ranked colours. The framework line, the conventions and the first
 * colours survive longest because they are what a generator most needs to not
 * invent a parallel design system.
 */
export function buildStyleGuideBlock(
  input: StyleGuideInput,
  budgetTokens: number = STYLE_GUIDE_BUDGET_TOKENS,
): StyleGuideBlock {
  const t = input.tokens;
  let colors = (t?.colors ?? []).slice(0, CAP_COLORS);
  const typography = (t?.typography ?? []).slice(0, CAP_TYPOGRAPHY);
  const radius = (t?.radius ?? []).slice(0, CAP_RADIUS);
  let spacing = (t?.spacing ?? []).slice(0, CAP_SPACING);
  let shadows = (t?.shadows ?? []).slice(0, CAP_SHADOWS);
  let components = rankComponents(input.components ?? []).slice(0, CAP_COMPONENTS);
  const exemplars = (input.exemplars ?? []).slice(0, CAP_EXEMPLARS);

  const fw = frameworkLine(input.framework);
  const conv = conventionsLine(input.conventions);

  const hasAnything =
    fw != null ||
    conv != null ||
    colors.length > 0 ||
    typography.length > 0 ||
    radius.length > 0 ||
    spacing.length > 0 ||
    shadows.length > 0 ||
    components.length > 0 ||
    exemplars.length > 0;
  if (!hasAnything) return { text: "", approxTokens: 0 };

  const render = (): string => {
    const lines: string[] = [`<ui_style_guide note="${NOTE}">`];
    if (fw) lines.push(fw);
    if (colors.length > 0) lines.push(`Use these tokens: ${colors.map(renderToken).join(", ")}`);
    if (typography.length > 0) lines.push(`Typography: ${typography.map(renderToken).join(", ")}`);
    if (radius.length > 0) lines.push(`Radius: ${radius.map(renderToken).join(", ")}`);
    if (spacing.length > 0) lines.push(`Spacing: ${spacing.map(renderToken).join(", ")}`);
    if (shadows.length > 0) lines.push(`Shadows: ${shadows.map(renderToken).join(", ")}`);
    if (components.length > 0) {
      const list = components.map((c) => `${safe(c.name)} from "${safe(c.importPath)}"`).join(", ");
      lines.push(`Reuse these components: ${list}`);
    }
    if (conv) lines.push(conv);
    if (exemplars.length > 0) {
      lines.push(`Example files showing the house style: ${exemplars.map((e) => safe(e.path)).join(", ")}`);
    }
    lines.push("</ui_style_guide>");
    return lines.join("\n");
  };

  let text = render();
  // Trim in the fixed order until it fits. Each step removes the least
  // load-bearing thing left, so a tight budget degrades rather than truncating
  // mid-value.
  while (estimateTokens(text) > budgetTokens) {
    if (spacing.length > 0) spacing = [];
    else if (shadows.length > 0) shadows = [];
    else if (components.length > 0) components = components.slice(0, -1);
    else if (colors.length > 1) colors = colors.slice(0, -1);
    else break;
    text = render();
  }

  return { text, approxTokens: estimateTokens(text) };
}

// ---------------------------------------------------------------------------
// When the block is injected
// ---------------------------------------------------------------------------

/** Extensions that make a file part of the interface. */
const UI_EXTENSIONS = [".tsx", ".jsx", ".vue", ".svelte", ".html", ".css", ".scss", ".razor"];

/**
 * A path that belongs to the project's UI.
 *
 * `uiRoot` is "" for a repository whose UI is at the root, which is why this
 * tests for null rather than falsiness — "" is a real answer, not a missing one.
 */
export function isUiFile(path: string, uiRoot: string | null): boolean {
  if (uiRoot == null) return false;
  const p = path.replace(/^\.?\//, "");
  if (uiRoot !== "" && !p.startsWith(`${uiRoot.replace(/\/$/, "")}/`)) return false;
  const lower = p.toLowerCase();
  return lower.endsWith(".component.ts") || UI_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Words that make a work item read as interface work. */
const UI_WORDS = /\b(page|screen|form|button|dialog|table|layout|style|styles|styling|ui)\b/i;

export function mentionsUiWork(text: string): boolean {
  return UI_WORDS.test(text);
}

export type InjectionReason =
  | "plan_ui_files"
  | "keyword_fallback"
  | "no_profile"
  | "not_ready"
  | "disabled"
  | "no_ui_root"
  | "no_ui_candidates"
  | "no_ui_signal";

export interface InjectionInput {
  profile: { status: string; enabled: boolean; uiRoot: string | null } | null;
  /** The files the change plan will touch, or null when there is no plan. */
  plannedPaths: string[] | null;
  /** `stack_profile.frontend`, used only by the no-plan fallback. */
  stackFrontend: string | null | undefined;
  /** Title + description + acceptance criteria of the work item. */
  workItemText: string;
}

/**
 * Decide whether this run's generation prompt carries the style guide.
 *
 * The primary rule is evidence, not inference: the plan says which files the
 * change touches, and if none of them is a UI file the block is 700 tokens of
 * noise on a backend change. Only when there is no plan at all does it fall
 * back to reading the work item's words — and there it also requires a
 * frontend in the stack profile, because that signal alone is far too loose
 * (every repository with a package.json reports "react").
 *
 * A `stale` profile is deliberately NOT a blocker: out-of-date tokens are
 * still this project's tokens, and the alternative is a generator with no idea
 * what the house style is. The tab says "Out of date"; the run still uses it.
 */
export function decideInjection(input: InjectionInput): { inject: boolean; reason: InjectionReason } {
  const { profile, plannedPaths, stackFrontend, workItemText } = input;
  if (!profile) return { inject: false, reason: "no_profile" };
  if (profile.status !== "ready") return { inject: false, reason: "not_ready" };
  if (!profile.enabled) return { inject: false, reason: "disabled" };
  if (profile.uiRoot == null) return { inject: false, reason: "no_ui_root" };

  if (plannedPaths && plannedPaths.length > 0) {
    return plannedPaths.some((p) => isUiFile(p, profile.uiRoot))
      ? { inject: true, reason: "plan_ui_files" }
      : { inject: false, reason: "no_ui_candidates" };
  }

  const hasFrontend = stackFrontend != null && stackFrontend !== "" && stackFrontend !== "none";
  return hasFrontend && mentionsUiWork(workItemText)
    ? { inject: true, reason: "keyword_fallback" }
    : { inject: false, reason: "no_ui_signal" };
}

// ---------------------------------------------------------------------------
// What makes a profile out of date
// ---------------------------------------------------------------------------

const STYLING_BASENAMES = /^(components\.json)$/i;
const STYLING_STEMS = /^(tailwind\.config|theme|tokens)\b/i;

/**
 * Whether committing this path means the stored profile no longer describes
 * the repository. Deliberately broad and cheap: the consequence of a false
 * positive is a "Re-extract" button appearing, and of a false negative a
 * profile that silently describes last week's styling.
 */
export function isStylingFile(path: string): boolean {
  const p = path.replace(/^\.?\//, "").toLowerCase();
  const base = p.split("/").pop() ?? p;
  if (/\.(css|scss|sass|less)$/.test(base)) return true;
  if (STYLING_BASENAMES.test(base)) return true;
  if (STYLING_STEMS.test(base)) return true;
  return p.split("/").slice(0, -1).includes("ui");
}

export function touchesStyling(paths: string[]): boolean {
  return paths.some(isStylingFile);
}

// ---------------------------------------------------------------------------
// The manifest entry
// ---------------------------------------------------------------------------

/**
 * Add the style guide's record to whatever part 1 already wrote.
 *
 * A run with no ancestors and no documents has no manifest yet, so one is
 * started rather than losing the record of what the prompt carried. Part 1's
 * fields are never rewritten — only `version` is raised, because the shape now
 * has a field a version-1 reader does not know about.
 */
export function mergeUiStyleManifest(
  base: ContextManifest | null,
  entry: ContextManifestUiStyle,
  now: string = new Date().toISOString(),
): ContextManifest {
  const manifest: ContextManifest = base ?? {
    version: 2,
    compiledAt: now,
    budgetTokens: 0,
    usedTokens: 0,
    truncated: false,
    sections: [],
  };
  return { ...manifest, version: 2, uiStyle: entry };
}
