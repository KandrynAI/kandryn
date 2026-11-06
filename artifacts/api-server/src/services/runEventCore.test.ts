import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_ALLOWLIST,
  prepareEvent,
  runbookSectionCode,
  sanitizeData,
  timelineAgent,
} from "./runEventCore.js";
import {
  RUN_EVENT_ARRAY_MAX,
  RUN_EVENT_SUMMARY_MAX,
  RUN_EVENT_TYPES,
  RUNBOOK_SECTIONS,
  type RunEventType,
} from "../../../../shared/types/runEvent.js";

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

test("sanitizeData keeps allowlisted keys and drops everything else", () => {
  const out = sanitizeData("file.write", {
    path: "src/routes/runs.ts",
    action: "modify",
    linesAdded: 12,
    linesRemoved: 3,
    // Not on the allowlist for this type:
    content: "export function foo() { /* the whole file */ }",
    diff: "@@ -1 +1 @@",
    prompt: "You are an expert engineer…",
  });
  assert.deepEqual(out, { path: "src/routes/runs.ts", action: "modify", linesAdded: 12, linesRemoved: 3 });
});

test("sanitizeData drops a value whose kind does not match, rather than coercing it", () => {
  const out = sanitizeData("run.completed", {
    suggestions: "two", // not a number
    committed: "yes", // not a boolean
    prUrl: "http://example.com/pr/1", // not https
    commitHash: "a b c", // not a token
    topScore: 8.4,
  });
  assert.deepEqual(out, { topScore: 8.4 });
});

test("sanitizeData refuses prose in a code field — the stage.failed.reason leak vector", () => {
  const out = sanitizeData("stage.failed", {
    stage: "generate",
    // What `err.message` looks like, and exactly what must not get through.
    reason: "Edit failed: the search block 'const policy = await getPolicy(id)' was not found in src/claims.ts",
  });
  assert.deepEqual(out, { stage: "generate" }, "reason must be dropped, not truncated");

  const ok = sanitizeData("stage.failed", { stage: "generate", reason: "model_error" });
  assert.equal(ok.reason, "model_error");
});

test("sanitizeData refuses prose in gate.result.reason", () => {
  const out = sanitizeData("gate.result", {
    gate: "security",
    outcome: "blocked",
    reason: "SQL injection in the refund endpoint: user input reaches the query unparameterised",
  });
  assert.deepEqual(out, { gate: "security", outcome: "blocked" });
});

test("sanitizeData clips a long path from the left, keeping the informative tail", () => {
  const long = `src/${"deeply/".repeat(60)}claims.ts`;
  const out = sanitizeData("plan.step", { index: 1, total: 2, op: "edit", path: long });
  const path = out.path as string;
  assert.ok(path.length <= 200, `clipped to ${path.length}`);
  assert.ok(path.endsWith("claims.ts"), "the tail survives");
  assert.ok(path.startsWith("…"), "the clip is visible");
});

test("sanitizeData caps refs by count and keeps the identifier forms 0040/0041 produce", () => {
  const out = sanitizeData("context.read", {
    kind: "document",
    refs: Array.from({ length: 50 }, (_, i) => `src${i}:chunk${i}`),
  });
  const refs = out.refs as string[];
  assert.equal(refs.length, RUN_EVENT_ARRAY_MAX);
  assert.deepEqual(sanitizeData("context.read", { kind: "parent", refs: ["PAY-214", "#42"] }).refs, [
    "PAY-214",
    "#42",
  ]);
});

test("sanitizeData DROPS a ref that is not identifier-shaped, rather than truncating it", () => {
  // This was a real hole: the first version truncated each ref to 64 chars, and
  // 64 characters of a document passage is still 64 characters of a document
  // passage. The structural leak test below is what caught it.
  const out = sanitizeData("context.read", {
    kind: "document",
    refs: ["PAY-1", "As a claims handler I need to verify the policy exists before returning results"],
  });
  assert.deepEqual(out.refs, ["PAY-1"]);
});

test("sanitizeData sheds keys rather than exceeding the byte ceiling", () => {
  const out = sanitizeData("context.read", {
    kind: "document",
    included: 4,
    refs: Array.from({ length: RUN_EVENT_ARRAY_MAX }, () => "r".repeat(64)),
  });
  assert.ok(Buffer.byteLength(JSON.stringify(out), "utf8") <= 2048);
  assert.equal(out.kind, "document", "the first keys survive");
});

test("every event type has an allowlist", () => {
  for (const type of RUN_EVENT_TYPES) {
    assert.ok(DATA_ALLOWLIST[type], `${type} has no allowlist`);
  }
});

// ---------------------------------------------------------------------------
// The structural leakage guard
// ---------------------------------------------------------------------------

