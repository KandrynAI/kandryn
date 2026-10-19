import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCssTokens, extractScssVariables, extractFontFamilies } from "./cssTokens.js";
import { extractTailwindConfig } from "./tailwind.js";
import { readPackageManifest, readComponentsJson, readTsconfigAliases } from "./manifest.js";
import {
  discoverComponents,
  findUiRoots,
  importCountsFromGraph,
  primaryRoot,
  toImportPath,
} from "./components.js";
import { validCssValue, validName, validPath, newDropCounter } from "./validate.js";

/**
 * The deterministic extractors, on made-up fixtures.
 *
 * The property that matters most is the one test 2 pins: a Tailwind config
 * containing a function call is PARSED and reported, never executed. Every
 * other guarantee here follows from the same stance — the customer's
 * repository is input, not code we run.
 */

test("1. CSS custom properties keep their selector, ignore comments, and carry line numbers", async () => {
  const css = `/* design tokens
   --fake: not-real;  <- inside a comment, must be ignored */
:root {
  --bg-app: #0b1110;
  --accent: hsl(164 78% 43%);
}

.card { padding: 12px; --local-only: 4px; }

.dark {
  --bg-app: #06100d;
}

[data-theme="light"] {
  --bg-app: #ffffff;
}
`;
  const { tokens } = await extractCssTokens("src/index.css", css);
  const bg = tokens.filter((t) => t.name === "--bg-app");
  assert.equal(bg.length, 3, `expected three scoped values, got ${JSON.stringify(bg)}`);
  assert.deepEqual(
    bg.map((t) => t.scope),
    [":root", ".dark", '[data-theme="light"]'],
  );
  assert.equal(bg[0].value, "#0b1110");
  assert.equal(bg[0].source.file, "src/index.css");
  assert.equal(bg[0].source.line, 4, "line number points at the declaration");

  // A property under a component selector is not a token.
  assert.ok(!tokens.some((t) => t.name === "--local-only"));
  // The commented-out property never appears.
  assert.ok(!tokens.some((t) => t.name === "--fake"));
});

test("2. a Tailwind v3 config is read statically; a computed one warns and never runs", async () => {
  const ok = `
import type { Config } from "tailwindcss";
export default {
  theme: {
    extend: {
      colors: { brand: { 500: "#1d4e77" }, ink: "#1b2430" },
      fontFamily: { sans: ["Inter", "system-ui"] },
      borderRadius: { card: "8px" },
    },
  },
} satisfies Config;
`;
  const good = await extractTailwindConfig("tailwind.config.ts", ok);
  assert.deepEqual(
    good.tokens.colors.map((t) => `${t.name}=${t.value}`).sort(),
    ["brand-500=#1d4e77", "ink=#1b2430"],
  );
  assert.equal(good.tokens.typography.find((t) => t.name === "fontFamily-sans")?.value, "Inter, system-ui");
  assert.equal(good.tokens.radius.find((t) => t.name === "borderRadius-card")?.value, "8px");
  assert.ok(good.tokens.colors[0].source.line > 0);

  // The dangerous case: a config that computes its theme. It must be parsed,
  // reported and left alone — never required, imported or evaluated.
  let executed = false;
  (globalThis as unknown as { __tw_exec?: () => void }).__tw_exec = () => {
    executed = true;
  };
  const computed = `
const generate = require("./palette");
module.exports = {
  theme: {
    extend: {
      colors: generate(),
      spacing: { ...require("./spacing") },
      fontSize: globalThis.__tw_exec() ? { sm: "13px" } : { sm: "14px" },
    },
  },
};
`;
  const risky = await extractTailwindConfig("tailwind.config.js", computed);
  assert.equal(executed, false, "the config must never be executed");
  assert.equal(risky.tokens.colors.length, 0);
  assert.ok(
    risky.warnings.some((w) => /computed at build time/.test(w)),
    JSON.stringify(risky.warnings),
  );

  // And a config that is not parseable at all returns empty, never throws.
  const broken = await extractTailwindConfig("tailwind.config.js", "module.exports = { theme: { ");
  assert.equal(broken.tokens.colors.length, 0);
  assert.ok(broken.warnings.length > 0);
});

test("3. a Tailwind v4 @theme block reads as tokens", async () => {
  const css = `@import "tailwindcss";

@theme {
  --color-brand: #1d4e77;
  --font-sans: "Inter", system-ui;
  --radius-card: 8px;
}
`;
  const { tokens } = await extractCssTokens("src/app.css", css);
  assert.deepEqual(
    tokens.map((t) => t.name).sort(),
    ["--color-brand", "--font-sans", "--radius-card"],
  );
  assert.equal(tokens[0].scope, "@theme");
});

