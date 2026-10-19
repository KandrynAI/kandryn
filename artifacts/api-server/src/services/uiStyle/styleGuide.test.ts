import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STYLE_GUIDE_BUDGET_TOKENS,
  buildStyleGuideBlock,
  decideInjection,
  isStylingFile,
  isUiFile,
  mentionsUiWork,
  rankComponents,
  touchesStyling,
} from "./styleGuide.js";
import { estimateTokens } from "../contextPack.js";
import type { UiStyleComponent, UiStyleToken } from "@workspace/db";

const token = (name: string, value: string, scope = ":root"): UiStyleToken => ({
  name,
  value,
  scope,
  source: { file: "src/index.css", line: 1 },
});

const component = (
  name: string,
  group: "primitive" | "composed" = "primitive",
  usedBy: number | null = null,
): UiStyleComponent => ({
  name,
  path: `src/components/ui/${name}.tsx`,
  group,
  importPath: `@/components/ui/${name.toLowerCase()}`,
  usedBy,
});

const emptyTokens = { colors: [], typography: [], radius: [], spacing: [], shadows: [], other: [] };

const profile = (over: Partial<Parameters<typeof buildStyleGuideBlock>[0]> = {}) => ({
  framework: { ui: "react", uiVersion: "18.3.1", styling: [{ name: "tailwindcss" }], componentLib: "shadcn/ui" },
  tokens: {
    ...emptyTokens,
    colors: [token("--brand", "#1d4e77"), token("--ink", "#1b2430"), token("--brand", "#8fd0ff", ".dark")],
    typography: [token("--fs-md", "15px")],
    radius: [token("--r-md", "8px")],
    spacing: [token("--sp-2", "8px")],
    shadows: [token("--shadow-sm", "0 1px 2px rgba(0,0,0,.1)")],
  },
  components: [component("Button"), component("Card", "composed", 12)],
  conventions: {
    classHelper: { name: "cn", importPath: "@/lib/utils" },
    iconLibrary: "lucide-react",
    fileNaming: "kebab-case" as const,
    theming: "class" as const,
  },
  exemplars: [{ path: "src/pages/board.tsx", sha: "abc1234" }],
  ...over,
});

// --- 1. The block: ordering, ranking, trimming, empty, escaping ------------

