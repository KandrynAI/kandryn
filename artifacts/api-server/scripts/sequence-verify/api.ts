// The run endpoint and the sequence routes over HTTP, auth stubbed:
// spec tests 13-19 and 23. Needs DATABASE_URL — see README.md.
import express from "express";
import { db, tasksTable, projectsTable, teamsTable, repositoriesTable, runsTable,
  workItemLinksTable, sequenceChecksTable, sequenceOverridesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import runsRouter from "../../src/routes/runs.js";
import sequenceRouter from "../../src/routes/sequence.js";
import { logger } from "../../src/lib/logger.js";

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}  ${d}`); } };

let CURRENT = { userId: "u1", teamId: null as number | null, teamRole: null as string | null };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as never as Record<string, unknown>).userId = CURRENT.userId;
  (req as never as Record<string, unknown>).teamId = CURRENT.teamId;
  (req as never as Record<string, unknown>).teamRole = CURRENT.teamRole;
  (req as never as Record<string, unknown>).log = logger;
  next();
});
app.use(runsRouter); app.use(sequenceRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _n: express.NextFunction) => {
  logger.error({ err }, "test app error"); res.status(500).json({ error: err.message });
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

async function seed(policy: string | null = null) {
  await db.delete(sequenceOverridesTable); await db.delete(sequenceChecksTable);
  await db.delete(workItemLinksTable); await db.delete(runsTable);
  await db.delete(tasksTable); await db.delete(repositoriesTable);
  await db.delete(projectsTable); await db.delete(teamsTable);
  const [team] = await db.insert(teamsTable).values({ name: "T", ownerUserId: "u1", sequencePolicy: policy as never }).returning();
  const [proj] = await db.insert(projectsTable).values({ userId: "u1", name: "P", plmProvider: "jira", plmProjectKey: "PAY", teamId: team.id }).returning();
  await db.insert(repositoriesTable).values({ userId: "u1", name: "r", provider: "github", url: "https://github.com/o/r", defaultBranch: "main", projectId: proj.id, stackProfile: {} });
  const [A] = await db.insert(tasksTable).values({ userId: "u1", projectId: proj.id, externalId: "PAY-A", source: "jira", type: "task", title: "A" }).returning();
  const [B] = await db.insert(tasksTable).values({ userId: "u1", projectId: proj.id, externalId: "PAY-B", source: "jira", type: "task", title: "B" }).returning();
  await db.insert(workItemLinksTable).values({ userId: "u1", teamId: team.id, projectId: proj.id, fromItemId: A.id, toItemId: B.id, linkType: "blocks", source: "tracker" });
  CURRENT = { userId: "u1", teamId: team.id, teamRole: "admin" };
  return { team, proj, A, B };
}
const soon = () => new Date(Date.now() + 3600_000).toISOString();
const runCount = async () => (await db.select().from(runsTable)).length;
const ovCount = async () => (await db.select().from(sequenceOverridesTable)).length;

/** A valid override block for the current state of item B. */
async function blockFor(B: { id: number }, over: Record<string, unknown> = {}) {
  const chk = await call("POST", `/work-items/${B.id}/sequence-check`);
  await call("POST", `/work-items/${B.id}/sequence-check/${chk.body.checkId}/impact`);
  return {
    checkId: chk.body.checkId, decision: "override", reasonCategory: "urgent_business_need",
    reasonText: "needed for the pilot demo tomorrow", acknowledgedImpact: true,
    acknowledgedFindingIds: chk.body.findings.map((f: { id: string }) => f.id), ...over,
  };
}

async function main() {
  // 13
  let { B } = await seed();
  let r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon() });
  t("13. warning item, no sequence block -> 409 SEQUENCE_CHECK_REQUIRED",
    r.status === 409 && r.body.code === "SEQUENCE_CHECK_REQUIRED", `${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
  t("13b. no run was created", (await runCount()) === 0);
  t("13c. a fresh check rides along for the dialog", typeof r.body.check?.checkId === "number" && r.body.check.findings.length > 0);

  // 14 (scheduled path: exercises the same transaction without running the pipeline)
  ({ B } = await seed());
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon(), sequence: await blockFor(B) });
  t("14. valid override -> 202 and the run is created", r.status === 202 && (await runCount()) === 1, `${r.status} ${JSON.stringify(r.body).slice(0,150)}`);
  const [ov] = await db.select().from(sequenceOverridesTable);
  t("14b. exactly one override row", (await ovCount()) === 1);
  t("14c. it points at the run", ov?.runId === r.body.id);
  t("14d. it has a record hash", /^[0-9a-f]{64}$/.test(ov?.recordHash ?? ""));
  t("14e. it froze the impact the user saw", !!ov?.impactShown && typeof (ov.impactShown as {summary?:string}).summary === "string");
  t("14f. it records the role and the policy in force",
    ov?.userRole === "admin" && (ov?.policySnapshot as {policy?:string})?.policy === "warn");
  t("14g. scheduledAt is stored on the decision", ov?.scheduledAt !== null);

  // 15
  let seeded = await seed(); B = seeded.B;
  const staleBlock = await blockFor(B);
  await db.update(tasksTable).set({ status: "done" }).where(eq(tasksTable.id, seeded.A.id)); // blocker completes
  await db.insert(tasksTable).values({ userId: "u1", projectId: seeded.proj.id, externalId: "PAY-D", source: "jira", type: "task", title: "D" });
  const [D] = await db.select().from(tasksTable).where(eq(tasksTable.externalId, "PAY-D"));
  await db.insert(workItemLinksTable).values({ userId: "u1", teamId: seeded.team.id, projectId: seeded.proj.id, fromItemId: D.id, toItemId: B.id, linkType: "blocks", source: "tracker" });
  const before = await runCount();
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon(), sequence: staleBlock });
  t("15. the world moved -> 409 SEQUENCE_STALE", r.status === 409 && r.body.code === "SEQUENCE_STALE", `${r.status} ${r.body.code}`);
  t("15b. a fresh check is attached", r.body.check?.findings?.length > 0);
  t("15c. no run created", (await runCount()) === before);

  // 16
  ({ B } = await seed());
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon(), sequence: await blockFor(B, { reasonText: "too short" }) });
  t("16. short reason on a warning -> 400", r.status === 400 && r.body.code === "REASON_REQUIRED", `${r.status} ${r.body.code}`);
  t("16b. no run created", (await runCount()) === 0);

  // 17
  ({ B } = await seed());
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon(), sequence: await blockFor(B, { acknowledgedImpact: false }) });
  t("17. impact not acknowledged -> 400", r.status === 400 && r.body.code === "IMPACT_NOT_ACKNOWLEDGED", `${r.status} ${r.body.code}`);

  // 18
  seeded = await seed("admin_override_only"); B = seeded.B;
  const memberBlock = await blockFor(B);
  CURRENT = { userId: "u1", teamId: seeded.team.id, teamRole: "member" };
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon(), sequence: memberBlock });
  t("18. member under admin_override_only -> 403", r.status === 403 && r.body.code === "OVERRIDE_NOT_PERMITTED", `${r.status} ${r.body.code}`);
  CURRENT = { userId: "u1", teamId: seeded.team.id, teamRole: "admin" };
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon(), sequence: await blockFor(B) });
  t("18b. admin -> accepted", r.status === 202, `${r.status} ${JSON.stringify(r.body).slice(0,120)}`);

  // 19
  seeded = await seed(); B = seeded.B;
  const mine = await blockFor(B);
  CURRENT = { userId: "someone-else", teamId: null, teamRole: null };
  r = await call("POST", `/work-items/${B.id}/sequence-check/${mine.checkId}/impact`);
  t("19. another account's checkId -> 404", r.status === 404, String(r.status));
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon() });
  t("19b. another account's work item -> 404", r.status === 404, String(r.status));
  CURRENT = { userId: "u1", teamId: seeded.team.id, teamRole: "admin" };

  // 23
  seeded = await seed(); B = seeded.B;
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon(), triggerContext: "remediation", parentRunId: undefined });
  t("23. an Aegis remediation run is exempt from the order check", r.status === 202, `${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
  t("23b. and records no override", (await ovCount()) === 0);

  // clear path writes nothing extra
  seeded = await seed(); B = seeded.B;
  await db.update(tasksTable).set({ status: "done" }).where(eq(tasksTable.id, seeded.A.id));
  const checksBefore = (await db.select().from(sequenceChecksTable)).length;
  r = await call("POST", `/work-items/${B.id}/runs`, { scheduledAt: soon() });
  t("clear verdict -> accepted with no sequence block", r.status === 202, String(r.status));
  t("clear verdict -> no snapshot row written", (await db.select().from(sequenceChecksTable)).length === checksBefore);
  t("clear verdict -> no override row", (await ovCount()) === 0);

  // heeded / canceled events
  seeded = await seed(); B = seeded.B;
  const chk = await call("POST", `/work-items/${B.id}/sequence-check`);
  t("event: heeded -> 204", (await call("POST", `/work-items/${B.id}/sequence-check/${chk.body.checkId}/event`, { event: "heeded" })).status === 204);
  t("event: canceled -> 204", (await call("POST", `/work-items/${B.id}/sequence-check/${chk.body.checkId}/event`, { event: "canceled" })).status === 204);
  t("event: rubbish -> 400", (await call("POST", `/work-items/${B.id}/sequence-check/${chk.body.checkId}/event`, { event: "nope" })).status === 400);

  // policy + run order + admin reads
  t("GET policy", (await call("GET", "/team/sequence-policy")).body.policy === "warn");
  t("PUT policy (admin)", (await call("PUT", "/team/sequence-policy", { policy: "off" })).status === 200);
  t("PUT policy rejects rubbish", (await call("PUT", "/team/sequence-policy", { policy: "maybe" })).status === 400);
  await call("PUT", "/team/sequence-policy", { policy: "warn" });
  const order = await call("GET", `/projects/${seeded.proj.id}/run-order`);
  t("GET run-order gives waves", order.body.items.find((i: {itemKey:string}) => i.itemKey === "PAY-A")?.wave === 1);
  CURRENT = { userId: "u1", teamId: seeded.team.id, teamRole: "member" };
  t("admin reads are admin-only", (await call("GET", "/sequence-overrides")).status === 403);
  CURRENT = { userId: "u1", teamId: seeded.team.id, teamRole: "admin" };
  t("admin can list overrides", (await call("GET", "/sequence-overrides")).status === 200);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