test("no event type can carry prose, whatever key it arrives under", () => {
  const PROSE =
    "As a claims handler I need to verify the policy exists before returning results, because " +
    "Synthesia flagged that the agent interprets policy-existence validation as checking whether claims are returned.";
  // Every key name any emit site might plausibly reach for, plus the real
  // allowlisted key names carrying prose instead of their declared kind.
  const stuffed: Record<string, unknown> = {
    title: PROSE,
    description: PROSE,
    acceptanceCriteria: PROSE,
    detail: PROSE,
    rationale: PROSE,
    narrative: PROSE,
    verdict: PROSE,
    explanation: PROSE,
    message: PROSE,
    error: PROSE,
    prompt: PROSE,
    content: PROSE,
    diff: PROSE,
    text: PROSE,
    heading: PROSE,
    summary: PROSE,
    reason: PROSE,
    outcome: PROSE,
    category: PROSE,
    dimension: PROSE,
    stage: PROSE,
    kind: PROSE,
    check: PROSE,
    action: PROSE,
    op: PROSE,
    gate: PROSE,
    section: PROSE,
    trigger: PROSE,
    triggerContext: PROSE,
    model: PROSE,
    retrievalMode: PROSE,
    applyStatus: PROSE,
    path: PROSE,
    refs: [PROSE],
  };
  const needle = "claims handler";

  for (const type of RUN_EVENT_TYPES) {
    const prepared = prepareEvent({ agent: "system", type, data: stuffed });
    assert.ok(prepared, `${type} should prepare`);
    assert.ok(
      !prepared.summary.includes(needle),
      `${type} summary leaked prose: ${prepared.summary}`,
    );
    const serialized = JSON.stringify(prepared.data);
    assert.ok(!serialized.includes(needle), `${type} data leaked prose: ${serialized}`);
  }
});

test("a path containing whitespace is dropped — path is interpolated into the summary", () => {
  // The second real hole the guard above found. `path` reaches the summary, so
  // accepting free text here put a work item title one emit site away from the
  // feed. No whitespace is the guard; a repository with a space in a filename
  // loses the name from its summary and keeps the event.
  const out = sanitizeData("file.write", { path: "the policy existence check", action: "modify" });
  assert.deepEqual(out, { action: "modify" });

  const prepared = prepareEvent({ agent: "raptia", type: "file.write", data: { path: "a b.ts", action: "create" } });
  assert.equal(prepared?.summary, "Created a file");
});

test("a long but space-free path is clipped, not dropped", () => {
  const long = `src/${"nested/".repeat(50)}claims.ts`;
  const out = sanitizeData("file.write", { path: long, action: "modify" });
  assert.ok((out.path as string).length <= 200);
  assert.ok((out.path as string).endsWith("claims.ts"));
});

// ---------------------------------------------------------------------------
// Summary templating
// ---------------------------------------------------------------------------

test("summaries are templated from the coerced data", () => {
  const cases: Array<[RunEventType, Record<string, unknown>, number | null, string]> = [
    ["run.started", { trigger: "manual" }, null, "Run started (manual)"],
    ["run.started", { trigger: "manual", triggerContext: "remediation" }, null, "Run started (remediation)"],
    ["run.completed", { suggestions: 2, topScore: 8, committed: true }, 41200, "Run succeeded · 2 suggestions · top score 8 · committed in 41.2s"],
    ["run.completed", { suggestions: 1 }, null, "Run succeeded · 1 suggestion"],
    ["run.failed", { reason: "no_agent_output", stage: "generate" }, null, "Run failed at generation: no agent produced a suggestion"],
    ["stage.started", { stage: "plan" }, null, "Planning started"],
    ["stage.completed", { stage: "generate" }, 12400, "Generation completed in 12.4s"],
    ["stage.completed", { stage: "coherence" }, 840, "Coherence check completed in 840ms"],
    ["stage.failed", { stage: "generate", reason: "model_error" }, null, "Generation failed (model_error)"],
    ["context.read", { kind: "parent", included: 2, available: 3 }, null, "Read 2 parent items of 3"],
    ["context.read", { kind: "document", included: 1 }, null, "Read 1 document passage"],
    ["context.read", { kind: "stack_profile" }, null, "Read the stack profile"],
    ["plan.step", { index: 3, total: 7, op: "edit", path: "src/routes/runs.ts" }, null, "Plan step 3 of 7 (edit): src/routes/runs.ts"],
    ["file.write", { path: "src/a.ts", action: "create", linesAdded: 42, linesRemoved: 0 }, null, "Created src/a.ts (+42 -0)"],
    ["file.write", { path: "src/a.ts", action: "modify" }, null, "Modified src/a.ts"],
    ["check.result", { check: "aegis", path: "src/a.ts", high: 1, medium: 2 }, null, "Aegis src/a.ts: 1 high, 2 medium"],
    ["check.result", { check: "coherence", outcome: "passed" }, null, "Coherence: passed"],
    ["check.result", { check: "veria", findings: 3 }, null, "Veria: 3 findings"],
    ["score.dimension", { dimension: "correctness", value: 85 }, null, "correctness 85"],
    ["runbook.section", { section: "deployment" }, null, "Runbook section: Deployment steps"],
    ["gate.result", { gate: "security", outcome: "blocked", blocking: 2 }, null, "Security gate blocked (2 blocking findings)"],
    ["gate.result", { gate: "confidence", outcome: "passed" }, null, "Confidence gate passed"],
  ];
  for (const [type, data, durationMs, expected] of cases) {
    const prepared = prepareEvent({ agent: "system", type, data, durationMs });
    assert.ok(prepared, `${type} should prepare`);
    assert.equal(prepared.summary, expected, `${type}`);
  }
});

