// loadAncestors — the chain walk, its depth cap, and its tenancy filters.
// Needs DATABASE_URL — see ../sequence-verify/README.md for the throwaway
// Postgres recipe (this script truncates projects and tasks).
import { db, projectsTable, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loadAncestors } from "../../src/services/contextService.js";

const U = "u1";
const OTHER = "u2";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

async function reset() {
  await db.delete(tasksTable);
  await db.delete(projectsTable);
}

async function project(userId: string, key: string) {
  const [p] = await db
    .insert(projectsTable)
    .values({ userId, name: key, plmProvider: "jira", plmProjectKey: key })
    .returning();
  return p;
}

async function item(
  userId: string,
  projectId: number,
  externalId: string,
  itemType: "epic" | "story" | "task",
  parentId: number | null,
) {
  const [t] = await db
    .insert(tasksTable)
    .values({ userId, projectId, externalId, source: "jira", type: "task", itemType, title: externalId, parentId })
    .returning();
  return t;
}

const keys = (rows: Array<{ externalId: string | null }>) => rows.map((r) => r.externalId).join(",");

async function main() {
  // 1. epic → story → task: the chain comes back outermost-first.
  await reset();
  let p = await project(U, "PAY");
  const epic = await item(U, p.id, "PAY-1", "epic", null);
  const story = await item(U, p.id, "PAY-2", "story", epic.id);
  const task = await item(U, p.id, "PAY-3", "task", story.id);
  check("returns the chain outermost-first", keys(await loadAncestors(U, p.id, task.id)) === "PAY-1,PAY-2");

  // 2. a root item has no ancestors.
  check("a root item yields an empty chain", (await loadAncestors(U, p.id, epic.id)).length === 0);

  // 3. the depth cap truncates from the far end, not the near one.
  check("depth 1 returns only the immediate parent", keys(await loadAncestors(U, p.id, task.id, 1)) === "PAY-2");

  // 4. a deeper tree than the default cap stops at three hops.
  await reset();
  p = await project(U, "DEEP");
  let prev = await item(U, p.id, "D-1", "epic", null);
  for (const k of ["D-2", "D-3", "D-4", "D-5"]) prev = await item(U, p.id, k, "story", prev.id);
  check("the default cap is three hops", keys(await loadAncestors(U, p.id, prev.id)) === "D-2,D-3,D-4");

  // 5. a cycle terminates instead of repeating an item.
  await reset();
  p = await project(U, "CYC");
  const a = await item(U, p.id, "C-A", "story", null);
  const b = await item(U, p.id, "C-B", "task", a.id);
  await db.update(tasksTable).set({ parentId: b.id }).where(eq(tasksTable.id, a.id));
  const cyc = await loadAncestors(U, p.id, b.id, 10);
  check("a parent cycle terminates", cyc.length <= 2 && new Set(cyc.map((r) => r.id)).size === cyc.length, keys(cyc));

  // 6. a parent owned by another user is not followed.
  await reset();
  p = await project(U, "TEN");
  const foreignProject = await project(OTHER, "TEN2");
  const foreignParent = await item(OTHER, foreignProject.id, "X-1", "epic", null);
  const mine = await item(U, p.id, "T-1", "task", null);
  await db.update(tasksTable).set({ parentId: foreignParent.id }).where(eq(tasksTable.id, mine.id));
  check("a parent owned by another user is not followed", (await loadAncestors(U, p.id, mine.id)).length === 0);

  // 7. a parent in another of the SAME user's projects is not followed either.
  await reset();
  p = await project(U, "P1");
  const p2 = await project(U, "P2");
  const otherProjectParent = await item(U, p2.id, "P2-1", "epic", null);
  const child = await item(U, p.id, "P1-1", "task", null);
  await db.update(tasksTable).set({ parentId: otherProjectParent.id }).where(eq(tasksTable.id, child.id));
  check("a parent in another project is not followed", (await loadAncestors(U, p.id, child.id)).length === 0);

  // 8. asking for an item that is not in the given project yields nothing.
  check("an out-of-project item yields nothing", (await loadAncestors(U, p2.id, child.id)).length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
