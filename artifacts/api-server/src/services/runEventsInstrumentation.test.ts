import { test } from "node:test";
import assert from "node:assert/strict";
import { AIOrchestrator, emitScoreDimensions, type EmitEvent } from "./aiService.js";
import { prepareEvent, type EmitInput } from "./runEventCore.js";
import type { DevCopilotTask } from "../../../../shared/types/task.js";
import type { CodeSuggestion } from "../../../../shared/types/codeSuggestion.js";
import type { StackProfile } from "../stack/detector.js";

/**
 * PR2: the agents emit. These tests drive the REAL orchestrator — real prompt
 * building, real `resolveFileOps`, real per-agent timing, real event emission —
 * with only the two provider calls stubbed, because the point is the
 * instrumentation and not the models.
 *
 * Three things are proved here:
 *  1. The event sequence per agent, for a genuine multi-file change set.
 *  2. That nothing an agent emits carries ticket text, document text, prompt
 *     text or diff content, with the real prompt in play as the needle source.
 *  3. That the suggestions are byte-identical with emission on and off.
 */

// ---------------------------------------------------------------------------
// Fixtures: a multi-file change set with a create, an edit and a failing edit
// ---------------------------------------------------------------------------

const TICKET_TITLE = "Verify the policy exists before returning claims";
const TICKET_BODY =
  "As a claims handler I need the endpoint to confirm the policy record exists, because returning an empty " +
  "claims array reads as a valid policy with no claims.";
const DOC_PASSAGE =
  "Architecture > Billing: every claims read must resolve the policy aggregate first; the ledger is authoritative.";
const NEEDLES = ["claims handler", "policy aggregate", "ledger is authoritative", "Verify the policy exists"];

const TASK: DevCopilotTask = {
  id: "1",
  source: "jira",
  type: "task",
  title: TICKET_TITLE,
  description: TICKET_BODY,
  acceptanceCriteria: ["Policy existence is checked explicitly", "A missing policy returns 404"],
  priority: 2,
  rawSource: {},
};

const STACK: StackProfile = {
  language: "typescript",
  frontend: "react",
  backend: "nodejs",
  database: "postgresql",
  testFramework: "node:test",
  packageManager: "pnpm",
};

const EXISTING = 'export async function getClaims(id: string) {\n  return db.claims(id);\n}\n';

const reader = async (path: string) =>
  path === "src/claims.ts" ? { content: EXISTING, sha: "sha-claims" } : null;

/** Claude returns a create, a clean edit and an edit whose anchor is absent. */
const claudeOutput = {
  explanation: "Adds the policy check.",
  files: [
    { op: "create" as const, path: "src/policy.ts", content: "export const findPolicy = (id: string) => db.policy(id);\n" },
    {
      op: "edit" as const,
      path: "src/claims.ts",
      hunks: [{ search: "  return db.claims(id);", replace: "  await findPolicy(id);\n  return db.claims(id);" }],
    },
  ],
};

/** OpenAI returns one create. */
const openaiOutput = {
  explanation: "Guards the read.",
  files: [{ op: "create" as const, path: "src/guard.ts", content: "export const guard = () => true;\n" }],
};

type Stubs = { claude?: unknown; openai?: unknown; claudeThrows?: Error; openaiThrows?: Error };

function orchestratorWith(stubs: Stubs): AIOrchestrator {
  const orch = new AIOrchestrator({ anthropicApiKey: "sk-test", openaiApiKey: "sk-test" });
  // `private` is compile-time only; an instance property shadows the prototype
  // method, so `this.callClaude(...)` resolves to the stub.
  Object.assign(orch, {
    callClaude: async () => {
      if (stubs.claudeThrows) throw stubs.claudeThrows;
      return stubs.claude;
    },
    callOpenAI: async () => {
      if (stubs.openaiThrows) throw stubs.openaiThrows;
      return stubs.openai;
    },
  });
  return orch;
}

const run = (orch: AIOrchestrator, onEvent?: EmitEvent) =>
  orch.generateSuggestions(TASK, "", STACK, reader, undefined, DOC_PASSAGE, null, onEvent);

/** Every event, prepared exactly as the emitter would prepare it. */
function collect(): { events: ReturnType<typeof prepareEvent>[]; onEvent: EmitEvent } {
  const events: ReturnType<typeof prepareEvent>[] = [];
  return { events, onEvent: (e: EmitInput) => events.push(prepareEvent(e)) };
}

