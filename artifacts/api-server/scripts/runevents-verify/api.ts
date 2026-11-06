// GET /runs/:id/events and POST /runs/:id/execute over HTTP, auth stubbed.
// Needs DATABASE_URL — see README.md.
//
// Covers the three things the endpoint must get right: authorization (owner,
// team member, and a refusal for anyone else), the cursor (ordering, exclusive
// since_seq, the page cap and hasMore), and the execute claim (one execution
// per queued run, however many times it is called).
import express from "express";
import {
  db, projectsTable, tasksTable, teamsTable, repositoriesTable, runsTable, runEventsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import runsRouter from "../../src/routes/runs.js";
import { createRunEmitter } from "../../src/services/runEvents.js";
import { logger } from "../../src/lib/logger.js";

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}  ${d}`); } };

let CURRENT = { userId: "owner", teamId: null as number | null, teamRole: null as string | null };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as never as Record<string, unknown>).userId = CURRENT.userId;
  (req as never as Record<string, unknown>).teamId = CURRENT.teamId;
  (req as never as Record<string, unknown>).teamRole = CURRENT.teamRole;
  (req as never as Record<string, unknown>).log = logger;
  next();
});
app.use(runsRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _n: express.NextFunction) => {
  logger.error({ err }, "test app error");
  res.status(500).json({ error: err.message });
});

const server = app.listen(0);
const port = () => (server.address() as { port: number }).port;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${port()}${path}`, {
    method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

async function seed(opts: { visibility?: string } = {}) {
  await db.delete(runEventsTable);
  await db.delete(runsTable);
  await db.delete(tasksTable);
  await db.delete(repositoriesTable);
  await db.delete(projectsTable);
  await db.delete(teamsTable);
  const [team] = await db.insert(teamsTable).values({ name: "T", ownerUserId: "owner" }).returning();
  const [proj] = await db
    .insert(projectsTable)
    .values({
      userId: "owner", name: "P", plmProvider: "jira", plmProjectKey: "EV",
      teamId: team.id, visibility: (opts.visibility ?? "team") as never,
    })
    .returning();
  await db.insert(repositoriesTable).values({
    userId: "owner", name: "r", provider: "github", url: "https://github.com/o/r",
    defaultBranch: "main", projectId: proj.id, stackProfile: {},
  });
  const [task] = await db
    .insert(tasksTable)
    .values({ userId: "owner", projectId: proj.id, externalId: "EV-1", source: "jira", type: "task", title: "T" })
    .returning();
  const [run] = await db
    .insert(runsTable)
    .values({ userId: "owner", projectId: proj.id, workItemId: task.id, status: "running", trigger: "manual" })
    .returning();
  CURRENT = { userId: "owner", teamId: team.id, teamRole: "admin" };
  return { team, proj, task, run };
}

/** n timeline events on a run, seq 1..n. */
async function emit(runId: number, projectId: number, n: number) {
  const em = createRunEmitter({ runId, userId: "owner", projectId });
  for (let i = 0; i < n; i++) {
    em.emit({ agent: "raptia", type: "file.write", data: { path: `src/f${i}.ts`, action: "modify" } });
  }
  await em.close();
}

async function main() {
  // --- 1. The cursor -------------------------------------------------------
  {
    const { run, proj } = await seed();
    await emit(run.id, proj.id, 5);

    const all = await call("GET", `/runs/${run.id}/events`);
    t("1. a full read returns every event in seq order", all.status === 200
      && JSON.stringify(all.body.events.map((e: { seq: number }) => e.seq)) === "[1,2,3,4,5]",
      JSON.stringify(all.body?.events?.map((e: { seq: number }) => e.seq)));
    t("1b. nextSeq is the last seq on the page", all.body.nextSeq === 5, String(all.body?.nextSeq));
    t("1c. hasMore is false on a complete page", all.body.hasMore === false);
    t("1d. the run's state travels with the page", all.body.runStatus === "running", String(all.body?.runStatus));
    t("1e. the DTO carries no column the contract does not name",
      Object.keys(all.body.events[0]).sort().join(",") === "agent,createdAt,data,durationMs,id,seq,status,summary,type",
      Object.keys(all.body.events[0]).sort().join(","));

    const since = await call("GET", `/runs/${run.id}/events?since_seq=3`);
    t("2. since_seq is exclusive", JSON.stringify(since.body.events.map((e: { seq: number }) => e.seq)) === "[4,5]",
      JSON.stringify(since.body?.events?.map((e: { seq: number }) => e.seq)));

    const caughtUp = await call("GET", `/runs/${run.id}/events?since_seq=5`);
    t("2b. a poll with nothing new returns an empty page and does not move the cursor",
      caughtUp.body.events.length === 0 && caughtUp.body.nextSeq === 5, JSON.stringify(caughtUp.body));

    const paged = await call("GET", `/runs/${run.id}/events?limit=2`);
    t("3. limit caps the page and sets hasMore",
      paged.body.events.length === 2 && paged.body.hasMore === true && paged.body.nextSeq === 2,
      JSON.stringify({ n: paged.body?.events?.length, more: paged.body?.hasMore, next: paged.body?.nextSeq }));

    // Resume from the paged cursor and the whole run arrives exactly once.
    const rest = await call("GET", `/runs/${run.id}/events?since_seq=${paged.body.nextSeq}`);
    const seen = [...paged.body.events, ...rest.body.events].map((e: { seq: number }) => e.seq);
    t("3b. paging through sees every event exactly once",
      JSON.stringify(seen) === "[1,2,3,4,5]", JSON.stringify(seen));

    const tooBig = await call("GET", `/runs/${run.id}/events?limit=5000`);
    t("3c. an oversized limit is refused, not honoured", tooBig.status === 400, String(tooBig.status));
    const negative = await call("GET", `/runs/${run.id}/events?since_seq=-1`);
    t("3d. a negative cursor is refused", negative.status === 400, String(negative.status));
  }

  // --- 4. Authorization ----------------------------------------------------
  {
    const { run, team } = await seed({ visibility: "team" });
    t("4. the owner can read", (await call("GET", `/runs/${run.id}/events`)).status === 200);

    CURRENT = { userId: "teammate", teamId: team.id, teamRole: "member" };
    t("4b. a member of the run's team project can read",
      (await call("GET", `/runs/${run.id}/events`)).status === 200);

    CURRENT = { userId: "stranger", teamId: 999999, teamRole: "member" };
    const denied = await call("GET", `/runs/${run.id}/events`);
    t("4c. another tenant is refused 403, and gets no events", denied.status === 403 && denied.body.events === undefined,
      `${denied.status} ${JSON.stringify(denied.body)}`);

    CURRENT = { userId: "stranger", teamId: null, teamRole: null };
    t("4d. a user with no team is refused too", (await call("GET", `/runs/${run.id}/events`)).status === 403);

    CURRENT = { userId: "owner", teamId: team.id, teamRole: "admin" };
    t("4e. a run that does not exist is 404, not 403",
      (await call("GET", "/runs/99999999/events")).status === 404);
  }

  // --- 5. The execute claim ------------------------------------------------
  {
    const { run } = await seed();
    // The run from seed() is `running`, so executing it is a no-op 202 rather
    // than a second execution.
    const already = await call("POST", `/runs/${run.id}/execute`);
    t("5. executing a run that is not queued is 202, not a second run",
      already.status === 202 && already.body.status === "running", `${already.status} ${JSON.stringify(already.body)}`);

    await db.update(runsTable).set({ status: "queued", startedAt: null }).where(eq(runsTable.id, run.id));
    // Two calls at once: exactly one may claim. Both resolve; the loser is 202.
    const [a, b] = await Promise.all([
      call("POST", `/runs/${run.id}/execute`),
      call("POST", `/runs/${run.id}/execute`),
    ]);
    const statuses = [a.status, b.status].sort();
    t("5b. two concurrent executes produce one execution and one 202",
      statuses[0] === 200 && statuses[1] === 202, JSON.stringify(statuses));
    // The run has no credentials here, so executeRun records a failure on the
    // row rather than throwing — which is the contract, and what matters is
    // that it ran once.
    const [after] = await db.select().from(runsTable).where(eq(runsTable.id, run.id));
    t("5c. the claimed run reached a terminal state", after.status === "failed" || after.status === "succeeded",
      after.status);

    CURRENT = { userId: "teammate", teamId: CURRENT.teamId, teamRole: "member" };
    await db.update(runsTable).set({ status: "queued" }).where(eq(runsTable.id, run.id));
    const byMember = await call("POST", `/runs/${run.id}/execute`);
    t("5d. execute is owner-only — a team member who can READ it cannot start it",
      byMember.status === 404, String(byMember.status));
  }

  await db.delete(runEventsTable);
  await db.delete(runsTable);
  await db.delete(tasksTable);
  await db.delete(repositoriesTable);
  await db.delete(projectsTable);
  await db.delete(teamsTable);
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
