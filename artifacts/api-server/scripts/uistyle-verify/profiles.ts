// UI style profiles at the data layer: one row per project, tenancy, and the
// claim semantics three callers race for.
// Needs DATABASE_URL — see README.md (this script truncates its tables).
import express from "express";
import { db, projectsTable, uiStyleProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CLAIM_STALE_MS,
  claimProfile,
  ensureProfileRow,
  getProfile,
  loadProfileForRun,
  markStale,
  markStaleIfStyling,
  resetProfile,
} from "../../src/services/uiStyleService.js";
import uiStyleRouter from "../../src/routes/uiStyle.js";
import { logger } from "../../src/lib/logger.js";

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
};

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
app.use(uiStyleRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _n: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});
const server = app.listen(0);
const port = () => (server.address() as { port: number }).port;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${port()}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

async function reset() {
  await db.delete(uiStyleProfilesTable);
  await db.delete(projectsTable);
}

const project = async (userId: string, key: string) => {
  const [p] = await db
    .insert(projectsTable)
    .values({ userId, name: key, plmProvider: "jira", plmProjectKey: key })
    .returning();
  return p;
};

async function main() {
  await reset();
  const mine = await project("u1", "MINE");
  const theirs = await project("u2", "THEIRS");

  // 11. One row per project — a second insert hits the unique index.
  await ensureProfileRow("u1", mine.id, null);
  let code: string | undefined;
  try {
    await db.insert(uiStyleProfilesTable).values({ userId: "u1", projectId: mine.id, status: "pending" });
  } catch (err) {
    // Drizzle wraps the driver error, so the SQLSTATE is on err.cause.
    code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
  }
  t("11. a second profile for the same project raises 23505", code === "23505", String(code));

  // ensureProfileRow itself must be safe to call twice — three triggers can.
  let twiceOk = true;
  try {
    await ensureProfileRow("u1", mine.id, null);
  } catch {
    twiceOk = false;
  }
  const rows = await db.select().from(uiStyleProfilesTable).where(eq(uiStyleProfilesTable.projectId, mine.id));
  t("11b. ensureProfileRow is idempotent", twiceOk && rows.length === 1, `${rows.length} rows`);

  // 12. Another user's profile is never returned.
  await ensureProfileRow("u2", theirs.id, null);
  const crossUser = await getProfile("u1", theirs.id);
  t("12. another user's profile is not returned", crossUser === null);

  CURRENT = { userId: "u1", teamId: null, teamRole: null };
  const crossRoute = await call("GET", `/projects/${theirs.id}/ui-style`);
  t("12b. GET on another user's project -> 404", crossRoute.status === 404, String(crossRoute.status));

  // 13. Two concurrent claims: exactly one wins.
  await db
    .update(uiStyleProfilesTable)
    .set({ status: "pending", claimedAt: null })
    .where(eq(uiStyleProfilesTable.projectId, mine.id));
  const [a, b] = await Promise.all([claimProfile(mine.id), claimProfile(mine.id)]);
  t(
    "13. exactly one of two concurrent claims wins",
    [a.claimed, b.claimed].filter(Boolean).length === 1,
    `${a.claimed} / ${b.claimed}`,
  );
  const loser = a.claimed ? b : a;
  t("13b. the loser is told it is busy", !loser.claimed && loser.reason === "busy", JSON.stringify(loser));

  // 14. A row stuck 'extracting' past the stale window is reclaimable.
  await db
    .update(uiStyleProfilesTable)
    .set({ status: "extracting", claimedAt: new Date(Date.now() - CLAIM_STALE_MS - 60_000) })
    .where(eq(uiStyleProfilesTable.projectId, mine.id));
  const reclaim = await claimProfile(mine.id);
  t("14. a stale claim can be taken over", reclaim.claimed === true);

  // ...but a fresh one cannot.
  await db
    .update(uiStyleProfilesTable)
    .set({ status: "extracting", claimedAt: new Date() })
    .where(eq(uiStyleProfilesTable.projectId, mine.id));
  const blocked = await claimProfile(mine.id);
  t("14b. a fresh claim is left alone", blocked.claimed === false);

  // 15. PATCH validation and access.
  await db
    .update(uiStyleProfilesTable)
    .set({ status: "ready", claimedAt: null, uiRoot: "app", uiRootOptions: ["app", "website"], revision: 1 })
    .where(eq(uiStyleProfilesTable.projectId, mine.id));

  const badRoot = await call("PATCH", `/projects/${mine.id}/ui-style`, { uiRoot: "nope" });
  t("15. PATCH with a uiRoot outside the options -> 400", badRoot.status === 400, String(badRoot.status));

  const emptyBody = await call("PATCH", `/projects/${mine.id}/ui-style`, {});
  t("15b. PATCH with an empty body -> 400", emptyBody.status === 400, String(emptyBody.status));

  const offSwitch = await call("PATCH", `/projects/${mine.id}/ui-style`, { enabled: false });
  t(
    "15c. the switch persists",
    offSwitch.status === 200 && offSwitch.body.enabled === false,
    JSON.stringify(offSwitch.body),
  );

  const goodRoot = await call("PATCH", `/projects/${mine.id}/ui-style`, { uiRoot: "website" });
  t(
    "15d. changing the UI location re-queues the extraction",
    goodRoot.status === 200 && goodRoot.body.uiRoot === "website" && goodRoot.body.status === "pending",
    JSON.stringify(goodRoot.body),
  );

  const foreignPatch = await call("PATCH", `/projects/${theirs.id}/ui-style`, { enabled: true });
  t("15e. PATCH on another user's project -> 404", foreignPatch.status === 404, String(foreignPatch.status));

  // A team member who can SEE a team project but not administer it gets 403
  // on write — visible, but not theirs to change.
  const [teamProject] = await db
    .insert(projectsTable)
    .values({
      userId: "u3",
      name: "Team",
      plmProvider: "jira",
      plmProjectKey: "TEAM",
      teamId: 1,
      visibility: "team",
    })
    .returning();
  await ensureProfileRow("u3", teamProject.id, null);
  CURRENT = { userId: "u1", teamId: 1, teamRole: "member" };
  const memberRead = await call("GET", `/projects/${teamProject.id}/ui-style`);
  t(
    "a team member may read the profile and is told they cannot edit",
    memberRead.status === 200 && memberRead.body.canEdit === false,
    JSON.stringify(memberRead.body),
  );
  const memberWrite = await call("PATCH", `/projects/${teamProject.id}/ui-style`, { enabled: false });
  t("15f. a non-admin member -> 403 on write", memberWrite.status === 403, String(memberWrite.status));

  CURRENT = { userId: "u1", teamId: 1, teamRole: "admin" };
  const adminRead = await call("GET", `/projects/${teamProject.id}/ui-style`);
  t("a team admin may edit", adminRead.body?.canEdit === true, JSON.stringify(adminRead.body));

  // markStale only touches a ready profile, and resetProfile re-queues.
  CURRENT = { userId: "u1", teamId: null, teamRole: null };
  await db.update(uiStyleProfilesTable).set({ status: "ready", stale: false }).where(eq(uiStyleProfilesTable.projectId, mine.id));
  markStale(mine.id);
  await new Promise((r) => setTimeout(r, 120));
  const afterStale = await getProfile("u1", mine.id);
  t("a committed styling change marks the profile stale", afterStale?.stale === true, JSON.stringify(afterStale?.stale));

  await resetProfile(mine.id, null);
  const afterReset = await getProfile("u1", mine.id);
  t(
    "a repository rebind re-queues it and clears stale",
    afterReset?.status === "pending" && afterReset?.stale === false,
    JSON.stringify({ s: afterReset?.status, stale: afterReset?.stale }),
  );

  // --- PR-B: what a run reads, and what a commit does to it ---------------

  // 16. A run triggered by a team ADMIN must still find the profile, which
  // carries the project OWNER's user id. This is the 0040 tenancy bug in a new
  // place: scoping by runs.userId would silently return nothing.
  await db
    .update(uiStyleProfilesTable)
    .set({ status: "ready", stale: false, revision: 4 })
    .where(eq(uiStyleProfilesTable.projectId, teamProject.id));
  const asAdmin = await loadProfileForRun(teamProject.id, "u1");
  t(
    "16. a run started by someone other than the owner still loads the profile",
    asAdmin?.revision === 4 && asAdmin.userId === "u3",
    JSON.stringify({ rev: asAdmin?.revision, owner: asAdmin?.userId }),
  );

  // 17. A project that does not exist is a null, never a throw: a run must not
  // fail because its style guide could not be read.
  let threw = false;
  let missing: unknown = "unset";
  try {
    missing = await loadProfileForRun(999_999, "u1");
  } catch {
    threw = true;
  }
  t("17. an unreadable profile returns null rather than throwing", !threw && missing === null, String(missing));

  // 18/19. Stale marking end to end, through the predicate and the update.
  await db
    .update(uiStyleProfilesTable)
    .set({ status: "ready", stale: false })
    .where(eq(uiStyleProfilesTable.projectId, mine.id));
  markStaleIfStyling(mine.id, ["src/services/claims.ts", "src/routes/index.ts"]);
  await new Promise((r) => setTimeout(r, 120));
  const afterBackend = await getProfile("u1", mine.id);
  t("18. a backend-only commit leaves the profile alone", afterBackend?.stale === false, String(afterBackend?.stale));

  markStaleIfStyling(mine.id, ["src/services/claims.ts", "tailwind.config.ts"]);
  await new Promise((r) => setTimeout(r, 120));
  const afterStyling = await getProfile("u1", mine.id);
  t("19. a commit touching tailwind.config.ts marks it out of date", afterStyling?.stale === true, String(afterStyling?.stale));

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
}

main();
