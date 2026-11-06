// The run timeline's data-layer behaviour: the seq claim, the lock that makes
// the cursor safe, the unique index, the CHECK constraints and the cascades.
// Needs DATABASE_URL — see README.md.
//
// Everything decidable without a database (the allowlist, the templates, the
// buffering, failure isolation, the block arithmetic) lives in
// src/services/runEventCore.test.ts and runEvents.test.ts. What is here cannot
// be faked: whether Postgres actually serializes two emitters on one run, and
// therefore whether a `since_seq` cursor can lose an event.
import { db, projectsTable, tasksTable, runsTable, runEventsTable } from "@workspace/db";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { createRunEmitter, dbWriter } from "../../src/services/runEvents.js";

const U = "u_timeline_1";
const OTHER = "u_timeline_2";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

async function seed(userId = U) {
  const [proj] = await db
    .insert(projectsTable)
    .values({ userId, name: "P", plmProvider: "jira", plmProjectKey: `K${Date.now() % 100000}` })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({ userId, projectId: proj.id, externalId: "PAY-1", source: "jira", type: "task", title: "T" })
    .returning();
  const [run] = await db
    .insert(runsTable)
    .values({ userId, projectId: proj.id, workItemId: task.id, status: "queued", trigger: "manual" })
    .returning();
  return { proj, task, run };
}

async function reset() {
  await db.delete(runEventsTable);
  await db.delete(runsTable);
  await db.delete(tasksTable);
  await db.delete(projectsTable);
}

const rowsFor = (runId: number) =>
  db.select().from(runEventsTable).where(eq(runEventsTable.runId, runId)).orderBy(asc(runEventsTable.seq));

const fileEvent = (i: number) =>
  ({ agent: "raptia", type: "file.write", data: { path: `src/f${i}.ts`, action: "modify" } }) as const;

