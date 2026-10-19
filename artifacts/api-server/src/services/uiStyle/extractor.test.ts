import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUiStyle, MAX_FILES, type FileReader } from "./extractor.js";

/**
 * The orchestrator against whole synthetic repositories.
 *
 * Every repository here is invented. The `read` callback is a map lookup, so
 * nothing touches the network — and nothing is ever executed, which is the
 * guarantee the last test in this file pins directly.
 */

function repo(files: Record<string, string>): { tree: string[]; read: FileReader; reads: string[] } {
  const reads: string[] = [];
  return {
    tree: Object.keys(files),
    reads,
    read: async (path) => {
      reads.push(path);
      return path in files ? { content: files[path], sha: `sha-${path.length}` } : null;
    },
  };
}

const VITE_APP = {
  "package.json": JSON.stringify({
    dependencies: { react: "^18.3.1", "lucide-react": "^0.400.0", clsx: "^2.1.0" },
  }),
  "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
  "src/index.css": `:root {
  --ink: #1b2430;
  --brand: #1d4e77;
  --radius-card: 8px;
  --space-3: 12px;
  --shadow-card: 0 1px 2px rgba(0,0,0,.08);
}
.dark { --ink: #e6efea; }
body { font-family: "Inter", system-ui; }`,
  "src/lib/utils.ts": "export function cn() {}",
  "src/components/ui/button.tsx": "export function Button() { return null }",
  "src/components/ui/card.tsx": "export function Card() { return null }",
  "src/pages/screening.tsx": "export default function ScreeningPage() { return null }",
};

test("a plain React + Vite app extracts tokens, components and conventions", async () => {
  const r = repo(VITE_APP);
  const out = await extractUiStyle({ tree: r.tree, read: r.read });

  assert.equal(out.status, "ready");
  assert.equal(out.uiRoot, "");
  assert.equal(out.framework?.ui, "react");

  const names = out.tokens!.colors.map((t) => t.name);
  assert.ok(names.includes("--ink") && names.includes("--brand"), JSON.stringify(names));
  // The dark override is kept as its own entry, not merged over the light one.
  const inks = out.tokens!.colors.filter((t) => t.name === "--ink");
  assert.deepEqual(inks.map((t) => t.scope), [":root", ".dark"]);
  assert.equal(out.tokens!.radius[0]?.name, "--radius-card");
  assert.equal(out.tokens!.spacing[0]?.name, "--space-3");
  assert.equal(out.tokens!.shadows[0]?.name, "--shadow-card");
  assert.ok(out.tokens!.typography.some((t) => t.value.includes("Inter")));

  assert.deepEqual(
    out.components!.map((c) => `${c.group}:${c.name}`),
    ["primitive:Button", "primitive:Card", "composed:ScreeningPage"],
  );
  assert.equal(out.components![0].importPath, "@/components/ui/button");
  assert.equal(out.components![0].usedBy, null);

  assert.equal(out.conventions?.iconLibrary, "lucide-react");
  assert.equal(out.conventions?.theming, "class");
  assert.equal(out.conventions?.classHelper?.name, "cn");
  assert.ok(out.warnings.some((w) => /not measured/.test(w)));

  // Exemplars are PATHS and a sha. No content is carried anywhere.
  assert.deepEqual(out.exemplars?.map((e) => e.path), ["src/pages/screening.tsx"]);
  assert.ok(out.exemplars!.every((e) => !("content" in e)));
});

test("a backend-only repository is not_applicable, not an error", async () => {
  const r = repo({
    "package.json": JSON.stringify({ dependencies: { express: "^5.0.0", pg: "^8" } }),
    "src/server.ts": "export const app = 1;",
    "README.md": "# api",
  });
  const out = await extractUiStyle({ tree: r.tree, read: r.read });
  assert.equal(out.status, "not_applicable");
  assert.equal(out.uiRoot, null);
  assert.deepEqual(out.uiRootOptions, []);
  assert.equal(out.tokens, null);
});

test("a full-stack repository profiles only the UI side", async () => {
  const r = repo({
    "Api/Api.csproj": "<Project />",
    "Api/Controllers/ClaimsController.cs": "class X {}",
    "client/package.json": JSON.stringify({ dependencies: { react: "18.3.1" } }),
    "client/src/index.css": ":root { --brand: #1d4e77; }",
    "client/src/components/ui/button.tsx": "export function Button() {}",
  });
  const out = await extractUiStyle({ tree: r.tree, read: r.read });
  assert.equal(out.status, "ready");
  assert.equal(out.uiRoot, "client");
  assert.ok(out.components!.every((c) => c.path.startsWith("client/")));
  assert.ok(!r.reads.some((p) => p.endsWith(".cs")), "backend sources are never fetched");
});