test("4. SCSS variables are read, comments and !default handled", () => {
  const scss = `// palette
$brand: #1d4e77;
$ink: #1b2430 !default;
/* $commented: #fff; */
$radius: 6px; // inline note
`;
  const { tokens } = extractScssVariables("src/_variables.scss", scss);
  assert.deepEqual(
    tokens.map((t) => `${t.name}=${t.value}`),
    ["$brand=#1d4e77", "$ink=#1b2430", "$radius=6px"],
  );
  assert.equal(tokens[2].source.line, 5);
});

test("5. package.json detects the framework, styling and versions", () => {
  const react = readPackageManifest(
    "artifacts/app/package.json",
    JSON.stringify({
      dependencies: { react: "^18.3.1", tailwindcss: "3.4.1", "lucide-react": "^0.400.0", clsx: "^2" },
      devDependencies: { sass: "^1.70.0" },
    }),
  );
  assert.equal(react.framework.ui, "react");
  assert.equal(react.framework.uiVersion, "18.3.1");
  assert.deepEqual(react.framework.styling.map((s) => s.name).sort(), ["Sass/SCSS", "tailwindcss"]);
  assert.equal(react.iconLibrary, "lucide-react");
  assert.equal(react.classHelper, "clsx");
  assert.equal(react.isUi, true);

  // Next beats React, since both are always present together.
  const next = readPackageManifest("web/package.json", JSON.stringify({ dependencies: { next: "15.0.0", react: "18" } }));
  assert.equal(next.framework.ui, "next");

  const angular = readPackageManifest(
    "app/package.json",
    JSON.stringify({ dependencies: { "@angular/core": "17.0.0", "@angular/material": "17.0.0" } }),
  );
  assert.equal(angular.framework.ui, "angular");
  assert.deepEqual(angular.framework.styling.map((s) => s.name), ["Angular Material"]);

  // A backend package is not a UI — the point the stack detector gets wrong.
  const backend = readPackageManifest("api/package.json", JSON.stringify({ dependencies: { express: "5" } }));
  assert.equal(backend.isUi, false);
  assert.equal(backend.framework.ui, null);

  // Malformed JSON is a warning, not a throw.
  const bad = readPackageManifest("x/package.json", "{nope");
  assert.equal(bad.isUi, false);
  assert.equal(bad.warnings.length, 1);

  assert.equal(readComponentsJson(JSON.stringify({ aliases: { ui: "@/components/ui" } }))?.componentLib, "shadcn/ui");
});

test("6. components: primitive versus composed, and tsconfig alias resolution", () => {
  const aliases = readTsconfigAliases(`{
    // a comment, because tsconfig is JSONC in practice
    "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } },
  }`);
  assert.deepEqual(aliases, { "@/*": ["./src/*"][0] });

  assert.equal(toImportPath("src/components/ui/button.tsx", "", aliases), "@/components/ui/button");
  assert.equal(toImportPath("src/pages/dashboard.tsx", "", aliases), "@/pages/dashboard");
  // Outside the aliased tree, the path stands as written.
  assert.equal(toImportPath("lib/helper.ts", "", aliases), "lib/helper");

  const tree = [
    "src/components/ui/button.tsx",
    "src/components/ui/dialog.tsx",
    "src/components/board/ProjectCard.tsx",
    "src/components/ui/button.test.tsx",
    "src/types.d.ts",
    "node_modules/pkg/index.tsx",
  ];
  const comps = discoverComponents({ tree, root: "", aliases });
  assert.deepEqual(
    comps.map((c) => `${c.group}:${c.name}`),
    ["primitive:button", "primitive:dialog", "composed:ProjectCard"],
  );
  assert.equal(comps[0].importPath, "@/components/ui/button");
  assert.equal(comps[0].usedBy, null, "unmeasured usage is null, never a guess");
});

test("6b. usedBy comes from the graph, and only from the graph", () => {
  const graph = {
    nodes: [
      { id: "src/components/ui/button.tsx::Button", sourceFile: "src/components/ui/button.tsx" },
      { id: "src/components/ui/dialog.tsx::Dialog", sourceFile: "src/components/ui/dialog.tsx" },
    ],
    edges: [
      { target: "src/components/ui/button.tsx::Button", relation: "imports" },
      { target: "src/components/ui/button.tsx::Button", relation: "imports_from" },
      { target: "src/components/ui/dialog.tsx::Dialog", relation: "calls" },
    ],
  };
  const counts = importCountsFromGraph(graph);
  assert.equal(counts?.get("src/components/ui/button.tsx"), 2);
  assert.equal(counts?.get("src/components/ui/dialog.tsx"), undefined, "only import edges count");

  assert.equal(importCountsFromGraph(null), null);
  assert.equal(importCountsFromGraph({ nodes: [], edges: [] }), null);

  const comps = discoverComponents({
    tree: ["src/components/ui/button.tsx", "src/components/ui/dialog.tsx"],
    root: "",
    aliases: {},
    importCounts: counts,
  });
  // Most-imported first within a group.
  assert.deepEqual(comps.map((c) => [c.name, c.usedBy]), [["button", 2], ["dialog", 0]]);
});