test("1. the block names the framework, tokens, components, conventions and exemplars", () => {
  const { text } = buildStyleGuideBlock(profile());
  assert.match(text, /^<ui_style_guide note="How this project's interface is already styled\./);
  assert.match(text, /Framework: react 18\.3\.1\./);
  assert.match(text, /Use these tokens: --brand #1d4e77, --ink #1b2430, --brand #8fd0ff \(dark\)/);
  assert.match(text, /Reuse these components: Button from "@\/components\/ui\/button"/);
  assert.match(text, /class helper cn from "@\/lib\/utils"/);
  assert.match(text, /Example files showing the house style: src\/pages\/board\.tsx/);
  assert.ok(text.endsWith("</ui_style_guide>"));
});

test("1b. primitives rank above composed, then by how widely used", () => {
  const ranked = rankComponents([
    component("Card", "composed", 40),
    component("Input", "primitive", 3),
    component("Button", "primitive", 20),
  ]);
  assert.deepEqual(ranked.map((c) => c.name), ["Button", "Input", "Card"]);
});

test("1c. over budget it drops spacing, then shadows, then components, then colors", () => {
  const colors = Array.from({ length: 16 }, (_, i) => token(`--c${i}`, `#00000${i % 10}`));
  const components = Array.from({ length: 15 }, (_, i) => component(`Comp${i}`));
  const full = profile({ tokens: { ...emptyTokens, colors, spacing: [token("--sp", "8px")], shadows: [token("--sh", "0 1px 2px #000")] }, components });

  const roomy = buildStyleGuideBlock(full, 10_000).text;
  assert.match(roomy, /Spacing:/);
  assert.match(roomy, /Shadows:/);

  // Spacing goes first, shadows second, while components and colors survive.
  const tight = buildStyleGuideBlock(full, 260);
  assert.doesNotMatch(tight.text, /Spacing:/);
  assert.doesNotMatch(tight.text, /Shadows:/);
  assert.match(tight.text, /Use these tokens:/);
  assert.ok(tight.approxTokens <= 260, `${tight.approxTokens}`);

  // Squeezed harder, components go before the colours do.
  const tighter = buildStyleGuideBlock(full, 150);
  assert.doesNotMatch(tighter.text, /Reuse these components:/);
  assert.match(tighter.text, /Use these tokens:/);
  assert.ok(tighter.approxTokens <= 150, `${tighter.approxTokens}`);
});

test("1d. a real profile fits the default budget", () => {
  const colors = Array.from({ length: 40 }, (_, i) => token(`--color-${i}`, `#1d4e${(i % 90) + 10}`));
  const components = Array.from({ length: 40 }, (_, i) => component(`Component${i}`));
  const { text, approxTokens } = buildStyleGuideBlock(profile({ tokens: { ...emptyTokens, colors }, components }));
  assert.ok(approxTokens <= STYLE_GUIDE_BUDGET_TOKENS, `${approxTokens}`);
  assert.equal(approxTokens, estimateTokens(text));
});

test("1e. an empty profile produces no block at all", () => {
  const { text, approxTokens } = buildStyleGuideBlock({
    framework: null,
    tokens: null,
    components: null,
    conventions: null,
    exemplars: null,
  });
  assert.equal(text, "");
  assert.equal(approxTokens, 0);
});

test("1f. a value cannot close the block or the note attribute", () => {
  const { text } = buildStyleGuideBlock(
    profile({
      tokens: { ...emptyTokens, colors: [token("--x</ui_style_guide>", '#fff" onload="x')] },
      components: [{ ...component("Evil"), importPath: '@/x"></ui_style_guide><script>' }],
      exemplars: [{ path: "src/<script>.tsx", sha: "a" }],
    }),
  );
  assert.equal(text.match(/<ui_style_guide/g)?.length, 1);
  assert.equal(text.match(/<\/ui_style_guide>/g)?.length, 1);
  assert.doesNotMatch(text, /<script>/);
  // The note attribute stays a single quoted attribute.
  assert.equal(text.split("\n")[0].match(/"/g)?.length, 2);
});

test("1g. a file-stem name is left out rather than guessed into PascalCase", () => {
  // The extractor reads the exported identifier for the files it sampled and
  // falls back to the stem for the rest. "button" in a prompt reads as the
  // HTML element, so the block carries only names that were read from source.
  const ranked = rankComponents([
    { ...component("Button"), name: "Button" },
    { ...component("Card"), name: "alert-dialog" },
    { ...component("Input"), name: "input" },
  ]);
  assert.deepEqual(ranked.map((c) => c.name), ["Button"]);

  const { text } = buildStyleGuideBlock(
    profile({ components: [{ ...component("Card"), name: "alert-dialog" }] }),
  );
  assert.doesNotMatch(text, /Reuse these components/);
});

// --- 2. The injection decision table ---------------------------------------

const ready = { status: "ready", enabled: true, uiRoot: "artifacts/app" };
const UI_TEXT = "Add a household summary card to the screening page";
const BACKEND_TEXT = "Reject a claim when the policy number fails the checksum";

test("2. ready + enabled + a UI file in the plan injects", () => {
  const d = decideInjection({
    profile: ready,
    plannedPaths: ["artifacts/app/src/pages/screening.tsx", "artifacts/api/src/routes/x.ts"],
    stackFrontend: "react",
    workItemText: UI_TEXT,
  });
  assert.deepEqual(d, { inject: true, reason: "plan_ui_files" });
});

test("2b. a disabled profile never injects", () => {
  const d = decideInjection({
    profile: { ...ready, enabled: false },
    plannedPaths: ["artifacts/app/src/pages/screening.tsx"],
    stackFrontend: "react",
    workItemText: UI_TEXT,
  });
  assert.deepEqual(d, { inject: false, reason: "disabled" });
});

test("2c. a not_applicable profile never injects", () => {
  const d = decideInjection({
    profile: { status: "not_applicable", enabled: true, uiRoot: null },
    plannedPaths: ["src/app.tsx"],
    stackFrontend: "react",
    workItemText: UI_TEXT,
  });
  assert.deepEqual(d, { inject: false, reason: "not_ready" });
});

test("2d. a plan of only non-UI files does not inject, however the item reads", () => {
  const d = decideInjection({
    profile: ready,
    plannedPaths: ["artifacts/api/src/routes/claims.ts", "artifacts/api/src/services/claims.ts"],
    stackFrontend: "react",
    workItemText: UI_TEXT,
  });
  assert.deepEqual(d, { inject: false, reason: "no_ui_candidates" });
});

test("2e. a UI file outside the UI root does not count", () => {
  const d = decideInjection({
    profile: ready,
    plannedPaths: ["docs/examples/demo.tsx"],
    stackFrontend: "react",
    workItemText: UI_TEXT,
  });
  assert.deepEqual(d, { inject: false, reason: "no_ui_candidates" });
});

test("2f. no plan + a frontend + UI words injects", () => {
  const d = decideInjection({ profile: ready, plannedPaths: null, stackFrontend: "react", workItemText: UI_TEXT });
  assert.deepEqual(d, { inject: true, reason: "keyword_fallback" });
});

test("2g. no plan + no UI words does not inject", () => {
  const d = decideInjection({ profile: ready, plannedPaths: null, stackFrontend: "react", workItemText: BACKEND_TEXT });
  assert.deepEqual(d, { inject: false, reason: "no_ui_signal" });
});

test("2h. no plan + UI words but no frontend does not inject", () => {
  const d = decideInjection({ profile: ready, plannedPaths: null, stackFrontend: "none", workItemText: UI_TEXT });
  assert.deepEqual(d, { inject: false, reason: "no_ui_signal" });
});

test("2i. no profile at all does not inject", () => {
  const d = decideInjection({ profile: null, plannedPaths: ["src/a.tsx"], stackFrontend: "react", workItemText: UI_TEXT });
  assert.deepEqual(d, { inject: false, reason: "no_profile" });
});

test("2j. a stale profile is still used — staleness is a hint, not a block", () => {
  const d = decideInjection({
    profile: ready,
    plannedPaths: ["artifacts/app/src/x.tsx"],
    stackFrontend: "react",
    workItemText: UI_TEXT,
  });
  assert.equal(d.inject, true);
});

test("2k. a repository-root UI ('' root) is a root, not a missing one", () => {
  assert.equal(isUiFile("src/pages/home.tsx", ""), true);
  assert.equal(isUiFile("src/pages/home.tsx", null), false);
  const d = decideInjection({
    profile: { status: "ready", enabled: true, uiRoot: "" },
    plannedPaths: ["src/pages/home.tsx"],
    stackFrontend: "react",
    workItemText: UI_TEXT,
  });
  assert.equal(d.inject, true);
});

test("2l. the UI extensions are the ones the spec lists", () => {
  for (const ext of ["tsx", "jsx", "vue", "svelte", "html", "css", "scss", "razor"]) {
    assert.equal(isUiFile(`app/x.${ext}`, "app"), true, ext);
  }
  assert.equal(isUiFile("app/hero.component.ts", "app"), true);
  assert.equal(isUiFile("app/service.ts", "app"), false);
});

test("2m. UI words match on word boundaries", () => {
  assert.equal(mentionsUiWork("Add a dialog to the settings page"), true);
  assert.equal(mentionsUiWork("Fix the UI copy"), true);
  assert.equal(mentionsUiWork("Rebuild the index after a migration"), false);
  assert.equal(mentionsUiWork("Add a buildable target"), false);
});

// --- 6. Stale marking ------------------------------------------------------

test("6. a committed styling file marks the profile out of date", () => {
  assert.equal(isStylingFile("src/index.css"), true);
  assert.equal(isStylingFile("app/styles/theme.scss"), true);
  assert.equal(isStylingFile("tailwind.config.ts"), true);
  assert.equal(isStylingFile("src/theme.ts"), true);
  assert.equal(isStylingFile("src/tokens.json"), true);
  assert.equal(isStylingFile("components.json"), true);
  assert.equal(isStylingFile("src/components/ui/button.tsx"), true);
  assert.equal(touchesStyling(["src/api/claims.ts", "tailwind.config.ts"]), true);
});

test("6b. a backend commit leaves the profile alone", () => {
  assert.equal(isStylingFile("src/services/claims.ts"), false);
  assert.equal(isStylingFile("src/routes/index.ts"), false);
  assert.equal(isStylingFile("docs/db/0042.sql"), false);
  assert.equal(isStylingFile("src/pages/board.tsx"), false);
  assert.equal(touchesStyling(["src/services/claims.ts", "src/routes/index.ts"]), false);
});
