/**
 * Data-layer checks for the domain-context schema (0052).
 *
 * Needs DATABASE_URL. Creates and deletes its own synthetic rows; truncates
 * nothing. See ../sequence-verify/README.md for the throwaway-Postgres recipe.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/domain-verify/schema.ts
 *
 * The unit tests next to the source cover the vocabulary. These cover the part
 * that is only true if Postgres says so, and that a service could otherwise
 * quietly stop honouring:
 *
 *  1. The REVIEW GATE is structural. A `confirmed` row with no reviewer is
 *     refused, so an extractor cannot write one even if its code tried.
 *  2. A `rejected` row with no reason is refused, so a dismissal is always
 *     attributable. The same discipline baseline_findings carries.
 *  3. Evidence without a locator is refused, per kind. Code evidence with no
 *     path cannot be checked against anything, so it is not evidence.
 *  4. A confirmed rule OUTLIVES the extraction that proposed it, and outlives
 *     being superseded. Both are human decisions and must survive the job.
 *  5. Deleting a rule takes its evidence with it, and nothing else.
 *
 * Checks 1 to 3 are the ones worth planting a regression against: each is a
 * constraint that a future migration could drop without any test noticing,
 * which is precisely how 0033's trigger gap went unseen.
 */
import { eq, sql } from "drizzle-orm";
import {
  db,
  domainExtractionsTable,
  domainRulesTable,
  domainRuleEvidenceTable,
} from "@workspace/db";

const OWNER = "dom-verify-owner";
const PROJECT_ID = 99_000_001; // synthetic; these tables carry no FK to projects
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