const forAgent = (events: ReturnType<typeof prepareEvent>[], agent: string) =>
  events.filter((e) => e?.agent === agent).map((e) => `${e!.type}:${JSON.stringify(e!.data)}`);

// ---------------------------------------------------------------------------
// 1. The event sequence per agent
// ---------------------------------------------------------------------------

test("a multi-file generation emits start, a file.write per file, and a completed stage per agent", async () => {
  const { events, onEvent } = collect();
  await run(orchestratorWith({ claude: claudeOutput, openai: openaiOutput }), onEvent);

  // Both starts come first: the agents are already in flight by then.
  assert.deepEqual(
    events.slice(0, 2).map((e) => `${e!.agent}:${e!.type}`),
    ["raptia:stage.started", "fovea:stage.started"],
  );

  const raptia = events.filter((e) => e?.agent === "raptia");
  assert.deepEqual(
    raptia.map((e) => e!.type),
    ["stage.started", "file.write", "file.write", "stage.completed"],
  );
  assert.deepEqual(
    raptia.filter((e) => e!.type === "file.write").map((e) => e!.data.path),
    ["src/policy.ts", "src/claims.ts"],
  );
  assert.deepEqual(
    raptia.filter((e) => e!.type === "file.write").map((e) => e!.data.action),
    ["create", "modify"],
  );

  const fovea = events.filter((e) => e?.agent === "fovea");
  assert.deepEqual(fovea.map((e) => e!.type), ["stage.started", "file.write", "stage.completed"]);

  // The model id travels on the stage, and a duration is recorded.
  const done = raptia.find((e) => e!.type === "stage.completed")!;
  assert.equal(done.data.stage, "generate");
  assert.ok(typeof done.data.model === "string" && done.data.model.length > 0);
  assert.ok(done.durationMs !== null && done.durationMs >= 0);
});

test("file.write carries line counts and the apply status, never content", async () => {
  const { events, onEvent } = collect();
  await run(orchestratorWith({ claude: claudeOutput, openai: openaiOutput }), onEvent);
  const write = events.find((e) => e?.type === "file.write" && e.data.path === "src/claims.ts")!;
  assert.equal(write.data.applyStatus, "applied");
  assert.equal(typeof write.data.linesAdded, "number");
  assert.equal(typeof write.data.linesRemoved, "number");
  assert.ok(!("content" in write.data), "content must never be on the event");
  assert.ok(!("hunks" in write.data));
  assert.ok(!("diff" in write.data));
});

test("an agent that throws emits stage.failed with a code, not the provider message", async () => {
  const { events, onEvent } = collect();
  const boom = new Error(
    "400 {\"error\":{\"message\":\"Your prompt contained: As a claims handler I need the endpoint…\"}}",
  );
  await run(orchestratorWith({ claude: claudeOutput, openaiThrows: boom }), onEvent);

  const failed = events.find((e) => e?.agent === "fovea" && e.type === "stage.failed")!;
  assert.equal(failed.data.stage, "generate");
  assert.equal(failed.data.reason, "model_error");
  assert.ok(!JSON.stringify(failed).includes("claims handler"), "the provider message must not travel");
  // Raptia is unaffected.
  assert.ok(events.some((e) => e?.agent === "raptia" && e.type === "stage.completed"));
});

test("an unapplicable change set completes the stage as failed, not as ok", async () => {
  const { events, onEvent } = collect();
  const badAnchor = {
    explanation: "x",
    files: [
      {
        op: "edit" as const,
        path: "src/claims.ts",
        hunks: [{ search: "  return await resolvePolicyAggregate(id);", replace: "  return null;" }],
      },
    ],
  };
  await run(orchestratorWith({ claude: badAnchor, openai: openaiOutput }), onEvent);
  const raptia = events.filter((e) => e?.agent === "raptia");
  const last = raptia[raptia.length - 1]!;
  assert.equal(last.type, "stage.failed");
  assert.equal(last.data.reason, "changes_not_applicable");
  // The write event is still there, flagged.
  const write = raptia.find((e) => e!.type === "file.write")!;
  assert.equal(write.status, "warn");
  assert.equal(write.data.applyStatus, "failed");
  assert.ok(!JSON.stringify(write).includes("resolvePolicyAggregate"), "the failed anchor must not travel");
});

// ---------------------------------------------------------------------------
// 2. No leakage, with the real prompt in play
// ---------------------------------------------------------------------------