test("7. validation drops dangerous and over-long values, and counts them", () => {
  const c = newDropCounter();
  assert.equal(validCssValue("url(javascript:alert(1))", c), null);
  assert.equal(validCssValue("expression(alert(1))", c), null);
  assert.equal(validCssValue("<script>", c), null);
  assert.equal(validCssValue("`${x}`", c), null);
  assert.equal(validCssValue("x".repeat(81), c), null);
  assert.equal(validCssValue("@import url(x)", c), null);
  assert.equal(c.dropped, 6);

  // Legitimate values survive, including multi-part ones.
  assert.equal(validCssValue("  #1d4e77 "), "#1d4e77");
  assert.equal(validCssValue("0 1px 2px rgba(0,0,0,.08)"), "0 1px 2px rgba(0,0,0,.08)");
  assert.equal(validCssValue('"Inter", system-ui'), '"Inter", system-ui');

  assert.equal(validName("--bg-app"), "--bg-app");
  assert.equal(validName("@/components/ui/button"), "@/components/ui/button");
  assert.equal(validName("bad name with spaces"), null);
  assert.equal(validName("x".repeat(81)), null);

  const tree = new Set(["src/index.css"]);
  assert.equal(validPath("src/index.css", tree), "src/index.css");
  assert.equal(validPath("../../etc/passwd", tree), null, "a path we never listed is refused");
});

test("8. caps are respected and ordering is stable", () => {
  const tree = Array.from({ length: 60 }, (_, i) => `src/components/ui/c${String(i).padStart(2, "0")}.tsx`);
  const first = discoverComponents({ tree, root: "", aliases: {} });
  const second = discoverComponents({ tree: [...tree].reverse(), root: "", aliases: {} });
  assert.equal(first.length, 40);
  assert.deepEqual(
    first.map((c) => c.name),
    second.map((c) => c.name),
    "the same repository must extract to the same order whatever the tree order",
  );
});

test("9. a repository with no UI yields no roots", () => {
  const tree = ["api/package.json", "api/src/server.ts", "README.md"];
  const roots = findUiRoots({ tree, uiManifests: new Map([["api", false]]) });
  assert.deepEqual(roots, []);
  assert.equal(primaryRoot(tree, roots), null);
});

test("10. a monorepo yields several roots and the largest is primary", () => {
  const tree = [
    "website/package.json",
    "website/app/page.tsx",
    "artifacts/dev-copilot/package.json",
    "artifacts/dev-copilot/src/components/ui/button.tsx",
    "artifacts/dev-copilot/src/components/ui/dialog.tsx",
    "artifacts/dev-copilot/src/pages/board.tsx",
    "artifacts/api-server/package.json",
    "artifacts/api-server/src/app.ts",
  ];
  const roots = findUiRoots({
    tree,
    uiManifests: new Map([
      ["website", true],
      ["artifacts/dev-copilot", true],
      ["artifacts/api-server", false],
    ]),
  });
  assert.deepEqual(roots, ["artifacts/dev-copilot", "website"]);
  assert.equal(primaryRoot(tree, roots), "artifacts/dev-copilot");
  // The backend is never offered as a UI location.
  assert.ok(!roots.includes("artifacts/api-server"));
});

test("angular and razor roots are found from their own markers", () => {
  const ngTree = ["app/angular.json", "app/src/app/home.component.ts"];
  assert.deepEqual(findUiRoots({ tree: ngTree, uiManifests: new Map() }), ["app"]);

  const razorTree = ["Web/Web.csproj", "Web/Pages/Index.razor"];
  assert.deepEqual(findUiRoots({ tree: razorTree, uiManifests: new Map() }), ["Web"]);

  const ngComps = discoverComponents({ tree: ngTree, root: "app", aliases: {} });
  assert.deepEqual(ngComps.map((c) => c.name), ["home"]);
});

test("font families are collected from plain CSS", async () => {
  const { tokens } = await extractFontFamilies(
    "src/index.css",
    `body { font-family: "Inter", system-ui; }\nh1 { font-family: "Inter", system-ui; }\ncode { font-family: "JetBrains Mono", monospace; }`,
  );
  assert.equal(tokens.length, 2, "duplicates collapse");
  assert.equal(tokens[0].value, '"Inter", system-ui');
});
