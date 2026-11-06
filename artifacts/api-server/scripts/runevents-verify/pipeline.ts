// A whole run's timeline, stored and read back the way PR3's endpoint will.
// Needs DATABASE_URL — see README.md.
//
// The orchestrator's own emission is unit-tested without a database
// (src/services/runEventsInstrumentation.test.ts drives the real
// AIOrchestrator with the two provider calls stubbed). What that cannot show is
// a full pipeline's worth of events landing in order, under two agents working
// in parallel, and surviving a cursor read in halves — which is exactly what
// the UI will do. This replays the sequence `executeRun` produces for a
// successful two-agent multi-file run and checks the stored rows.
//
// A real end-to-end run is impossible here: it needs Anthropic, OpenAI and
// GitHub credentials, and the sandbox has none (CLAUDE.md §2).
import { db, projectsTable, tasksTable, runsTable, runEventsTable } from "@workspace/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { createRunEmitter } from "../../src/services/runEvents.js";

const U = "u_pipeline_1";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

/** Text that must never appear in a stored row, in any field. */
const NEEDLES = [
  "claims handler",
  "policy aggregate",
  "Verify the policy exists",
  "db.policy(id)",
  "search block",
  "You are an expert",
];

async function seed() {
  await db.delete(runEventsTable);
  await db.delete(runsTable);
  await db.delete(tasksTable);
  await db.delete(projectsTable);
  const [proj] = await db
    .insert(projectsTable)
    .values({ userId: U, name: "P", plmProvider: "jira", plmProjectKey: "PIPE" })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({ userId: U, projectId: proj.id, externalId: "PAY-214", source: "jira", type: "task", title: "T" })
    .returning();
  const [run] = await db
    .insert(runsTable)
    .values({ userId: U, projectId: proj.id, workItemId: task.id, status: "running", trigger: "manual" })
    .returning();
  return { proj, run };
}

