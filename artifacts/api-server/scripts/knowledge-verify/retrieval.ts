// Knowledge retrieval against a real database: the two tenancy filters, the
// ranking, the cascade, the rank bar, and the duplicate-upload constraint.
// Needs DATABASE_URL — see README.md (this script truncates its tables).
import { db, knowledgeChunksTable, knowledgeSourcesTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { retrieveReferences, MIN_RANK, buildSearchQuery } from "../../src/services/knowledgeRetrieval.js";

const U = "u1";
const OTHER = "u2";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

async function reset() {
  await db.delete(knowledgeChunksTable);
  await db.delete(knowledgeSourcesTable);
  await db.delete(projectsTable);
}

async function project(userId: string, key: string) {
  const [p] = await db
    .insert(projectsTable)
    .values({ userId, name: key, plmProvider: "jira", plmProjectKey: key })
    .returning();
  return p;
}

async function source(userId: string, projectId: number, title: string, over: Record<string, unknown> = {}) {
  const [s] = await db
    .insert(knowledgeSourcesTable)
    .values({
      userId,
      projectId,
      docType: "architecture",
      title,
      fileName: `${title}.md`,
      mimeType: "text/markdown",
      sizeBytes: 100,
      storagePath: `${userId}/${projectId}/x/${title}.md`,
      status: "ready",
      chunkCount: 0,
      ...over,
    })
    .returning();
  return s;
}

async function chunk(s: { id: number; userId: string; projectId: number }, seq: number, heading: string | null, text: string) {
  await db.insert(knowledgeChunksTable).values({
    sourceId: s.id,
    userId: s.userId,
    projectId: s.projectId,
    seq,
    heading,
    page: null,
    text,
  });
}

const POLICY_TEXT =
  "A claim may only be settled when an active policy exists for the claim date. Policy existence must be verified explicitly before any claim is returned.";
const UNRELATED_TEXT =
  "The nightly batch job compresses archived invoice PDFs and uploads them to cold storage for retention.";

const workItem = { title: "Validate policy existence before settling a claim", acceptanceCriteria: ["Reject a claim with no active policy"] };

async function main() {
  // 7. cross-project isolation
  await reset();
  const p1 = await project(U, "PAY");
  const p2 = await project(U, "BILL");
  const s1 = await source(U, p1.id, "p1-arch");
  const s2 = await source(U, p2.id, "p2-arch");
  await chunk(s1, 0, "Policy validation", POLICY_TEXT);
  await chunk(s2, 0, "Policy validation", POLICY_TEXT);

  const r1 = await retrieveReferences({ userId: U, projectId: p1.id, workItem });
  check(
    "7. a retrieval for project 1 never returns project 2 chunks",
    r1.length > 0 && r1.every((r) => r.sourceId === s1.id),
    JSON.stringify(r1.map((r) => r.sourceId)),
  );

  // 8. cross-user isolation. Same project id, another owner's rows.
  const pOther = await project(OTHER, "PAY2");
  const sOther = await source(OTHER, pOther.id, "other-arch");
  await chunk(sOther, 0, "Policy validation", POLICY_TEXT);
  const rOther = await retrieveReferences({ userId: U, projectId: pOther.id, workItem });
  check("8. another user's chunks are never returned", rOther.length === 0, JSON.stringify(rOther));

  // 9. ranking puts the matching chunk first
  await reset();
  const p = await project(U, "RANK");
  const s = await source(U, p.id, "arch");
  await chunk(s, 0, "Batch jobs", UNRELATED_TEXT);
  await chunk(s, 1, "Policy validation", POLICY_TEXT);
  const ranked = await retrieveReferences({ userId: U, projectId: p.id, workItem });
  check(
    "9. the chunk matching the query terms ranks first",
    ranked.length > 0 && /policy exists/.test(ranked[0].text),
    ranked.map((r) => `${r.rank.toFixed(3)}:${r.heading}`).join(" | "),
  );

  // 10. cascade
  const before = (await db.select().from(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceId, s.id))).length;
  await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, s.id));
  const after = (await db.select().from(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceId, s.id))).length;
  check("10. deleting a source removes its chunks", before === 2 && after === 0, `${before} -> ${after}`);

  // 11. a chunk below the rank bar is not returned. A single incidental word
  //     match in a long passage ranks far below the floor.
  await reset();
  const pBar = await project(U, "BAR");
  const sBar = await source(U, pBar.id, "arch");
  await chunk(sBar, 0, null, `${UNRELATED_TEXT} ${"Filler sentence about unrelated infrastructure. ".repeat(60)}claim`);
  const barred = await retrieveReferences({ userId: U, projectId: pBar.id, workItem });
  check(
    "11. a chunk below the rank bar is not returned",
    barred.length === 0,
    barred.map((r) => r.rank.toFixed(4)).join(",") || `(bar ${MIN_RANK})`,
  );

  // 12. duplicate content_hash in the same project -> 23505 on err.cause
  await reset();
  const pDup = await project(U, "DUP");
  await source(U, pDup.id, "first", { contentHash: "abc123" });
  let code: string | undefined;
  try {
    await source(U, pDup.id, "second", { contentHash: "abc123" });
  } catch (err) {
    // Drizzle wraps the driver error; the SQLSTATE is on err.cause, not err.
    code =
      (err as { code?: string }).code ??
      (err as { cause?: { code?: string } }).cause?.code;
  }
  check("12. a duplicate content_hash in the same project raises 23505", code === "23505", String(code));

  // 12b. the SAME hash in a DIFFERENT project is allowed — the index is
  //      per-project, and two teams may hold the same document.
  const pDup2 = await project(U, "DUP2");
  let crossOk = true;
  try {
    await source(U, pDup2.id, "third", { contentHash: "abc123" });
  } catch {
    crossOk = false;
  }
  check("12b. the same hash in another project is allowed", crossOk);

  // 12c. two pending sources (hash null) must not collide — the index is partial.
  let nullsOk = true;
  try {
    await source(U, pDup.id, "pending-a", { status: "pending" });
    await source(U, pDup.id, "pending-b", { status: "pending" });
  } catch {
    nullsOk = false;
  }
  check("12c. two sources with no hash yet do not collide", nullsOk);

  // A sanity check on the query builder, since every result above depends on
  // it: terms from BOTH the title and the acceptance criteria, OR-joined (an
  // AND query over a whole work item matches no single passage).
  const q = buildSearchQuery(workItem);
  check(
    "the search query OR-joins terms from the title and the acceptance criteria",
    q.includes(" or ") && /\bexistence\b/.test(q) && /\breject\b/.test(q),
    q,
  );

  // --- Replace semantics at the data layer -------------------------------
  // The route indexes the new source first and removes the old one only once
  // the new one is ready; what matters here is that the swap leaves exactly
  // one ready copy and no stranded chunks.
  await reset();
  const pRep = await project(U, "REP");
  const oldSrc = await source(U, pRep.id, "old-arch", { contentHash: "hash-old" });
  await chunk(oldSrc, 0, "Policy validation", POLICY_TEXT);
  const newSrc = await source(U, pRep.id, "new-arch", { contentHash: "hash-new" });
  await chunk(newSrc, 0, "Policy validation", `${POLICY_TEXT} Revised for the 2026 schedule.`);

  // Mid-replace both exist, which is the point: a failure here must leave the
  // original serving.
  let both = await retrieveReferences({ userId: U, projectId: pRep.id, workItem });
  check("replace: both copies are retrievable before the swap completes", both.length === 2, String(both.length));

  await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, oldSrc.id));
  const afterSwap = await retrieveReferences({ userId: U, projectId: pRep.id, workItem });
  check(
    "replace: exactly one ready copy survives the swap",
    afterSwap.length === 1 && afterSwap[0].sourceId === newSrc.id,
    JSON.stringify(afterSwap.map((r) => r.sourceId)),
  );

  const orphans = await db
    .select()
    .from(knowledgeChunksTable)
    .where(eq(knowledgeChunksTable.sourceId, oldSrc.id));
  check("replace: the old chunks went with the old source (cascade)", orphans.length === 0, String(orphans.length));

  // And the freed hash can be reused, so re-uploading the original later is
  // not blocked by the partial unique index.
  let reusable = true;
  try {
    await source(U, pRep.id, "old-again", { contentHash: "hash-old" });
  } catch {
    reusable = false;
  }
  check("replace: the removed document's hash is free to use again", reusable);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
