/**
 * Domain extraction: the database half.
 *
 * Loads a project's sources, runs ONE model call over them, and writes the
 * statements it can trace back to a source as `proposed` rules with evidence.
 * Nothing here can write a rule a run will use: `proposed` is the only status
 * an extraction may produce, the service enforces it, and a database CHECK
 * enforces that a `confirmed` row names the person who confirmed it. The
 * review gate is PR 2c; until it exists these rows are inert by construction.
 */

import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  domainExtractionsTable,
  domainRulesTable,
  domainRuleEvidenceTable,
  knowledgeChunksTable,
  knowledgeSourcesTable,
  projectsTable,
  tasksTable,
  type DomainExtraction,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { resolveModelKey, noModelKeyMessage } from "./modelKey.js";
import { actualCostUsd } from "./baselineScanCore.js";
import { getProjectRepository } from "./repoResolver.js";
import {
  BUNDLE_BUDGET_TOKENS,
  buildBundle,
  extractionPrompt,
  parseExtraction,
  ruleFingerprint,
  type SourceItem,
} from "./domainExtractCore.js";
import { isExtractableStatus } from "../../../../shared/types/domainRule.js";

const MODEL = "claude-sonnet-4-5";
const MAX_OUTPUT_TOKENS = 16_384;

/**
 * Chunks taken from each uploaded document.
 *
 * Round-robin across documents rather than document by document: a single
 * long architecture file would otherwise spend the whole budget and the
 * requirements document beside it would never be read at all.
 */
const CHUNKS_PER_DOCUMENT = 8;

/** The statuses that mean an extraction is already in flight for a project. */
const IN_FLIGHT = ["queued", "extracting"] as const;

export class DomainExtractError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "DomainExtractError";
  }
}

/**
 * The sources, in the order the bundle should spend its budget on them.
 *
 * Epics, then stories, then document passages. That ranking is a product
 * judgement, not a rendering detail, which is why it lives here and the
 * builder simply fills in the order it is given: an epic states why a body of
 * work exists, a story states what it must do, and both are written in the
 * business's own language before anybody translated them into code.
 *
 * Tasks, bugs and test cases are left out on purpose. They describe one
 * change each, and a single change's requirement is exactly what the prompt
 * tells the model not to return.
 *
 * A tracker item with no external id is also left out. Evidence of kind
 * `tracker` must carry a plm_key (the locator CHECK in 0052), so a local-only
 * item could be cited but never stored, and including it would spend budget
 * producing rules whose evidence is dropped on the way to the database.
 */
export async function loadSources(
  userId: string,
  projectId: number,
): Promise<{ items: SourceItem[]; skippedLocalItems: number }> {
  const items: SourceItem[] = [];

  const tracker = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.projectId, projectId)))
    .orderBy(asc(tasksTable.id));

  let skippedLocalItems = 0;
  for (const type of ["epic", "story"] as const) {
    for (const t of tracker) {
      if (t.itemType !== type) continue;
      if (!t.externalId) {
        skippedLocalItems++;
        continue;
      }
      items.push({
        kind: "tracker",
        taskId: t.id,
        plmKey: t.externalId,
        itemType: t.itemType,
        title: t.title,
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
      });
    }
  }

  const sources = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.userId, userId),
        eq(knowledgeSourcesTable.projectId, projectId),
        eq(knowledgeSourcesTable.status, "ready"),
      ),
    )
    .orderBy(asc(knowledgeSourcesTable.id));

  if (sources.length > 0) {
    const chunks = await db
      .select()
      .from(knowledgeChunksTable)
      .where(
        and(
          eq(knowledgeChunksTable.userId, userId),
          eq(knowledgeChunksTable.projectId, projectId),
          inArray(
            knowledgeChunksTable.sourceId,
            sources.map((s) => s.id),
          ),
        ),
      )
      .orderBy(asc(knowledgeChunksTable.sourceId), asc(knowledgeChunksTable.seq));

    const bySource = new Map<number, typeof chunks>();
    for (const c of chunks) {
      const list = bySource.get(c.sourceId) ?? [];
      if (list.length < CHUNKS_PER_DOCUMENT) list.push(c);
      bySource.set(c.sourceId, list);
    }
    // Round-robin, so every document contributes its opening passage before
    // any document contributes its second.
    for (let i = 0; i < CHUNKS_PER_DOCUMENT; i++) {
      for (const s of sources) {
        const c = bySource.get(s.id)?.[i];
        if (!c) continue;
        items.push({
          kind: "document",
          knowledgeSourceId: s.id,
          title: s.title,
          docType: s.docType,
          heading: c.heading,
          page: c.page,
          text: c.text,
        });
      }
    }
  }

  return { items, skippedLocalItems };
}