test("a monorepo offers every root and picks the largest, and a pinned root is honoured", async () => {
  const files: Record<string, string> = {
    "website/package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "18" } }),
    "website/app/page.tsx": "export default function Page() {}",
    "app/package.json": JSON.stringify({ dependencies: { react: "18.3.1" } }),
    "app/src/components/ui/button.tsx": "export function Button() {}",
    "app/src/components/ui/card.tsx": "export function Card() {}",
    "app/src/pages/board.tsx": "export default function Board() {}",
    "api/package.json": JSON.stringify({ dependencies: { express: "5" } }),
  };
  const r = repo(files);
  const out = await extractUiStyle({ tree: r.tree, read: r.read });
  assert.deepEqual(out.uiRootOptions, ["app", "website"]);
  assert.equal(out.uiRoot, "app", "the root with the most component files wins");

  const pinned = await extractUiStyle({ tree: r.tree, read: repo(files).read, preferredRoot: "website" });
  assert.equal(pinned.uiRoot, "website");
  assert.equal(pinned.framework?.ui, "next");

  // A pinned root that has since vanished falls back and says so.
  const gone = await extractUiStyle({ tree: r.tree, read: repo(files).read, preferredRoot: "legacy-ui" });
  assert.equal(gone.uiRoot, "app");
  assert.ok(gone.warnings.some((w) => /no longer exists/.test(w)));
});

test("usedBy is measured when a graph is supplied", async () => {
  const r = repo(VITE_APP);
  const out = await extractUiStyle({
    tree: r.tree,
    read: r.read,
    graph: {
      nodes: [{ id: "src/components/ui/button.tsx::Button", sourceFile: "src/components/ui/button.tsx" }],
      edges: [
        { target: "src/components/ui/button.tsx::Button", relation: "imports" },
        { target: "src/components/ui/button.tsx::Button", relation: "imports" },
      ],
    },
  });
  assert.equal(out.components!.find((c) => c.name === "Button")?.usedBy, 2);
  assert.ok(!out.warnings.some((w) => /not measured/.test(w)));
});

test("the file budget is never exceeded, and oversize files are skipped", async () => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ dependencies: { react: "18" } }),
    "src/huge.css": "x".repeat(300 * 1024),
  };
  for (let i = 0; i < 200; i++) files[`src/components/ui/c${i}.tsx`] = `export function C${i}() {}`;
  const r = repo(files);
  const out = await extractUiStyle({ tree: r.tree, read: r.read });

  assert.ok(r.reads.length <= MAX_FILES, `fetched ${r.reads.length} files`);
  assert.equal(out.status, "ready");
  // The components still come from the TREE, so the cap on reads does not cap
  // what is discovered.
  assert.equal(out.components!.length, 40);
});

test("the extractor never executes repository code", async () => {
  let executed = false;
  (globalThis as unknown as { __ui_exec?: () => void }).__ui_exec = () => {
    executed = true;
  };
  const r = repo({
    "package.json": JSON.stringify({ dependencies: { react: "18", tailwindcss: "3.4.0" } }),
    "tailwind.config.js": `globalThis.__ui_exec(); module.exports = { theme: { extend: { colors: { brand: "#fff" } } } };`,
    "src/index.css": ":root { --a: 1px; }",
    "src/components/ui/button.tsx": `globalThis.__ui_exec(); export function Button() {}`,
  });
  const out = await extractUiStyle({ tree: r.tree, read: r.read });
  assert.equal(executed, false, "nothing from the repository may run");
  // And it still read the statically-available value.
  assert.ok(out.tokens!.colors.some((t) => t.name === "brand" && t.value === "#fff"));
});

test("a value carrying an injection attempt is dropped and counted", async () => {
  const r = repo({
    "package.json": JSON.stringify({ dependencies: { react: "18" } }),
    "src/index.css": `:root {
  --safe: #1d4e77;
  --evil: url(javascript:alert(1));
  --tag: <script>;
}`,
    "src/components/ui/button.tsx": "export function Button() {}",
  });
  const out = await extractUiStyle({ tree: r.tree, read: r.read });
  const names = out.tokens!.colors.concat(out.tokens!.other).map((t) => t.name);
  assert.ok(names.includes("--safe"));
  assert.ok(!names.includes("--evil") && !names.includes("--tag"));
  assert.ok(out.warnings.some((w) => /dropped by validation/.test(w)), JSON.stringify(out.warnings));
});