async function main() {
  const { proj, run } = await seed();
  const em = createRunEmitter({ runId: run.id, userId: U, projectId: proj.id });

  // The sequence executeRun emits for a successful run: system orchestration,
  // the two generation agents in parallel, Synthesia's dimensions, a commit.
  em.emit({ agent: "system", type: "run.started", data: { trigger: "manual", autoCommit: true } });
  em.emit({ agent: "system", type: "stage.started", data: { stage: "context" } });
  em.emit({ agent: "system", type: "context.read", data: { kind: "stack_profile" } });
  em.emit({ agent: "system", type: "context.read", data: { kind: "repo_graph", retrievalMode: "graph" } });
  em.emit({ agent: "system", type: "context.read", data: { kind: "parent", included: 2, available: 2, refs: ["PAY-201", "PAY-210"] } });
  em.emit({ agent: "system", type: "context.read", data: { kind: "document", included: 3, available: 7, truncated: true, refs: ["4:11", "4:12", "9:3"] } });
  em.emit({ agent: "system", type: "stage.completed", data: { stage: "context" }, durationMs: 1200 });
  em.emit({ agent: "system", type: "stage.started", data: { stage: "plan" } });
  em.emit({ agent: "system", type: "plan.step", data: { index: 1, total: 2, op: "create", path: "src/policy.ts" } });
  em.emit({ agent: "system", type: "plan.step", data: { index: 2, total: 2, op: "edit", path: "src/claims.ts" } });
  em.emit({ agent: "system", type: "stage.completed", data: { stage: "plan" }, durationMs: 4100 });
  em.emit({ agent: "system", type: "gate.result", data: { gate: "confidence", outcome: "passed" } });
  em.emit({ agent: "system", type: "context.read", data: { kind: "ui_style" } });
  // Both generation agents start before either finishes.
  em.emit({ agent: "raptia", type: "stage.started", data: { stage: "generate", model: "claude-sonnet-4-5" } });
  em.emit({ agent: "fovea", type: "stage.started", data: { stage: "generate", model: "gpt-4o" } });
  em.emit({ agent: "raptia", type: "file.write", data: { path: "src/policy.ts", action: "create", linesAdded: 12, linesRemoved: 0, applyStatus: "applied" } });
  em.emit({ agent: "raptia", type: "file.write", data: { path: "src/claims.ts", action: "modify", linesAdded: 3, linesRemoved: 1, applyStatus: "applied" } });
  em.emit({ agent: "raptia", type: "stage.completed", data: { stage: "generate", model: "claude-sonnet-4-5" }, durationMs: 18400 });
  em.emit({ agent: "fovea", type: "file.write", data: { path: "src/claims.ts", action: "modify", linesAdded: 2, linesRemoved: 1, applyStatus: "applied" } });
  em.emit({ agent: "fovea", type: "stage.completed", data: { stage: "generate", model: "gpt-4o" }, durationMs: 21900 });
  em.emit({ agent: "system", type: "stage.started", data: { stage: "coherence" } });
  em.emit({ agent: "system", type: "check.result", data: { check: "coherence", outcome: "passed", findings: 0 } });
  em.emit({ agent: "system", type: "stage.completed", data: { stage: "coherence" }, durationMs: 90 });
  em.emit({ agent: "synthesia", type: "stage.started", data: { stage: "rank" } });
  for (const [dimension, value, weight] of [["correctness", 85, 30], ["coherence", 100, 15], ["conventions", 80, 15], ["acCoverage", 60, 15], ["readability", 70, 15], ["minimalDiff", 90, 10]] as const) {
    em.emit({ agent: "raptia", type: "score.dimension", data: { dimension, value, weight } });
  }
  em.emit({ agent: "synthesia", type: "stage.completed", data: { stage: "rank" }, durationMs: 7300 });
  em.emit({ agent: "system", type: "stage.started", data: { stage: "commit" } });
  em.emit({ agent: "system", type: "stage.completed", data: { stage: "commit" }, durationMs: 2600 });
  em.emit({
    agent: "system",
    type: "run.completed",
    data: { suggestions: 2, topScore: 8.4, committed: true, prUrl: "https://github.com/acme/app/pull/317", commitHash: "9f2c1ab" },
    durationMs: 56200,
  });
  await em.close();

  const rows = await db
    .select()
    .from(runEventsTable)
    .where(eq(runEventsTable.runId, run.id))
    .orderBy(asc(runEventsTable.seq));

  // 0. Something landed at all. Without this, every check below passes
  //    vacuously on an empty table — which is exactly what happens when
  //    RUN_EVENTS_ENABLED=false, and is how this guard came to be written.
  if (rows.length === 0) {
    console.log("  FAIL  0. the timeline is empty — is RUN_EVENTS_ENABLED=false?");
    console.log("\n0 passed, 1 failed");
    process.exit(1);
  }
  check("0. the timeline is not empty", rows.length >= 30, `${rows.length} rows`);

  // 1. Everything landed, in order, with no gaps.
  const seqs = rows.map((r) => Number(r.seq));
  const expected = Array.from({ length: seqs.length }, (_, i) => i + 1);
  check("1. every event stored, seq contiguous from 1", JSON.stringify(seqs) === JSON.stringify(expected), `${seqs.length} rows`);
  check("1b. insertion order preserved", rows[0].type === "run.started" && rows[rows.length - 1].type === "run.completed",
    `${rows[0].type} … ${rows[rows.length - 1].type}`);

  // 2. Every agent the pipeline uses appears, with a start and an outcome.
  for (const agent of ["system", "raptia", "fovea", "synthesia"]) {
    const mine = rows.filter((r) => r.agent === agent);
    const started = mine.some((r) => r.type.endsWith(".started"));
    const ended = mine.some((r) => r.type === "stage.completed" || r.type === "run.completed" || r.type.endsWith(".failed"));
    check(`2. ${agent} has a start and an outcome`, started && ended, `${mine.length} events`);
  }
  const durations = rows.filter((r) => r.durationMs != null).length;
  check("2b. completion events carry durations", durations >= 8, `${durations} with a duration`);

  // 3. Nothing content-bearing was stored, in any column.
  const serialized = JSON.stringify(rows);
  const leaked = NEEDLES.filter((n) => serialized.includes(n));
  check("3. no stored row carries ticket, document, diff or prompt text", leaked.length === 0, leaked.join(", "));

  // 4. A cursor read in halves sees each event exactly once — the resume path
  //    after a dropped connection.
  const half = Math.floor(seqs.length / 2);
  const firstHalf = await db
    .select({ seq: runEventsTable.seq })
    .from(runEventsTable)
    .where(and(eq(runEventsTable.runId, run.id), gt(runEventsTable.seq, 0)))
    .orderBy(asc(runEventsTable.seq))
    .limit(half);
  const cursor = Number(firstHalf[firstHalf.length - 1].seq);
  const rest = await db
    .select({ seq: runEventsTable.seq })
    .from(runEventsTable)
    .where(and(eq(runEventsTable.runId, run.id), gt(runEventsTable.seq, cursor)))
    .orderBy(asc(runEventsTable.seq));
  const resumed = [...firstHalf, ...rest].map((r) => Number(r.seq));
  check("4. a cursor read in halves sees every event exactly once",
    JSON.stringify(resumed) === JSON.stringify(expected), `${resumed.length} of ${expected.length}`);

  // 5. The summaries are readable prose a person can scan. Spot-check a few.
  const byType = (t: string) => rows.find((r) => r.type === t)?.summary ?? "";
  check("5. run.started reads well", byType("run.started") === "Run started (manual)", byType("run.started"));
  check("5b. plan.step reads well", rows.find((r) => r.type === "plan.step")?.summary === "Plan step 1 of 2 (create): src/policy.ts",
    rows.find((r) => r.type === "plan.step")?.summary);
  check("5c. file.write reads well", rows.find((r) => r.type === "file.write")?.summary === "Created src/policy.ts (+12 -0)",
    rows.find((r) => r.type === "file.write")?.summary);
  check("5d. run.completed reads well",
    byType("run.completed") === "Run succeeded · 2 suggestions · top score 8.4 · committed in 56.2s", byType("run.completed"));
  check("5e. every summary is within the column width", rows.every((r) => r.summary.length <= 160));

  await db.delete(runEventsTable);
  await db.delete(runsTable);
  await db.delete(tasksTable);
  await db.delete(projectsTable);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