/**
 * Record the request. The work happens on the dispatcher's next tick.
 *
 * Deliberately not run inline: one model call over a 40,000-token bundle is
 * well inside the function's ceiling, but nothing is waiting on the answer
 * (the review queue is PR 2c), and a request held open for a minute to
 * produce rows nobody reads yet buys nothing. The row IS the handoff, and
 * dispatcher step 9 is also the retry if a tick dies mid-extraction.
 */
export async function requestExtraction(
  projectId: number,
  opts: { userId: string; teamId: number | null; triggeredBy: string },
): Promise<DomainExtraction> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) throw new DomainExtractError("Project not found", 404);

  const existing = await db
    .select({ id: domainExtractionsTable.id })
    .from(domainExtractionsTable)
    .where(
      and(
        eq(domainExtractionsTable.projectId, projectId),
        inArray(domainExtractionsTable.status, [...IN_FLIGHT]),
      ),
    );
  if (existing.length > 0) {
    throw new DomainExtractError("An extraction is already running for this project.", 409);
  }

  // Scoped to the project's OWNER, like every other read here.
  const repo = await getProjectRepository(projectId, project.userId);
  const [row] = await db
    .insert(domainExtractionsTable)
    .values({
      userId: project.userId,
      projectId,
      repositoryId: repo?.id ?? null,
      teamId: opts.teamId,
      triggeredBy: opts.triggeredBy,
      status: "queued",
    })
    .returning();
  return row;
}

/**
 * Take a queued extraction, or find it already taken.
 *
 * A single conditional UPDATE, the shape `claimQueuedIndex` uses, and
 * exported for the same reason: a concurrency test that races two dispatcher
 * ticks proves nothing, because they serialize on the connection pool and the
 * condition is never reached. Racing this function directly is what makes
 * removing the `status = 'queued'` clause turn [true, false] into [true, true].
 */
export async function claimQueuedExtraction(extractionId: number): Promise<boolean> {
  const claimed = await db
    .update(domainExtractionsTable)
    .set({ status: "extracting", startedAt: new Date(), error: null })
    .where(and(eq(domainExtractionsTable.id, extractionId), eq(domainExtractionsTable.status, "queued")))
    .returning({ id: domainExtractionsTable.id });
  return claimed.length > 0;
}

async function fail(extractionId: number, message: string): Promise<void> {
  await db
    .update(domainExtractionsTable)
    .set({ status: "failed", error: message.slice(0, 500), finishedAt: new Date() })
    .where(eq(domainExtractionsTable.id, extractionId));
}

/**
 * Run one claimed extraction. Never throws: a failure lands on the row, the
 * way `executeRun` and `runExtraction` in uiStyleService both do, because a
 * dispatcher tick must survive one project's bad day.
 */
export async function runExtraction(extraction: DomainExtraction): Promise<void> {
  const { id, projectId, userId } = extraction;
  try {
    const { items, skippedLocalItems } = await loadSources(userId, projectId);
    const bundle = buildBundle(items, BUNDLE_BUDGET_TOKENS);
    if (bundle.entries.length === 0) {
      await fail(
        id,
        "This project has no epics or stories with a tracker key, and no uploaded documents, so there is nothing to read.",
      );
      return;
    }

    // The OWNER's key, never the actor's: a team admin starting an extraction
    // on someone else's project must not move the cost onto their own
    // preference. The trap 0040, 0042 and 0046 each hit in turn.
    const agentKey = await resolveModelKey(userId, "anthropic");
    if (!agentKey.key) {
      await fail(id, noModelKeyMessage(false));
      return;
    }

    const prompt = extractionPrompt(bundle.text);
    const estimateIn = bundle.approxTokens + 400;
    await db
      .update(domainExtractionsTable)
      .set({
        model: MODEL,
        sourcesCounted: {
          tracker: bundle.counts.tracker,
          document: bundle.counts.document,
          droppedForBudget: bundle.dropped,
          skippedLocalItems,
        },
        estimatedCostUsd: priceOrNull(estimateIn, MAX_OUTPUT_TOKENS / 4),
      })
      .where(eq(domainExtractionsTable.id, id));

    const client = new Anthropic({ apiKey: agentKey.key });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

    // A reply cut off at the ceiling is unparseable JSON, and "could not be
    // parsed" would blame the model's formatting for a budget problem. The
    // lesson the post-commit agents paid for.
    if (message.stop_reason === "max_tokens") {
      await fail(
        id,
        `The reply was cut off at the ${MAX_OUTPUT_TOKENS}-token ceiling. Narrow the project's sources and try again.`,
      );
      return;
    }

    const block = message.content[0];
    if (!block || block.type !== "text") {
      await fail(id, "The model returned no text.");
      return;
    }

    const knownRefs = new Set(bundle.entries.map((e) => e.ref));
    const parsed = parseExtraction(block.text, knownRefs);
    const byRef = new Map(bundle.entries.map((e) => [e.ref, e.item]));
    const written = await persistRules(extraction, parsed.rules, byRef);

    const usage = message.usage;
    await db
      .update(domainExtractionsTable)
      .set({
        status: "succeeded",
        rulesProposed: written,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        actualCostUsd: priceOrNull(usage?.input_tokens ?? 0, usage?.output_tokens ?? 0),
        finishedAt: new Date(),
      })
      .where(eq(domainExtractionsTable.id, id));

    logger.info(
      {
        extractionId: id,
        projectId,
        agent: "domain",
        model: MODEL,
        sources: bundle.entries.length,
        returned: parsed.rules.length,
        written,
        droppedUncited: parsed.dropped.uncited,
        droppedUnknownRef: parsed.dropped.unknownRef,
      },
      "Domain extraction finished",
    );
  } catch (err) {
    logger.error({ err, extractionId: id, projectId }, "Domain extraction failed");
    await fail(id, err instanceof Error ? err.message : "Extraction failed.");
  }
}