async function main() {
  await reset();

  // 1. The claim assigns a contiguous block starting at 1, and runs.event_seq
  //    tracks the high-water mark.
  {
    const { run } = await seed();
    const em = createRunEmitter({ runId: run.id, userId: U, projectId: run.projectId });
    for (let i = 0; i < 5; i++) em.emit(fileEvent(i));
    await em.close();
    const rows = await rowsFor(run.id);
    const [after] = await db.select({ eventSeq: runsTable.eventSeq }).from(runsTable).where(eq(runsTable.id, run.id));
    check("1. seq is contiguous from 1", JSON.stringify(rows.map((r) => Number(r.seq))) === "[1,2,3,4,5]",
      JSON.stringify(rows.map((r) => Number(r.seq))));
    check("1b. runs.event_seq is the high-water mark", Number(after.eventSeq) === 5, String(after.eventSeq));
    check("1c. scope columns are written", rows.every((r) => r.userId === U && r.projectId === run.projectId));
    check("1d. summary is templated, data is allowlisted",
      rows[0].summary === "Modified src/f0.ts" && JSON.stringify(rows[0].data) === '{"path":"src/f0.ts","action":"modify"}',
      `${rows[0].summary} ${JSON.stringify(rows[0].data)}`);
  }

  // 2. THE HEADLINE CHECK. Two emitters write concurrently while a poller
  //    advances a since_seq cursor between their commits. If the claim were a
  //    global sequence (or run_events.id), the poller would skip whatever a
  //    slower writer committed after a faster one — measured in
  //    docs/investigations/live-run-timeline.md §8.1. With the claim inside the
  //    insert's transaction, the row lock makes seq order equal commit order,
  //    so the cursor must see every event exactly once.
  {
    await reset();
    const { run } = await seed();
    const scope = { runId: run.id, userId: U, projectId: run.projectId };
    const a = createRunEmitter(scope);
    const b = createRunEmitter(scope);

    let cursor = 0;
    const seen: number[] = [];
    let polling = true;
    const poller = (async () => {
      while (polling) {
        const batch = await db
          .select({ seq: runEventsTable.seq })
          .from(runEventsTable)
          .where(and(eq(runEventsTable.runId, run.id), gt(runEventsTable.seq, cursor)))
          .orderBy(asc(runEventsTable.seq));
        for (const row of batch) {
          seen.push(Number(row.seq));
          cursor = Number(row.seq);
        }
        await new Promise((r) => setTimeout(r, 3));
      }
    })();

    const EACH = 40;
    const writers = [0, 1].map(async (w) => {
      const em = w === 0 ? a : b;
      for (let i = 0; i < EACH; i++) {
        em.emit(fileEvent(i));
        await em.flush(); // one batch per event: the worst case for interleaving
      }
      await em.close();
    });
    await Promise.all(writers);
    // Let the poller drain, then stop it.
    await new Promise((r) => setTimeout(r, 120));
    polling = false;
    await poller;

    const stored = (await rowsFor(run.id)).map((r) => Number(r.seq));
    const expected = Array.from({ length: EACH * 2 }, (_, i) => i + 1);
    check("2. every event was stored, contiguous", JSON.stringify(stored) === JSON.stringify(expected),
      `stored ${stored.length}`);
    check("2b. a since_seq cursor lost nothing", JSON.stringify(seen) === JSON.stringify(expected),
      `cursor saw ${seen.length} of ${expected.length}: missing ${expected.filter((s) => !seen.includes(s)).join(",") || "none"}`);
    check("2c. the cursor never saw a duplicate", new Set(seen).size === seen.length,
      `${seen.length - new Set(seen).size} duplicates`);
  }

  // 3. The unique index makes a double-claim loud rather than reordering the
  //    timeline silently. 23505 arrives on err.cause with Drizzle's wrapping.
  {
    await reset();
    const { run } = await seed();
    await dbWriter.write({ runId: run.id, userId: U, projectId: run.projectId }, [
      { agent: "system", type: "run.started", status: "started", summary: "Run started (manual)", data: {}, durationMs: null },
    ]);
    let code: unknown = null;
    try {
      await db.insert(runEventsTable).values({
        runId: run.id, userId: U, projectId: run.projectId, seq: 1,
        agent: "system", type: "run.started", status: "started", summary: "duplicate", data: {},
      });
    } catch (err) {
      const e = err as { code?: unknown; cause?: { code?: unknown } };
      code = e.code ?? e.cause?.code;
    }
    check("3. a duplicate (run_id, seq) raises 23505", code === "23505", `got ${String(code)}`);
  }

  // 4. The CHECK constraints are a real backstop, not just a TypeScript union.
  //    If these fail, the database was brought up by `drizzle-kit push` alone
  //    and did not get them — apply docs/db/0044_run_events.sql by hand.
  {
    await reset();
    const { run } = await seed();
    const bad = async (col: string, values: Record<string, string>) => {
      try {
        await db.insert(runEventsTable).values({
          runId: run.id, userId: U, projectId: run.projectId, seq: 99,
          agent: "system", type: "run.started", status: "ok", summary: "x", data: {},
          ...values,
        });
        return false;
      } catch {
        return true;
      }
    };
    check("4. agent is constrained in the database", await bad("agent", { agent: "gpt" }));
    check("4b. type is constrained in the database", await bad("type", { type: "run.detonated" }));
    check("4c. status is constrained in the database", await bad("status", { status: "panicking" }));
  }

  // 5. Retention is the run's lifetime: no purge job, just the cascade.
  {
    await reset();
    const { run, proj } = await seed();
    const em = createRunEmitter({ runId: run.id, userId: U, projectId: proj.id });
    em.emit({ agent: "system", type: "run.started", data: { trigger: "manual" } });
    await em.close();
    check("5. events exist before the delete", (await rowsFor(run.id)).length === 1);
    await db.delete(runsTable).where(eq(runsTable.id, run.id));
    check("5b. deleting the run deletes its timeline", (await rowsFor(run.id)).length === 0);

    const { run: run2, proj: proj2 } = await seed();
    const em2 = createRunEmitter({ runId: run2.id, userId: U, projectId: proj2.id });
    em2.emit({ agent: "system", type: "run.started", data: { trigger: "manual" } });
    await em2.close();
    await db.delete(projectsTable).where(eq(projectsTable.id, proj2.id));
    check("5c. deleting the project deletes its events", (await rowsFor(run2.id)).length === 0);
  }

  // 6. The scope columns isolate at the data layer. The endpoint's own rule
  //    (owner, or a team member of a team project, else 403) is PR3's to test;
  //    this only proves a user_id-scoped read cannot see the other tenant.
  {
    await reset();
    const mine = await seed(U);
    const theirs = await seed(OTHER);
    for (const [userId, s] of [[U, mine], [OTHER, theirs]] as const) {
      const em = createRunEmitter({ runId: s.run.id, userId, projectId: s.proj.id });
      em.emit({ agent: "system", type: "run.started", data: { trigger: "manual" } });
      await em.close();
    }
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(runEventsTable)
      .where(eq(runEventsTable.userId, U));
    check("6. a user-scoped read sees only its own events", n === 1, `saw ${n}`);
    const [{ m }] = await db
      .select({ m: sql<number>`count(*)::int` })
      .from(runEventsTable)
      .where(and(eq(runEventsTable.userId, U), eq(runEventsTable.runId, theirs.run.id)));
    check("6b. the other tenant's run yields nothing under our user_id", m === 0, `saw ${m}`);
  }

  await reset();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