test("a summary is capped at the column width", () => {
  const prepared = prepareEvent({
    agent: "system",
    type: "plan.step",
    data: { index: 1, total: 1, op: "edit", path: `src/${"segment/".repeat(40)}file.ts` },
  });
  assert.ok(prepared);
  assert.ok(prepared.summary.length <= RUN_EVENT_SUMMARY_MAX, `was ${prepared.summary.length}`);
});

// ---------------------------------------------------------------------------
// prepareEvent validation
// ---------------------------------------------------------------------------

test("prepareEvent rejects an unknown type, agent or status", () => {
  assert.equal(prepareEvent({ agent: "system", type: "run.exploded" as RunEventType }), null);
  assert.equal(prepareEvent({ agent: "claude" as never, type: "run.started" }), null);
  assert.equal(prepareEvent({ agent: "system", type: "run.started", status: "panicking" as never }), null);
});

test("prepareEvent defaults the status from the type", () => {
  assert.equal(prepareEvent({ agent: "system", type: "stage.started", data: { stage: "plan" } })?.status, "started");
  assert.equal(prepareEvent({ agent: "system", type: "stage.failed", data: { stage: "plan" } })?.status, "failed");
  assert.equal(prepareEvent({ agent: "system", type: "stage.completed", data: { stage: "plan" } })?.status, "ok");
  assert.equal(prepareEvent({ agent: "system", type: "plan.step", data: {} })?.status, "info");
  assert.equal(
    prepareEvent({ agent: "aegis", type: "check.result", status: "warn", data: { check: "aegis" } })?.status,
    "warn",
    "an explicit status wins",
  );
});

test("prepareEvent normalises durationMs and refuses a nonsense one", () => {
  assert.equal(prepareEvent({ agent: "system", type: "run.completed", durationMs: 1234.7 })?.durationMs, 1235);
  assert.equal(prepareEvent({ agent: "system", type: "run.completed", durationMs: -5 })?.durationMs, null);
  assert.equal(prepareEvent({ agent: "system", type: "run.completed", durationMs: NaN })?.durationMs, null);
  assert.equal(prepareEvent({ agent: "system", type: "run.completed" })?.durationMs, null);
});

test("prepareEvent tolerates data that is not an object", () => {
  for (const data of [undefined, null, "a string", 42, ["an", "array"]]) {
    const prepared = prepareEvent({ agent: "system", type: "run.started", data });
    assert.ok(prepared, `data=${JSON.stringify(data)}`);
    assert.deepEqual(prepared.data, {});
  }
});

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

test("runbookSectionCode matches Narratia's eight headings and nothing else", () => {
  const pairs: Array<[string, string]> = [
    ["Summary", "summary"],
    ["What changed", "what_changed"],
    ["Deployment steps", "deployment"],
    ["Rollback procedure", "rollback"],
    ["Validation", "validation"],
    ["Test cases", "test_cases"],
    ["Security notes", "security_notes"],
    ["References", "references"],
  ];
  for (const [heading, code] of pairs) assert.equal(runbookSectionCode(heading), code, heading);
  // Case and punctuation are incidental; an unknown heading is `other`, never
  // passed through.
  assert.equal(runbookSectionCode("  DEPLOYMENT  STEPS "), "deployment");
  assert.equal(runbookSectionCode("How I would roll this out, carefully"), "other");
  assert.equal(runbookSectionCode(undefined), "other");
  assert.equal(runbookSectionCode(42), "other");
});

test("every runbook section code has a label in the template", () => {
  for (const code of RUNBOOK_SECTIONS) {
    const prepared = prepareEvent({ agent: "narratia", type: "runbook.section", data: { section: code } });
    assert.ok(prepared);
    assert.ok(prepared.summary.startsWith("Runbook section: "), code);
    assert.ok(prepared.summary.length > "Runbook section: ".length, `${code} has no label`);
  }
});

test("timelineAgent maps the suggestion agents and never guesses", () => {
  assert.equal(timelineAgent("claude"), "raptia");
  assert.equal(timelineAgent("antigravity"), "raptia");
  assert.equal(timelineAgent("openai"), "fovea");
  assert.equal(timelineAgent("copilot"), "fovea");
  assert.equal(timelineAgent("aegis"), "aegis");
  assert.equal(timelineAgent("something-new"), "system");
});