/** An unpriced model records null, not zero. The rule 0050 set. */
function priceOrNull(input: number, output: number): string | null {
  const usd = actualCostUsd(MODEL, input, output);
  return usd == null ? null : usd.toFixed(4);
}

/**
 * Write the statements that are new to this project.
 *
 * A fingerprint that already exists is SKIPPED whatever status it holds, and
 * that is the whole point of having one: a statement somebody rejected must
 * not return as new because the model reworded it, and a confirmed statement
 * must not end up sitting beside a duplicate of itself awaiting review.
 *
 * Evidence is written from the bundle, never from the reply. The model names
 * an id; this maps that id back to the item the server put in the bundle and
 * takes the locator from there. A path or a tracker key that came out of a
 * model is a path or a key the model chose.
 */
/**
 * Exported for `scripts/domain-verify/extract.ts`, the precedent
 * `claimQueuedExtraction` and `validateFindingPaths` both set: the
 * fingerprint skip and the evidence locators are the part worth proving
 * against a real database, and they cannot be reached through a route
 * without a model call.
 */
export async function persistRules(
  extraction: DomainExtraction,
  rules: Awaited<ReturnType<typeof parseExtraction>>["rules"],
  byRef: Map<string, SourceItem>,
): Promise<number> {
  if (rules.length === 0) return 0;

  const fingerprints = rules.map((r) => ruleFingerprint(extraction.projectId, r.kind, r.statement));
  const existing = await db
    .select({ fingerprint: domainRulesTable.fingerprint })
    .from(domainRulesTable)
    .where(
      and(
        eq(domainRulesTable.projectId, extraction.projectId),
        inArray(domainRulesTable.fingerprint, fingerprints),
      ),
    );
  const seen = new Set(existing.map((e) => e.fingerprint));

  let written = 0;
  for (const [i, rule] of rules.entries()) {
    const fingerprint = fingerprints[i];
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    // Belt and braces with the database CHECK: an extraction may write
    // `proposed` and nothing else, so the review gate cannot be bypassed by a
    // future edit to this function.
    if (!isExtractableStatus("proposed")) continue;

    const [row] = await db
      .insert(domainRulesTable)
      .values({
        userId: extraction.userId,
        projectId: extraction.projectId,
        extractionId: extraction.id,
        kind: rule.kind,
        statement: rule.statement,
        detail: rule.detail,
        status: "proposed",
        origin: "inferred",
        confidence: rule.confidence == null ? null : String(rule.confidence),
        fingerprint,
      })
      .returning({ id: domainRulesTable.id });

    // Typed up front rather than inferred from the branches: a flatMap over
    // a union of two row shapes widens to the first branch's type and the
    // insert stops compiling.
    const evidence: (typeof domainRuleEvidenceTable.$inferInsert)[] = [];
    for (const ref of rule.refs) {
      const item = byRef.get(ref);
      if (!item) continue;
      if (item.kind === "tracker") {
        if (!item.plmKey) continue;
        evidence.push({ ruleId: row.id, kind: "tracker", plmKey: item.plmKey });
      } else {
        evidence.push({
          ruleId: row.id,
          kind: "document",
          knowledgeSourceId: item.knowledgeSourceId,
        });
      }
    }
    if (evidence.length > 0) await db.insert(domainRuleEvidenceTable).values(evidence);
    written++;
  }
  return written;
}

/**
 * Dispatcher step: drain queued extractions.
 *
 * One at a time by default. An extraction is a single large model call on a
 * customer's own key, and a tick that started four of them at once would turn
 * one scheduled sweep into four simultaneous charges.
 */
export async function dispatchQueuedExtractions(limit = 1): Promise<number> {
  const queued = await db
    .select()
    .from(domainExtractionsTable)
    .where(eq(domainExtractionsTable.status, "queued"))
    .orderBy(asc(domainExtractionsTable.id))
    .limit(limit);

  let started = 0;
  for (const row of queued) {
    if (!(await claimQueuedExtraction(row.id))) continue;
    started++;
    await runExtraction(row);
  }
  return started;
}