/** Run a write that must be refused, and say whether the right thing refused it. */
async function refused(constraint: string, write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return false;
  } catch (err) {
    // A constraint violation arrives wrapped by Drizzle, so the detail lives on
    // err.cause, not err — the trap CLAUDE.md records for 23505 and for
    // trigger errors. Matching only String(err) reports a false pass.
    const text = `${String(err)} ${String((err as { cause?: unknown })?.cause ?? "")}`;
    if (!text.includes(constraint)) {
      console.log(`      refused, but not by ${constraint}: ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  }
}

async function cleanup() {
  await db.execute(sql`DELETE FROM domain_rules WHERE user_id = ${OWNER}`);
  await db.execute(sql`DELETE FROM domain_extractions WHERE user_id = ${OWNER}`);
}

async function makeExtraction(): Promise<number> {
  const [row] = await db
    .insert(domainExtractionsTable)
    .values({
      userId: OWNER,
      projectId: PROJECT_ID,
      triggeredBy: OWNER,
      status: "succeeded",
      sourcesCounted: { tracker: 12, code: 30 },
      rulesProposed: 3,
    })
    .returning({ id: domainExtractionsTable.id });
  return row.id;
}

async function makeRule(over: Partial<typeof domainRulesTable.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(domainRulesTable)
    .values({
      userId: OWNER,
      projectId: PROJECT_ID,
      kind: "rule",
      statement: "A policy must exist before a claim can be paid.",
      fingerprint: `fp-${Math.random().toString(36).slice(2)}`,
      ...over,
    })
    .returning({ id: domainRulesTable.id });
  return row.id;
}

async function main() {
  await cleanup();

  // --- 1. The review gate is structural --------------------------------
  {
    check(
      "a confirmed rule with no reviewer is refused",
      await refused("domain_rules_confirmed_has_reviewer", () =>
        makeRule({ status: "confirmed" }),
      ),
    );
    const ok = await makeRule({ status: "confirmed", reviewedBy: "admin_1", reviewedAt: new Date() });
    check("a confirmed rule naming its reviewer is accepted", ok > 0);

    // The case the gate exists for: a row cannot be promoted later either.
    check(
      "an existing rule cannot be promoted to confirmed without a reviewer",
      await refused("domain_rules_confirmed_has_reviewer", () =>
        db.update(domainRulesTable).set({ status: "confirmed", reviewedBy: null }).where(eq(domainRulesTable.id, ok)),
      ),
    );
  }

  // --- 2. A rejection is always attributable ----------------------------
  {
    check(
      "a rejected rule with no reason is refused",
      await refused("domain_rules_rejected_has_reason", () => makeRule({ status: "rejected" })),
    );
    check(
      "a rejected rule with a blank reason is refused",
      await refused("domain_rules_rejected_has_reason", () =>
        makeRule({ status: "rejected", reviewNote: "   " }),
      ),
    );
    const ok = await makeRule({
      status: "rejected",
      reviewNote: "Not true of this project.",
      reviewedBy: "admin_1",
    });
    check("a rejected rule with a reason is accepted", ok > 0);
  }

  // --- 3. Evidence must carry a locator ---------------------------------
  {
    const ruleId = await makeRule();
    const bad: { kind: "code" | "tracker" | "document" | "person"; label: string }[] = [
      { kind: "code", label: "code with no path" },
      { kind: "tracker", label: "tracker with no key" },
      { kind: "document", label: "document with no source id" },
      { kind: "person", label: "person with nobody named" },
    ];
    for (const b of bad) {
      check(
        `evidence refused: ${b.label}`,
        await refused("domain_rule_evidence_has_locator", () =>
          db.insert(domainRuleEvidenceTable).values({ ruleId, kind: b.kind }),
        ),
      );
    }
    // And each kind with its own locator is accepted.
    await db.insert(domainRuleEvidenceTable).values([
      { ruleId, kind: "code", repositoryId: 1, filePath: "src/billing.ts", lineStart: 40, sourceRef: "abc123" },
      { ruleId, kind: "tracker", plmKey: "PAY-14" },
      { ruleId, kind: "document", knowledgeSourceId: 7 },
      { ruleId, kind: "person", statedBy: "someone@example.com" },
    ]);
    const rows = await db
      .select()
      .from(domainRuleEvidenceTable)
      .where(eq(domainRuleEvidenceTable.ruleId, ruleId));
    check("all four evidence kinds insert with their locator", rows.length === 4, `rows=${rows.length}`);
    check(
      "no evidence row can carry a quote",
      !Object.keys(rows[0]).includes("quote"),
      "a quote column would store excerpts of customer code and documents",
    );
  }

  // --- 4. A human decision outlives the job that proposed it ------------
  {
    const extractionId = await makeExtraction();
    const ruleId = await makeRule({
      extractionId,
      status: "confirmed",
      reviewedBy: "admin_1",
      reviewedAt: new Date(),
    });
    await db.delete(domainExtractionsTable).where(eq(domainExtractionsTable.id, extractionId));
    const [after] = await db.select().from(domainRulesTable).where(eq(domainRulesTable.id, ruleId));
    check("deleting the extraction leaves the confirmed rule standing", after != null);
    check("and clears only the link to it", after?.extractionId == null);
    check("the review decision survives", after?.reviewedBy === "admin_1" && after?.status === "confirmed");

    // Superseding: an edit writes a NEW row and points the old one at it.
    const newer = await makeRule({ status: "confirmed", reviewedBy: "admin_1", reviewedAt: new Date(), revision: 2 });
    await db.update(domainRulesTable).set({ supersededBy: newer }).where(eq(domainRulesTable.id, ruleId));
    await db.delete(domainRulesTable).where(eq(domainRulesTable.id, newer));
    const [stillThere] = await db.select().from(domainRulesTable).where(eq(domainRulesTable.id, ruleId));
    check("deleting the newer revision does not delete the older one", stillThere != null);
    check("and the supersession link is cleared, not dangling", stillThere?.supersededBy == null);
  }

  // --- 5. Evidence is owned by its rule ---------------------------------
  {
    const ruleId = await makeRule();
    await db.insert(domainRuleEvidenceTable).values({ ruleId, kind: "tracker", plmKey: "PAY-1" });
    const other = await makeRule();
    await db.insert(domainRuleEvidenceTable).values({ ruleId: other, kind: "tracker", plmKey: "PAY-2" });
    await db.delete(domainRulesTable).where(eq(domainRulesTable.id, ruleId));
    const gone = await db
      .select()
      .from(domainRuleEvidenceTable)
      .where(eq(domainRuleEvidenceTable.ruleId, ruleId));
    const kept = await db
      .select()
      .from(domainRuleEvidenceTable)
      .where(eq(domainRuleEvidenceTable.ruleId, other));
    check("deleting a rule takes its evidence", gone.length === 0);
    check("and leaves every other rule's evidence alone", kept.length === 1);
  }

  // --- the enum CHECKs -------------------------------------------------
  {
    check(
      "an unknown kind is refused by the database, not silently stored",
      await refused("domain_rules_kind_valid", () =>
        db.execute(
          sql`INSERT INTO domain_rules (user_id, project_id, kind, statement, fingerprint)
              VALUES (${OWNER}, ${PROJECT_ID}, 'invariant', 's', 'fp-x')`,
        ),
      ),
    );
    check(
      "an unknown status is refused",
      await refused("domain_rules_status_valid", () =>
        db.execute(
          sql`INSERT INTO domain_rules (user_id, project_id, kind, statement, fingerprint, status)
              VALUES (${OWNER}, ${PROJECT_ID}, 'rule', 's', 'fp-y', 'approved')`,
        ),
      ),
    );
  }

  await cleanup();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