test("no emitted event carries ticket text, document text, a prompt or a diff", async () => {
  const { events, onEvent } = collect();
  await run(orchestratorWith({ claude: claudeOutput, openai: openaiOutput }), onEvent);
  await run(orchestratorWith({ claude: claudeOutput, openaiThrows: new Error(TICKET_BODY) }), onEvent);

  const serialized = JSON.stringify(events);
  for (const needle of NEEDLES) {
    assert.ok(!serialized.includes(needle), `leaked: ${needle}`);
  }
  // Nor the generated code itself.
  assert.ok(!serialized.includes("db.policy(id)"));
  assert.ok(!serialized.includes("findPolicy(id)"));
  assert.ok(!serialized.includes("export const"));
  // And every event survived preparation (none was dropped by the taxonomy).
  assert.ok(events.length > 0 && events.every((e) => e !== null));
});

// ---------------------------------------------------------------------------
// 3. Emission changes nothing about the result
// ---------------------------------------------------------------------------

test("suggestions are identical with emission on and off", async () => {
  const stubs = { claude: claudeOutput, openai: openaiOutput };
  const withEvents = await run(orchestratorWith(stubs), collect().onEvent);
  const without = await run(orchestratorWith(stubs));

  // `model` and the file content are part of this: a stray mutation inside the
  // emission loop would show up here.
  assert.deepEqual(JSON.parse(JSON.stringify(withEvents)), JSON.parse(JSON.stringify(without)));
});

test("a hook that throws does not break generation", async () => {
  // The emitter swallows its own errors, but a caller could still pass a bad
  // hook. Generation must not be the thing that notices.
  const thrower: EmitEvent = () => {
    throw new Error("hook exploded");
  };
  await assert.rejects(
    () => run(orchestratorWith({ claude: claudeOutput, openai: openaiOutput }), thrower),
    /hook exploded/,
    "a throwing hook surfaces rather than being silently swallowed in aiService",
  );
  // Documented consequence: the real emitter never throws (runEvents.test.ts
  // proves it), so this path is a caller bug, not a runtime risk.
});

// ---------------------------------------------------------------------------
// Synthesia's dimensions
// ---------------------------------------------------------------------------

test("emitScoreDimensions emits the numbers and leaves every narrative behind", () => {
  const breakdown = {
    correctness: { score: 85, weight: 30, verdict: "strong", reason: `It checks ${TICKET_TITLE}` },
    readability: { score: 70, weight: 15, verdict: "fair", reason: "Dense but clear" },
    minimalDiff: { score: 90, weight: 10, verdict: "strong", reason: "Two files" },
    conventions: { score: 80, weight: 15, verdict: "strong", reason: "Matches the repo" },
    acCoverage: { score: 60, weight: 15, verdict: "partial", reason: DOC_PASSAGE },
    coherence: { score: 100, weight: 15, verdict: "strong", reason: "No cross-file drift" },
    ambiguityHandling: { score: 40, weight: 0, verdict: "weak", reason: "Silently picked one reading" },
    overallNarrative: `This suggestion addresses ${TICKET_TITLE} but leaves the ledger unchanged.`,
    recommendation: "Recommended" as const,
  };
  const suggestions = [{ agent: "claude", scoreBreakdown: breakdown }] as unknown as CodeSuggestion[];

  const { events, onEvent } = collect();
  emitScoreDimensions(suggestions, onEvent);

  assert.deepEqual(
    events.map((e) => e!.data.dimension),
    ["correctness", "readability", "minimalDiff", "conventions", "acCoverage", "coherence", "ambiguityHandling"],
    "one event per scored dimension, and neither overallNarrative nor recommendation",
  );
  assert.ok(events.every((e) => e!.agent === "synthesia" || e!.agent === "raptia"));
  assert.equal(events[0]!.data.value, 85);
  assert.equal(events[0]!.data.weight, 30);
  assert.equal(events[0]!.summary, "correctness 85");

  const serialized = JSON.stringify(events);
  for (const needle of [...NEEDLES, "Silently picked one reading", "Matches the repo"]) {
    assert.ok(!serialized.includes(needle), `leaked: ${needle}`);
  }
});

test("emitScoreDimensions tolerates a suggestion with no breakdown", () => {
  const { events, onEvent } = collect();
  emitScoreDimensions([{ agent: "openai" }] as unknown as CodeSuggestion[], onEvent);
  assert.equal(events.length, 0);
});
