import express from "express";
import { db, tasksTable, projectsTable, teamsTable, repositoriesTable, runsTable,
  workItemLinksTable, sequenceChecksTable, sequenceOverridesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import runsRouter from "../../src/routes/runs.js";
import sequenceRouter from "../../src/routes/sequence.js";
import { holdIfOrderChanged } from "../../src/services/sequenceGate.js";
import { logger } from "../../src/lib/logger.js";

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}  ${d}`); } };
let CURRENT = { userId: "u1", teamId: null as number | null, teamRole: "admin" as string | null };
const app = express(); app.use(express.json());
app.use((req, _r, n) => { Object.assign(req, CURRENT, { log: logger }); n(); });
app.use(runsRouter); app.use(sequenceRouter);
const server = app.listen(0);
const call = async (m: string, p: string, b?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}${p}`,
    { method: m, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  const x = await r.text(); return { status: r.status, body: x ? JSON.parse(x) : null };
};

async function main() {
  await db.delete(sequenceOverridesTable); await db.delete(sequenceChecksTable);
  await db.delete(workItemLinksTable); await db.delete(runsTable); await db.delete(tasksTable);
  await db.delete(repositoriesTable); await db.delete(projectsTable); await db.delete(teamsTable);
  const [team] = await db.insert(teamsTable).values({ name: "T", ownerUserId: "u1" }).returning();
  const [proj] = await db.insert(projectsTable).values({ userId: "u1", name: "P", plmProvider: "jira", plmProjectKey: "PAY", teamId: team.id }).returning();
  await db.insert(repositoriesTable).values({ userId: "u1", name: "r", provider: "github", url: "https://github.com/o/r", defaultBranch: "main", projectId: proj.id, stackProfile: {} });
  const [A] = await db.insert(tasksTable).values({ userId: "u1", projectId: proj.id, externalId: "PAY-A", source: "jira", type: "task", title: "A" }).returning();
  const [B] = await db.insert(tasksTable).values({ userId: "u1", projectId: proj.id, externalId: "PAY-B", source: "jira", type: "task", title: "B" }).returning();
  await db.insert(workItemLinksTable).values({ userId: "u1", teamId: team.id, projectId: proj.id, fromItemId: A.id, toItemId: B.id, linkType: "blocks", source: "tracker" });
  CURRENT = { userId: "u1", teamId: team.id, teamRole: "admin" };

  // Schedule B with a valid override acknowledging A.
  const chk = await call("POST", `/work-items/${B.id}/sequence-check`);
  await call("POST", `/work-items/${B.id}/sequence-check/${chk.body.checkId}/impact`);
  const res = await call("POST", `/work-items/${B.id}/runs`, {
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    sequence: { checkId: chk.body.checkId, decision: "override", reasonCategory: "urgent_business_need",
      reasonText: "needed for the pilot demo tomorrow", acknowledgedImpact: true,
      acknowledgedFindingIds: chk.body.findings.map((f: {id:string}) => f.id) },
  });
  t("precondition: scheduled with an override", res.status === 202, String(res.status));
  const runId = res.body.id;

  // Nothing changed -> not held.
  t("22a. unchanged order -> the run is not held", (await holdIfOrderChanged(runId)) === false);

  // A new blocker the scheduling user never saw.
  const [C] = await db.insert(tasksTable).values({ userId: "u1", projectId: proj.id, externalId: "PAY-C", source: "jira", type: "task", title: "C" }).returning();
  await db.insert(workItemLinksTable).values({ userId: "u1", teamId: team.id, projectId: proj.id, fromItemId: C.id, toItemId: B.id, linkType: "blocks", source: "tracker" });

  t("22. a new blocker before dispatch -> held", (await holdIfOrderChanged(runId)) === true);
  const [held] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  t("22b. the run status is 'held', not started", held.status === "held", held.status);
  t("22c. nothing was generated", held.commitHash === null && held.committedSuggestionId === null);

  // 21 — immutability on a real decision row.
  const [ov] = await db.select().from(sequenceOverridesTable);
  const originalHash = ov.recordHash;
  let raised = false;
  try { await db.execute(sql`UPDATE sequence_overrides SET reason_text = 'rewritten' WHERE id = ${ov.id}`); }
  // Drizzle wraps the driver error, so the pg message is on err.cause, not on
  // the error itself — the same trap that makes 23505 detection check cause.
  catch (e) {
    const chain = [e, (e as { cause?: unknown }).cause].map((x) => (x as Error)?.message ?? "").join(" | ");
    raised = /immutable/.test(chain);
  }
  t("21. UPDATE on a real decision row raises", raised);

  await db.delete(runsTable).where(eq(runsTable.id, runId));
  const [after] = await db.select().from(sequenceOverridesTable);
  t("21b. deleting the run leaves the decision standing", !!after);
  t("21c. run_id is nulled", after.runId === null);
  t("21d. the hash is untouched", after.recordHash === originalHash);
  t("21e. the frozen impact and reason survive", after.reasonText === "needed for the pilot demo tomorrow");

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
