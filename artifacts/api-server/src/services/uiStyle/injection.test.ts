import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AIOrchestrator } from "../aiService.js";
import { buildPrompt, buildPlanPrompt } from "../../stack/prompts.js";
import { mergeUiStyleManifest } from "./styleGuide.js";
import type { ContextManifest } from "../contextPack.js";
import type { StackProfile } from "../../stack/detector.js";

/**
 * Where the UI style guide may and may not appear (0042, PR-B).
 *
 * The block is reuse guidance for a generator. In a planning prompt it is 700
 * tokens that cannot change the answer, and in Veria, Aegis or Narratia it is
 * worse than useless — a reviewer told what the house style is will grade
 * against it. So the scope is pinned here rather than left to a convention.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const STYLE_BLOCK = '<ui_style_guide note="Reuse what is here.">\nUse these tokens: --brand #1d4e77\n</ui_style_guide>';

const STACK: StackProfile = {
  language: "TypeScript",
  frontend: "react",
  backend: "node",
  database: "postgres",
  testFramework: "vitest",
  packageManager: "pnpm",
};

// --- 3. The planning prompt never carries it -------------------------------

test("3. the planner has no way to receive the style guide", () => {
  const planning = read("services/planningService.ts");
  assert.doesNotMatch(planning, /styleGuide/, "planningService must not know the field exists");
  assert.doesNotMatch(planning, /ui_style_guide/);
});

test("3b. the post-commit agents never carry it either", () => {
  for (const file of ["services/veriaService.ts", "services/aegisService.ts", "services/narratiaService.ts"]) {
    const src = read(file);
    assert.doesNotMatch(src, /styleGuide/, `${file} must not inject the style guide`);
    assert.doesNotMatch(src, /ui_style_guide/, file);
  }
});

test("3c. only taskSection renders it, so both generation prompts agree by construction", () => {
  const prompts = read("stack/prompts.ts");
  assert.equal(prompts.match(/task\.styleGuide/g)?.length, 2, "read once in taskSection (guard + value)");
  const task = { title: "Add a card", styleGuide: STYLE_BLOCK };
  const single = buildPrompt(task, "// code", STACK);
  const planned = buildPlanPrompt(
    task,
    { files: [{ op: "edit", path: "src/a.tsx", rationale: "r" }] },
    "// context",
    STACK,
  );
  assert.match(single, /<ui_style_guide/);
  assert.match(planned, /<ui_style_guide/);
});

test("3d. without a style guide the prompt is exactly what it was before", () => {
  const withNone = buildPrompt({ title: "Add a card" }, "// code", STACK);
  const withNull = buildPrompt({ title: "Add a card", styleGuide: null }, "// code", STACK);
  const withBlank = buildPrompt({ title: "Add a card", styleGuide: "   " }, "// code", STACK);
  assert.equal(withNull, withNone);
  assert.equal(withBlank, withNone);
  assert.doesNotMatch(withNone, /ui_style_guide/);
});

// --- 4. Both agents get identical text -------------------------------------

test("4. Claude and OpenAI receive byte-identical prompts, block included", async () => {
  const orch = new AIOrchestrator({ anthropicApiKey: "k", openaiApiKey: "k" });
  const seen: Record<string, string> = {};
  const reply = async () => ({ explanation: "x", files: [{ op: "create" as const, path: "a.tsx", content: "x" }] });
  // The provider calls are the only part that needs a network; everything
  // between the style guide and the wire is the thing under test.
  (orch as unknown as Record<string, unknown>).callClaude = async (p: string) => ((seen.claude = p), reply());
  (orch as unknown as Record<string, unknown>).callOpenAI = async (p: string) => ((seen.openai = p), reply());

  await orch.generateSuggestions(
    { id: 1, title: "Add a card", description: "d", acceptanceCriteria: ["ac"], status: "open" } as never,
    "// code",
    STACK,
    undefined,
    undefined,
    null,
    STYLE_BLOCK,
  );

  assert.match(seen.claude, /<ui_style_guide/);
  assert.equal(seen.claude, seen.openai, "the two agents must compete on the same brief");
});

// --- 5. A missing profile is not a failure ---------------------------------

test("5. generation proceeds normally when no style guide could be loaded", async () => {
  const orch = new AIOrchestrator({ anthropicApiKey: "k", openaiApiKey: "k" });
  let prompt = "";
  const reply = async () => ({ explanation: "x", files: [{ op: "create" as const, path: "a.tsx", content: "x" }] });
  (orch as unknown as Record<string, unknown>).callClaude = async (p: string) => ((prompt = p), reply());
  (orch as unknown as Record<string, unknown>).callOpenAI = async () => reply();

  const { suggestions, failures } = await orch.generateSuggestions(
    { id: 1, title: "Add a card", description: "d", acceptanceCriteria: ["ac"], status: "open" } as never,
    "// code",
    STACK,
    undefined,
    undefined,
    null,
    null,
  );
  assert.equal(failures.length, 0);
  assert.ok(suggestions.length > 0, "a run without a profile still generates");
  assert.doesNotMatch(prompt, /ui_style_guide/);
});

test("5b. the resolver is wrapped so a profile read can never reach the run", () => {
  const run = read("services/runService.ts");
  const body = run.slice(run.indexOf("async function resolveStyleGuide"), run.indexOf("* Run both agents"));
  assert.match(body, /catch \(err\)/, "resolveStyleGuide must swallow its own failures");
  assert.match(body, /return null;/);
});

// --- 7. The manifest merge --------------------------------------------------

const PART_ONE: ContextManifest = {
  version: 1,
  compiledAt: "2026-10-19T00:00:00.000Z",
  budgetTokens: 1800,
  usedTokens: 420,
  truncated: true,
  sections: [
    { kind: "parent_chain", included: 2, available: 3, truncated: true, refs: ["PAY-1", "PAY-2"] },
    { kind: "reference_material", included: 1, available: 4, truncated: true, refs: ["7:12"] },
  ],
};
const ENTRY = { profileId: 9, revision: 3, injected: true as const, approxTokens: 512 };

test("7. merging the style entry leaves every part 1 field intact", () => {
  const merged = mergeUiStyleManifest(PART_ONE, ENTRY);
  assert.deepEqual(merged.sections, PART_ONE.sections);
  assert.equal(merged.compiledAt, PART_ONE.compiledAt);
  assert.equal(merged.budgetTokens, 1800);
  assert.equal(merged.usedTokens, 420);
  assert.equal(merged.truncated, true);
  assert.deepEqual(merged.uiStyle, ENTRY);
  assert.equal(merged.version, 2, "the shape gained a field, so the version moves");
});

test("7b. a run with no part 1 context still records what it carried", () => {
  const merged = mergeUiStyleManifest(null, ENTRY, "2026-10-19T01:00:00.000Z");
  assert.deepEqual(merged.sections, []);
  assert.equal(merged.compiledAt, "2026-10-19T01:00:00.000Z");
  assert.deepEqual(merged.uiStyle, ENTRY);
});

test("7c. the merge never mutates the manifest it was given", () => {
  const base = structuredClone(PART_ONE);
  mergeUiStyleManifest(base, ENTRY);
  assert.deepEqual(base, PART_ONE);
});
