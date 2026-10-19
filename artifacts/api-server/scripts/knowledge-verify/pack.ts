// buildRunContextPack end to end: the pack a run actually receives, and the
// scoping decision behind it (project owner, not the triggering user).
// Needs DATABASE_URL — see README.md.
import { db, knowledgeChunksTable, knowledgeSourcesTable, projectsTable, tasksTable } from "@workspace/db";
import { buildRunContextPack } from "../../src/services/contextService.js";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const POLICY_TEXT =
  "A claim may only be settled when an active policy exists for the claim date. Policy existence must be verified explicitly before any claim is returned.";

async function main() {
  await db.delete(knowledgeChunksTable);
  await db.delete(knowledgeSourcesTable);
  await db.delete(tasksTable);
  await db.delete(projectsTable);

  const OWNER = "owner-1";
  const ADMIN = "admin-9";
  const [p] = await db
    .insert(projectsTable)
    .values({ userId: OWNER, name: "PnC", plmProvider: "jira", plmProjectKey: "PAY" })
    .returning();
  const mk = (externalId: string, itemType: "epic" | "story" | "task", parentId: number | null, title: string) =>
    db.insert(tasksTable).values({ userId: OWNER, projectId: p.id, externalId, source: "jira", type: "task", itemType, parentId, title }).returning();
  const [epic] = await mk("PAY-1", "epic", null, "Claims settlement");
  const [story] = await mk("PAY-2", "story", epic.id, "Policy checks");
  const [task] = await mk("PAY-3", "task", story.id, "Validate policy existence before settling a claim");

  const [src] = await db
    .insert(knowledgeSourcesTable)
    .values({ userId: OWNER, projectId: p.id, docType: "architecture", title: "Platform architecture",
      fileName: "arch.md", mimeType: "text/markdown", sizeBytes: 100, storagePath: "x", status: "ready", chunkCount: 1 })
    .returning();
  await db.insert(knowledgeChunksTable).values({ sourceId: src.id, userId: OWNER, projectId: p.id, seq: 0, heading: "Policy validation", page: null, text: POLICY_TEXT });

  const workItem = { title: task.title, acceptanceCriteria: ["Reject a claim with no active policy"] };

  // The owner's own run: both halves present.
  const own = await buildRunContextPack({ projectId: p.id, workItemId: task.id, fallbackUserId: OWNER, workItem });
  const kinds = own.manifest?.sections.map((s) => `${s.kind}:${s.included}`) ?? [];
  check("the pack carries both the ancestor chain and the document passage", kinds.join(",") === "parent_chain:2,reference_material:1", kinds.join(","));
  check("the pack text names the epic and the passage", /PAY-1/.test(own.text) && /policy exists/.test(own.text));

  // A run TRIGGERED BY A TEAM ADMIN: runs.userId is the admin, but the rows
  // belong to the owner. Scoping by the project owner is what keeps this from
  // silently returning nothing.
  const asAdmin = await buildRunContextPack({ projectId: p.id, workItemId: task.id, fallbackUserId: ADMIN, workItem });
  check(
    "a run triggered by a non-owner still gets the owner's context",
    JSON.stringify(asAdmin.manifest?.sections.map((s) => s.included)) === "[2,1]",
    JSON.stringify(asAdmin.manifest?.sections),
  );

  // An unindexed document is not retrieved — a half-parsed upload must never
  // reach a prompt.
  await db.delete(knowledgeChunksTable);
  const bare = await buildRunContextPack({ projectId: p.id, workItemId: task.id, fallbackUserId: OWNER, workItem });
  check("with no chunks, only the parent chain is carried", (bare.manifest?.sections ?? []).every((s) => s.kind === "parent_chain"), JSON.stringify(bare.manifest?.sections));

  // A root item in a project with no documents: no pack at all, i.e. exactly
  // the prompt a run got before either feature existed.
  const none = await buildRunContextPack({ projectId: p.id, workItemId: epic.id, fallbackUserId: OWNER, workItem: { title: "Unrelated infrastructure chore" } });
  check("a root item with nothing to retrieve yields no pack", none.text === "" && none.manifest === null, JSON.stringify(none.manifest));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
