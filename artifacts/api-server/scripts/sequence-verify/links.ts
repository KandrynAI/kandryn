// Reconciliation of tracker links into work_item_links.
// Needs DATABASE_URL — see README.md.
import { db, projectsTable, tasksTable, teamsTable, workItemLinksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { reconcileTrackerLinks } from "../../src/services/syncService.js";

const U = "u1";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

async function seed() {
  await db.delete(workItemLinksTable);
  await db.delete(tasksTable);
  await db.delete(projectsTable);
  await db.delete(teamsTable);
  const [team] = await db.insert(teamsTable).values({ name: "T", ownerUserId: U }).returning();
  const [proj] = await db.insert(projectsTable)
    .values({ userId: U, name: "P", plmProvider: "jira", plmProjectKey: "PAY", teamId: team.id }).returning();
  const rows = await db.insert(tasksTable).values(
    ["PAY-A", "PAY-B", "PAY-C"].map((k) => ({
      userId: U, projectId: proj.id, externalId: k, source: "jira", type: "task", title: k,
    })),
  ).returning();
  const byExternal = new Map(rows.map((r) => [r.externalId as string, r]));
  return { team, proj, byExternal };
}

const edges = async (projectId: number) =>
  (await db.select().from(workItemLinksTable).where(eq(workItemLinksTable.projectId, projectId)))
    .map((r) => `${r.fromItemId}->${r.toItemId}:${r.source}`).sort();

async function main() {
  // 1. insert
  let { team, proj, byExternal } = await seed();
  const A = byExternal.get("PAY-A")!, B = byExternal.get("PAY-B")!, C = byExternal.get("PAY-C")!;
  await reconcileTrackerLinks({
    userId: U, projectId: proj.id, teamId: team.id, byExternal,
    links: [{ fromKey: "PAY-A", toKey: "PAY-B", linkType: "blocks" }],
  });
  check("inserts a new tracker edge", (await edges(proj.id)).join() === `${A.id}->${B.id}:tracker`);

  const [row] = await db.select().from(workItemLinksTable);
  check("stamps user_id and team_id", row.userId === U && row.teamId === team.id);

  // 2. idempotent
  await reconcileTrackerLinks({ userId: U, projectId: proj.id, teamId: team.id, byExternal,
    links: [{ fromKey: "PAY-A", toKey: "PAY-B", linkType: "blocks" }] });
  check("re-running changes nothing", (await edges(proj.id)).length === 1);

  // 3. stale tracker edge removed when the tracker drops it
  await reconcileTrackerLinks({ userId: U, projectId: proj.id, teamId: team.id, byExternal,
    links: [{ fromKey: "PAY-B", toKey: "PAY-C", linkType: "blocks" }] });
  check("drops an edge the tracker no longer reports", (await edges(proj.id)).join() === `${B.id}->${C.id}:tracker`);

  // 4. manual and inferred links survive a reconcile that reports nothing
  await db.insert(workItemLinksTable).values([
    { userId: U, teamId: team.id, projectId: proj.id, fromItemId: A.id, toItemId: C.id, linkType: "blocks", source: "manual" },
    { userId: U, teamId: team.id, projectId: proj.id, fromItemId: C.id, toItemId: A.id, linkType: "blocks", source: "inferred" },
  ]);
  await reconcileTrackerLinks({ userId: U, projectId: proj.id, teamId: team.id, byExternal, links: [] });
  const after = await edges(proj.id);
  check("never deletes manual or inferred links", after.length === 2 && after.every((e) => !e.endsWith(":tracker")), JSON.stringify(after));

  // 5. edge pointing outside the project is dropped, not crashed on
  await reconcileTrackerLinks({ userId: U, projectId: proj.id, teamId: team.id, byExternal,
    links: [{ fromKey: "PAY-A", toKey: "OTHER-9", linkType: "blocks" }] });
  check("drops an edge whose endpoint is not in this project",
    (await edges(proj.id)).filter((e) => e.endsWith(":tracker")).length === 0);

  // 6. another user's identical project is untouched
  ({ team, proj, byExternal } = await seed());
  const A2 = byExternal.get("PAY-A")!, B2 = byExternal.get("PAY-B")!;
  await db.insert(workItemLinksTable).values({
    userId: "other", teamId: team.id, projectId: proj.id, fromItemId: B2.id, toItemId: A2.id,
    linkType: "blocks", source: "tracker",
  });
  await reconcileTrackerLinks({ userId: U, projectId: proj.id, teamId: team.id, byExternal, links: [] });
  const foreign = await db.select().from(workItemLinksTable).where(eq(workItemLinksTable.userId, "other"));
  check("scoped by userId — another user's row survives", foreign.length === 1);

  // 7. a two-way cycle is stored as two rows, not collapsed
  ({ team, proj, byExternal } = await seed());
  await reconcileTrackerLinks({ userId: U, projectId: proj.id, teamId: team.id, byExternal, links: [
    { fromKey: "PAY-A", toKey: "PAY-B", linkType: "blocks" },
    { fromKey: "PAY-B", toKey: "PAY-A", linkType: "blocks" },
  ]});
  check("stores both directions of a cycle", (await edges(proj.id)).length === 2);

  // 8. deleting a task cascades its edges away
  await db.delete(tasksTable).where(and(eq(tasksTable.externalId, "PAY-A"), eq(tasksTable.projectId, proj.id)));
  check("task delete cascades to its links", (await edges(proj.id)).length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
