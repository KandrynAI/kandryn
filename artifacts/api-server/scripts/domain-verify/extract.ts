/**
 * Domain extraction (PR 2b) — data-layer checks.
 *
 * The unit tests beside the source cover the bundle, the prompt, the parser
 * and the fingerprint, all without a database. These cover what they cannot:
 * the claim under a real race, the fingerprint skip across two extractions,
 * what the evidence locator CHECK actually refuses, and the source ordering.
 *
 * Needs DATABASE_URL. Truncates the rows it writes. See README.md.
 */

import { sql, eq, asc } from "drizzle-orm";
import {
  db,
  domainExtractionsTable,
  domainRuleEvidenceTable,
  domainRulesTable,
  knowledgeChunksTable,
  knowledgeSourcesTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  claimQueuedExtraction,
  loadSources,
  persistRules,
  requestExtraction,
  DomainExtractError,
} from "../../src/services/domainExtractService.js";
import { buildBundle, ruleFingerprint, type SourceItem } from "../../src/services/domainExtractCore.js";

const OWNER = "user_domain_2b";
let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cleanup(projectId?: number) {
  await db.execute(sql`DELETE FROM domain_rules WHERE user_id = ${OWNER}`);
  await db.execute(sql`DELETE FROM domain_extractions WHERE user_id = ${OWNER}`);
  await db.execute(sql`DELETE FROM knowledge_chunks WHERE user_id = ${OWNER}`);
  await db.execute(sql`DELETE FROM knowledge_sources WHERE user_id = ${OWNER}`);
  await db.execute(sql`DELETE FROM tasks WHERE user_id = ${OWNER}`);
  if (projectId) await db.execute(sql`DELETE FROM projects WHERE id = ${projectId}`);
}

async function makeProject(): Promise<number> {
  const [p] = await db
    .insert(projectsTable)
    .values({
      userId: OWNER,
      name: "Domain 2b",
      plmProvider: "jira",
      plmProjectKey: `D2B${Math.floor(Math.random() * 100000)}`,
      plmProjectName: "Domain 2b",
    })
    .returning({ id: projectsTable.id });
  return p.id;
}

