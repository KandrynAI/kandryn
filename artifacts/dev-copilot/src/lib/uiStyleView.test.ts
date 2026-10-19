import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evidenceLabel,
  groupColorsByScheme,
  isSettling,
  orderComponents,
  shortRef,
  statusLabel,
  swatchColor,
  type StyleComponent,
  type StyleToken,
} from "./uiStyleView.ts";

const tok = (name: string, value: string, scope?: string): StyleToken => ({
  name,
  value,
  scope,
  source: { file: "src/index.css", line: 3 },
});

test("the status chip reads the status and staleness together", () => {
  assert.equal(statusLabel("ready", false), "Ready");
  assert.equal(statusLabel("ready", true), "Out of date");
  assert.equal(statusLabel("pending", false), "Analyzing");
  assert.equal(statusLabel("extracting", false), "Analyzing");
  assert.equal(statusLabel("not_applicable", false), "Not applicable");
  assert.equal(statusLabel("failed", false), "Failed");
  assert.equal(statusLabel("none", false), "Not analyzed");

  assert.equal(isSettling("pending"), true);
  assert.equal(isSettling("extracting"), true);
  assert.equal(isSettling("ready"), false, "a finished profile must stop the poll");
});

test("light and dark values of the same token are kept apart", () => {
  const { light, dark } = groupColorsByScheme([
    tok("--ink", "#1b2430", ":root"),
    tok("--ink", "#e6efea", ".dark"),
    tok("--brand", "#1d4e77", ":root"),
    tok("--bg", "#fff", '[data-theme="dark"]'),
  ]);
  assert.deepEqual(light.map((t) => t.name), ["--ink", "--brand"]);
  assert.deepEqual(dark.map((t) => t.value), ["#e6efea", "#fff"]);
});

test("only values a browser can paint become swatches", () => {
  assert.equal(swatchColor("#1d4e77"), "#1d4e77");
  assert.equal(swatchColor("  #fff "), "#fff");
  assert.equal(swatchColor("hsl(164 78% 43%)"), "hsl(164 78% 43%)");
  assert.equal(swatchColor("oklch(0.7 0.1 200)"), "oklch(0.7 0.1 200)");
  // A bare triplet or a var() indirection cannot be rendered on its own.
  assert.equal(swatchColor("0 0% 100%"), null);
  assert.equal(swatchColor("var(--background)"), null);
  assert.equal(swatchColor("8px"), null);
});

test("components list primitives first, then by measured use, then by name", () => {
  const comps: StyleComponent[] = [
    { name: "Card", path: "b", group: "composed", importPath: "b", usedBy: 9 },
    { name: "Button", path: "a", group: "primitive", importPath: "a", usedBy: 2 },
    { name: "Alert", path: "c", group: "primitive", importPath: "c", usedBy: 7 },
  ];
  assert.deepEqual(orderComponents(comps).map((c) => c.name), ["Alert", "Button", "Card"]);

  // With nothing measured, name order holds — never an invented ranking.
  const unmeasured = comps.map((c) => ({ ...c, usedBy: null }));
  assert.deepEqual(orderComponents(unmeasured).map((c) => c.name), ["Alert", "Button", "Card"]);
  // The input is not mutated.
  assert.equal(comps[0].name, "Card");
});

test("evidence and commit labels", () => {
  assert.equal(evidenceLabel({ file: "src/index.css", line: 14 }), "src/index.css:14");
  assert.equal(evidenceLabel({ file: "tailwind.config.ts", line: 0 }), "tailwind.config.ts");
  assert.equal(shortRef("5f9d141abc0000"), "5f9d141");
  assert.equal(shortRef(null), "—");
});