async function main() {
  await cleanup();
  const projectId = await makeProject();

  // ── 1. The claim, raced directly ─────────────────────────────────────────
  // Raced through dispatchQueuedExtractions() this proves nothing: two ticks
  // serialize on the connection pool, so the second read happens after the
  // first write and the conditional UPDATE is never exercised. The claim is
  // exported so it can be raced for real. (CLAUDE.md, 0048.)
  console.log("\n1. claim under a real race");
  const [queued] = await db
    .insert(domainExtractionsTable)
    .values({ userId: OWNER, projectId, triggeredBy: OWNER, status: "queued" })
    .returning();
  const raced = await Promise.all([
    claimQueuedExtraction(queued.id),
    claimQueuedExtraction(queued.id),
    claimQueuedExtraction(queued.id),
  ]);
  check("exactly one of three racers claims it", raced.filter(Boolean).length === 1, JSON.stringify(raced));
  const [afterClaim] = await db
    .select()
    .from(domainExtractionsTable)
    .where(eq(domainExtractionsTable.id, queued.id));
  check("the winner moved it to extracting", afterClaim.status === "extracting", afterClaim.status);
  check("and stamped started_at", afterClaim.startedAt != null);
  check("claiming an already-claimed row is false", (await claimQueuedExtraction(queued.id)) === false);

  // ── 2. One extraction at a time per project ──────────────────────────────
  console.log("\n2. a second request while one is in flight");
  let refused = false;
  let status = 0;
  try {
    await requestExtraction(projectId, { userId: OWNER, teamId: null, triggeredBy: OWNER });
  } catch (err) {
    refused = err instanceof DomainExtractError;
    status = err instanceof DomainExtractError ? err.status : 0;
  }
  check("is refused", refused);
  check("with 409, not 500", status === 409, String(status));

  // ── 3. Persisting rules and their evidence ───────────────────────────────
  console.log("\n3. rules and evidence");
  const items: SourceItem[] = [
    {
      kind: "tracker",
      taskId: 1,
      plmKey: "CLM-1",
      itemType: "epic",
      title: "Claims review",
      description: null,
      acceptanceCriteria: null,
    },
    {
      kind: "document",
      knowledgeSourceId: 4242,
      title: "Ops policy",
      docType: "requirements",
      heading: null,
      page: null,
      text: "The clock pauses.",
    },
  ];
  const bundle = buildBundle(items);
  const byRef = new Map(bundle.entries.map((e) => [e.ref, e.item]));
  const statement = "The review clock pauses while the team waits on the customer.";
  const written = await persistRules(
    afterClaim,
    [{ kind: "rule", statement, detail: "From the operating policy.", confidence: 0.8, refs: ["T1", "D1"] }],
    byRef,
  );
  check("one rule written", written === 1, String(written));

  const rules = await db.select().from(domainRulesTable).where(eq(domainRulesTable.projectId, projectId));
  check("stored as proposed, never confirmed", rules[0]?.status === "proposed", rules[0]?.status);
  check("origin is inferred", rules[0]?.origin === "inferred");
  check("fingerprint matches the pure one", rules[0]?.fingerprint === ruleFingerprint(projectId, "rule", statement));

  const evidence = await db
    .select()
    .from(domainRuleEvidenceTable)
    .where(eq(domainRuleEvidenceTable.ruleId, rules[0].id))
    .orderBy(asc(domainRuleEvidenceTable.id));
  check("two evidence rows", evidence.length === 2, String(evidence.length));
  check("the tracker row carries the key the SERVER put in the bundle", evidence[0]?.plmKey === "CLM-1");
  check("the document row carries the source id", evidence[1]?.knowledgeSourceId === 4242);
  check("and no quote of the text is stored", !("quote" in (evidence[0] ?? {})));

  // ── 4. The fingerprint carries a decision forward ────────────────────────
  console.log("\n4. a second extraction does not duplicate or resurrect");
  const again = await persistRules(
    afterClaim,
    [{ kind: "rule", statement: `  ${statement.toUpperCase()}  `, detail: null, confidence: null, refs: ["T1"] }],
    byRef,
  );
  check("a reworded duplicate writes nothing", again === 0, String(again));

  await db
    .update(domainRulesTable)
    .set({ status: "rejected", reviewNote: "Not how it works." })
    .where(eq(domainRulesTable.id, rules[0].id));
  const afterReject = await persistRules(
    afterClaim,
    [{ kind: "rule", statement, detail: null, confidence: null, refs: ["T1"] }],
    byRef,
  );
  check("a rejected rule is not proposed again", afterReject === 0, String(afterReject));

  // ── 5. What the locator CHECK refuses ────────────────────────────────────
  console.log("\n5. the evidence locator CHECK");
  let refusedTracker = false;
  try {
    await db.insert(domainRuleEvidenceTable).values({ ruleId: rules[0].id, kind: "tracker" });
  } catch {
    refusedTracker = true;
  }
  check("tracker evidence with no plm_key is refused by the database", refusedTracker);

  // ── 6. Which sources are read, and in what order ─────────────────────────
  console.log("\n6. source selection");
  const task = (
    title: string,
    itemType: "epic" | "story" | "task",
    externalId: string | null,
  ): typeof tasksTable.$inferInsert => ({
    userId: OWNER,
    projectId,
    title,
    itemType,
    externalId,
    status: "open",
    source: "jira",
    type: "feature",
  });
  await db.insert(tasksTable).values([
    task("Story one", "story", "CLM-20"),
    task("Epic one", "epic", "CLM-10"),
    task("Local epic", "epic", null),
    task("A task", "task", "CLM-30"),
  ]);
  const loaded = await loadSources(OWNER, projectId);
  const trackerKeys = loaded.items
    .filter((i): i is Extract<SourceItem, { kind: "tracker" }> => i.kind === "tracker")
    .map((i) => i.plmKey);
  check("epics come before stories", JSON.stringify(trackerKeys) === JSON.stringify(["CLM-10", "CLM-20"]), JSON.stringify(trackerKeys));
  check("a task is not a source", !trackerKeys.includes("CLM-30"));
  check("a local-only item is skipped and counted", loaded.skippedLocalItems === 1, String(loaded.skippedLocalItems));

  // Two documents, so the round-robin is observable.
  const [docA] = await db
    .insert(knowledgeSourcesTable)
    .values({ userId: OWNER, projectId, docType: "architecture", title: "A", fileName: "a.md", mimeType: "text/markdown", sizeBytes: 10, storagePath: "a", status: "ready" })
    .returning({ id: knowledgeSourcesTable.id });
  const [docB] = await db
    .insert(knowledgeSourcesTable)
    .values({ userId: OWNER, projectId, docType: "requirements", title: "B", fileName: "b.md", mimeType: "text/markdown", sizeBytes: 10, storagePath: "b", status: "ready" })
    .returning({ id: knowledgeSourcesTable.id });
  await db.insert(knowledgeChunksTable).values([
    { sourceId: docA.id, userId: OWNER, projectId, seq: 0, text: "A0" },
    { sourceId: docA.id, userId: OWNER, projectId, seq: 1, text: "A1" },
    { sourceId: docB.id, userId: OWNER, projectId, seq: 0, text: "B0" },
  ]);
  const withDocs = await loadSources(OWNER, projectId);
  const passages = withDocs.items
    .filter((i): i is Extract<SourceItem, { kind: "document" }> => i.kind === "document")
    .map((i) => i.text);
  check(
    "documents interleave, so one long file cannot silence another",
    JSON.stringify(passages) === JSON.stringify(["A0", "B0", "A1"]),
    JSON.stringify(passages),
  );

  await cleanup(projectId);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
