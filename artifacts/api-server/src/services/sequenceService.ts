import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import {
  db,
  tasksTable,
  projectsTable,
  teamsTable,
  runsTable,
  suggestionFilesTable,
  changePlansTable,
  changePlanFilesTable,
  workItemLinksTable,
  sequenceChecksTable,
} from "@workspace/db";
import * as audit from "./auditService.js";
import { canAdminister } from "./resourceAdmin.js";
import {
  directPrerequisites,
  transitivePrerequisites,
  findCycleThrough,
  orderPrerequisites,
  topologicalWaves,
  makeFindingId,
  computeFingerprint,
  verdictFrom,
  type GraphEdge,
} from "./sequenceGraph.js";
import {
  DEFAULT_SEQUENCE_POLICY,
  SEQUENCE_CHECK_TTL_MINUTES,
  type SequenceCheck,
  type SequenceFinding,
  type SequencePolicy,
} from "../../../../shared/types/sequence.js";
import { logger } from "../lib/logger.js";

export class SequenceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "SequenceError";
  }
}

export interface SequenceActor {
  userId: string;
  teamId: number | null;
  teamRole: string | null;
}

/** How far apart two items must sit in the backlog before rank is worth
 *  mentioning. Advisory, and only ever a caution. */
const RANK_GAP = 10;

type TaskRow = typeof tasksTable.$inferSelect;

/** A blocker's readiness, worst state first — the order findings are tested in. */
type BlockerState = "satisfied" | "gate_blocked" | "pr_open" | "not_started";

const itemLabel = (t: TaskRow): string => t.externalId ?? `#${t.id}`;

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Decide whether this work item is safe to run now, and why not if it is not.
 *
 * Entirely deterministic and model-free: this runs on the critical path of
 * every run request, so it has to be fast and it has to give the same answer
 * twice. The model is used only for the impact narrative, which is a separate
 * service and never blocks an override.
 *
 * The premise throughout is one fact about how Kandryn generates code: the
 * suggestion is produced against the repository's DEFAULT BRANCH. Anything not
 * merged there is invisible to the run, however finished it looks on a board.
 */
export interface ComputedCheck {
  item: TaskRow;
  project: typeof projectsTable.$inferSelect;
  policy: SequencePolicy;
  canOverride: boolean;
  findings: SequenceFinding[];
  suggestedFirst: SequenceCheck["suggestedFirst"];
}

/**
 * Run the analysis WITHOUT writing a snapshot.
 *
 * Split out because the run endpoint recomputes the check on every request,
 * and a run that comes back clear must not leave a row behind — otherwise the
 * snapshot table grows by one for every ordinary run on a healthy board. The
 * caller persists only when there is something a human will have to answer for.
 */
export async function computeCheck(workItemId: number, actor: SequenceActor): Promise<ComputedCheck> {
  const [item] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, workItemId), eq(tasksTable.userId, actor.userId)));
  if (!item) throw new SequenceError("Work item not found", 404);
  if (item.projectId == null) throw new SequenceError("Work item is not attached to a project.", 422);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, item.projectId));
  if (!project) throw new SequenceError("Project not found", 404);

  const policy = await resolvePolicy(project.teamId);
  // The project's team decides who may override, not the caller's. On a
  // personal project canAdminister falls back to ownership, so a solo operator
  // is never locked out of their own board by a policy they cannot escalate.
  const isAdmin = canAdminister(actor, { ownerUserId: project.userId, teamId: project.teamId });
  const canOverride = policy === "warn" || isAdmin;

  if (policy === "off") {
    return { item, project, policy, canOverride, findings: [], suggestedFirst: [] };
  }

  const siblings = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.projectId, item.projectId), eq(tasksTable.userId, actor.userId)));
  const byId = new Map(siblings.map((t) => [t.id, t]));

  const links = await db
    .select()
    .from(workItemLinksTable)
    .where(
      and(
        eq(workItemLinksTable.projectId, item.projectId),
        eq(workItemLinksTable.userId, actor.userId),
        eq(workItemLinksTable.linkType, "blocks"),
      ),
    );
  // A dismissed link is a human saying "this is not a dependency". Filtered
  // here rather than in SQL so one rule covers tracker, manual and inferred.
  const edges: GraphEdge[] = links
    .filter((l) => l.dismissedAt == null)
    .map((l) => ({ from: l.fromItemId, to: l.toItemId }));

  const findings: SequenceFinding[] = [];

  // --- prerequisites -------------------------------------------------------
  const prerequisiteIds = transitivePrerequisites(item.id, edges).filter((id) => byId.has(id));
  const states = await classifyBlockers(prerequisiteIds, byId);
  const unsatisfied = prerequisiteIds.filter((id) => states.get(id) !== "satisfied");

  for (const id of unsatisfied) {
    const blocker = byId.get(id)!;
    const key = itemLabel(blocker);
    const state = states.get(id)!;
    const direct = directPrerequisites(item.id, edges).includes(id);
    const via = direct ? "" : " (indirectly)";

    if (state === "gate_blocked") {
      findings.push({
        id: makeFindingId("blocker_gate_blocked", [key]),
        type: "blocker_gate_blocked",
        severity: "warning",
        summary: `${key} is held by a blocked security gate${via}. If its fix changes the code this item builds on, this run's suggestion may need regenerating.`,
        source: "kandryn",
        confidence: "high",
        evidence: { itemKeys: [key] },
      });
    } else if (state === "pr_open") {
      findings.push({
        id: makeFindingId("blocker_pr_unmerged", [key]),
        type: "blocker_pr_unmerged",
        severity: "caution",
        summary: `${key} has a Kandryn pull request that has not merged${via}. Until it does, its changes are not on the default branch this run generates from.`,
        source: "kandryn",
        confidence: "high",
        evidence: { itemKeys: [key] },
      });
    } else {
      findings.push({
        id: makeFindingId("unmet_blocker", [key]),
        type: "unmet_blocker",
        severity: "warning",
        summary: `${key} must finish first${via} and has not started. This run generates from the default branch, which does not contain its changes, so the suggestion cannot build on them.`,
        source: "tracker",
        confidence: "high",
        evidence: { itemKeys: [key] },
      });
    }
  }

  // --- children ------------------------------------------------------------
  const openChildren = siblings.filter((t) => t.parentId === item.id && t.status !== "done");
  if (openChildren.length > 0) {
    const keys = openChildren.map(itemLabel);
    findings.push({
      id: makeFindingId("children_incomplete", keys),
      type: "children_incomplete",
      severity: "caution",
      summary: `${keys.length} item${keys.length === 1 ? "" : "s"} under this one ${keys.length === 1 ? "is" : "are"} still open. Running the parent may duplicate work that belongs to ${keys.length === 1 ? "it" : "them"}.`,
      source: "tracker",
      confidence: "high",
      evidence: { itemKeys: keys },
    });
  }

  // --- file overlap --------------------------------------------------------
  const overlap = await detectFileOverlap(item, siblings);
  if (overlap) findings.push(overlap);

  // --- cycle ---------------------------------------------------------------
  const cycle = findCycleThrough(item.id, edges);
  if (cycle) {
    const keys = cycle.map((id) => (byId.get(id) ? itemLabel(byId.get(id)!) : `#${id}`));
    findings.push({
      id: makeFindingId("dependency_cycle", [...new Set(keys)]),
      type: "dependency_cycle",
      severity: "warning",
      summary: `These items block each other in a loop: ${keys.join(" → ")}. No order satisfies all of them, so one of these links is wrong.`,
      source: "tracker",
      confidence: "high",
      evidence: { itemKeys: [...new Set(keys)] },
    });
  }

  // --- rank ----------------------------------------------------------------
  const rankFinding = detectOutOfRank(item, siblings);
  if (rankFinding) findings.push(rankFinding);

  // --- order the remedy ----------------------------------------------------
  const suggestedFirst = orderPrerequisites(unsatisfied, edges).map((id) => {
    const blocker = byId.get(id)!;
    const state = states.get(id)!;
    return {
      itemKey: itemLabel(blocker),
      itemId: id,
      reason:
        state === "gate_blocked"
          ? "Security gate is blocking its pull request"
          : state === "pr_open"
            ? "Its pull request is open but not merged"
            : "Not started",
    };
  });

  return { item, project, policy, canOverride, findings, suggestedFirst };
}

/** Analyse and store the snapshot. What the explicit check endpoint calls, and
 *  what the UI needs because the impact request is keyed on the stored row. */
export async function analyzeWorkItem(workItemId: number, actor: SequenceActor): Promise<SequenceCheck> {
  return persistCheck(await computeCheck(workItemId, actor), actor);
}

// ---------------------------------------------------------------------------
// Prerequisite state
// ---------------------------------------------------------------------------

/**
 * Where each blocker stands.
 *
 * "Done" is read from the tracker rather than from the pull request, which is
 * a deliberate limit: Kandryn records `runs.pr_url` but never learns that a PR
 * merged — there is no webhook and no poll. So an item whose PR has merged but
 * whose ticket is still open reports as `pr_open`, a caution rather than a
 * warning, and the impact narrative is where a live PR lookup belongs.
 *
 * The gate is tested before the open PR because a gate-blocked item always has
 * a committed run with a PR: checking the PR first would quietly demote every
 * blocked security gate to a caution.
 */
async function classifyBlockers(
  blockerIds: readonly number[],
  byId: Map<number, TaskRow>,
): Promise<Map<number, BlockerState>> {
  const states = new Map<number, BlockerState>();
  if (blockerIds.length === 0) return states;

  const open: number[] = [];
  for (const id of blockerIds) {
    const t = byId.get(id);
    if (t && t.status === "done") states.set(id, "satisfied");
    else open.push(id);
  }
  if (open.length === 0) return states;

  // Newest first, so the first row seen per item is its latest committed run.
  const committed = await db
    .select({
      workItemId: runsTable.workItemId,
      prUrl: runsTable.prUrl,
      securityGate: runsTable.securityGate,
    })
    .from(runsTable)
    .where(and(inArray(runsTable.workItemId, open), isNotNull(runsTable.committedSuggestionId)))
    .orderBy(desc(runsTable.createdAt));

  const latest = new Map<number, (typeof committed)[number]>();
  for (const r of committed) if (!latest.has(r.workItemId)) latest.set(r.workItemId, r);

  for (const id of open) {
    const run = latest.get(id);
    if (run?.securityGate === "blocked") states.set(id, "gate_blocked");
    else if (run?.prUrl) states.set(id, "pr_open");
    else states.set(id, "not_started");
  }

  return states;
}

// ---------------------------------------------------------------------------
// File overlap
// ---------------------------------------------------------------------------

/**
 * Two changes heading for the same files.
 *
 * Both sides come from what Kandryn already stored — committed change sets and
 * written plans — so this costs a few indexed reads and no model call. The
 * repository tree is deliberately NOT fetched: that is a network round trip,
 * and this runs inside a 500 ms budget on every run request.
 *
 * Confidence reflects which side is a guess. Committed files on both sides is
 * fact; a planned file set on this side is a prediction, and the finding says
 * so rather than overstating itself.
 */
async function detectFileOverlap(item: TaskRow, siblings: readonly TaskRow[]): Promise<SequenceFinding | null> {
  const otherIds = siblings.filter((t) => t.id !== item.id).map((t) => t.id);
  if (otherIds.length === 0) return null;

  const mine = await pathsForItems([item.id]);
  const ours = mine.get(item.id);
  if (!ours || ours.paths.size === 0) return null;

  const theirs = await pathsForItems(otherIds);
  const byId = new Map(siblings.map((t) => [t.id, t]));

  const hitFiles = new Set<string>();
  const hitKeys = new Set<string>();
  let bothCommitted = false;

  for (const [otherId, other] of theirs) {
    const task = byId.get(otherId);
    // An item that is finished is not competing for the file any more.
    if (!task || task.status === "done") continue;
    const shared = [...other.paths].filter((p) => ours.paths.has(p));
    if (shared.length === 0) continue;
    for (const p of shared) hitFiles.add(p);
    hitKeys.add(itemLabel(task));
    if (other.committed && ours.committed) bothCommitted = true;
  }

  if (hitKeys.size === 0) return null;

  const files = [...hitFiles].sort();
  const keys = [...hitKeys].sort();
  return {
    id: makeFindingId("file_overlap", [...keys, ...files]),
    type: "file_overlap",
    severity: "warning",
    summary: `${keys.join(", ")} already ${keys.length === 1 ? "touches" : "touch"} ${files.length === 1 ? "this file" : `these ${files.length} files`}: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ", …" : ""}. Whichever change merges second will need its conflicts resolved by hand.`,
    source: "kandryn",
    confidence: bothCommitted ? "high" : "low",
    evidence: { itemKeys: keys, files },
  };
}

interface ItemPaths {
  paths: Set<string>;
  /** True when these are files actually committed, not a plan's prediction. */
  committed: boolean;
}

/**
 * The file paths each item is working on: its committed change set where one
 * exists, otherwise the file list from its most recent plan.
 *
 * Two queries for the whole set rather than per item — this is called with
 * every other item in the project.
 */
async function pathsForItems(itemIds: readonly number[]): Promise<Map<number, ItemPaths>> {
  const out = new Map<number, ItemPaths>();
  if (itemIds.length === 0) return out;

  const committedRows = await db
    .select({ workItemId: runsTable.workItemId, filePath: suggestionFilesTable.filePath })
    .from(runsTable)
    .innerJoin(suggestionFilesTable, eq(suggestionFilesTable.suggestionId, runsTable.committedSuggestionId))
    .where(and(inArray(runsTable.workItemId, itemIds), isNotNull(runsTable.committedSuggestionId)));

  for (const r of committedRows) {
    const entry = out.get(r.workItemId) ?? { paths: new Set<string>(), committed: true };
    entry.paths.add(r.filePath);
    out.set(r.workItemId, entry);
  }

  // Planned files, for items with no committed change set yet. A run that is
  // still pending counts: its plan says where it is heading.
  const planned = itemIds.filter((id) => !out.has(id));
  if (planned.length > 0) {
    const planRows = await db
      .select({ workItemId: runsTable.workItemId, filePath: changePlanFilesTable.filePath })
      .from(runsTable)
      .innerJoin(changePlansTable, eq(changePlansTable.runId, runsTable.id))
      .innerJoin(changePlanFilesTable, eq(changePlanFilesTable.planId, changePlansTable.id))
      .where(and(inArray(runsTable.workItemId, planned), eq(changePlansTable.superseded, false)));

    for (const r of planRows) {
      const entry = out.get(r.workItemId) ?? { paths: new Set<string>(), committed: false };
      entry.paths.add(r.filePath);
      out.set(r.workItemId, entry);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

/**
 * A much higher-ranked sibling is still open.
 *
 * Purely advisory, and silent wherever the tracker gave no rank — which today
 * means every Jira project, since Jira's rank is a LexoRank string on a
 * per-site custom field the sync does not request.
 */
function detectOutOfRank(item: TaskRow, siblings: readonly TaskRow[]): SequenceFinding | null {
  if (item.plmRank == null) return null;

  const ahead = siblings.filter(
    (t) =>
      t.id !== item.id &&
      t.status !== "done" &&
      t.plmRank != null &&
      t.parentId === item.parentId &&
      item.plmRank! - t.plmRank! >= RANK_GAP,
  );
  if (ahead.length === 0) return null;

  const keys = ahead
    .sort((a, b) => (a.plmRank ?? 0) - (b.plmRank ?? 0))
    .slice(0, 5)
    .map(itemLabel);
  return {
    id: makeFindingId("out_of_rank", keys),
    type: "out_of_rank",
    severity: "caution",
    summary: `${keys.join(", ")} ${keys.length === 1 ? "sits" : "sit"} well above this item in the backlog and ${keys.length === 1 ? "is" : "are"} still open.`,
    source: "tracker",
    confidence: "medium",
    evidence: { itemKeys: keys },
  };
}

// ---------------------------------------------------------------------------
// Policy + persistence
// ---------------------------------------------------------------------------

/** The project's team policy, or the default for a team-less project. */
export async function resolvePolicy(teamId: number | null): Promise<SequencePolicy> {
  if (teamId == null) return DEFAULT_SEQUENCE_POLICY;
  const [team] = await db
    .select({ policy: teamsTable.sequencePolicy })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));
  return team?.policy ?? DEFAULT_SEQUENCE_POLICY;
}

export async function persistCheck(computed: ComputedCheck, actor: SequenceActor): Promise<SequenceCheck> {
  const { item, project, policy, canOverride, findings, suggestedFirst } = computed;
  const verdict = verdictFrom(findings);
  const fingerprint = computeFingerprint(findings.map((f) => f.id));
  const expiresAt = new Date(Date.now() + SEQUENCE_CHECK_TTL_MINUTES * 60 * 1000);

  const [row] = await db
    .insert(sequenceChecksTable)
    .values({
      userId: actor.userId,
      teamId: project.teamId,
      workItemId: item.id,
      verdict,
      findings,
      facts: [],
      policySnapshot: { policy, canOverride, requiredByTeam: project.teamId },
      fingerprint,
      expiresAt,
    })
    .returning();

  if (verdict !== "clear") {
    audit.log({
      userId: actor.userId,
      teamId: project.teamId,
      action: "sequence.flagged",
      entityType: "work_item",
      entityId: item.id,
      metadata: {
        checkId: row.id,
        verdict,
        findingTypes: findings.map((f) => f.type),
        findingIds: findings.map((f) => f.id),
      },
    });
    logger.info({ workItemId: item.id, verdict, findings: findings.length }, "Run order flagged");
  }

  return {
    checkId: row.id,
    workItemId: item.id,
    itemKey: itemLabel(item),
    itemTitle: item.title,
    verdict,
    findings,
    suggestedFirst,
    policy,
    canOverride,
    expiresAt: expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Project order view
// ---------------------------------------------------------------------------

export interface RunOrderItem {
  itemId: number;
  itemKey: string;
  title: string;
  status: string;
  wave: number | null;
  /**
   * Keys of the items directly blocking this one that are not done yet. Lets
   * the board render a "Waits on PAY-A" chip from the call it already makes
   * for the order view, rather than a check per row.
   */
  waitsOn: string[];
}

/**
 * Every open item in the project grouped into execution waves. Wave 1 can all
 * start now; wave 2 waits on wave 1. Items in a dependency cycle get a null
 * wave, because no order satisfies them.
 */
export async function projectRunOrder(
  projectId: number,
  actor: SequenceActor,
): Promise<{ items: RunOrderItem[]; cycleCount: number }> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, actor.userId)));
  if (!project) throw new SequenceError("Project not found", 404);

  const open = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.projectId, projectId),
        eq(tasksTable.userId, actor.userId),
        ne(tasksTable.status, "done"),
      ),
    );

  const links = await db
    .select()
    .from(workItemLinksTable)
    .where(
      and(
        eq(workItemLinksTable.projectId, projectId),
        eq(workItemLinksTable.userId, actor.userId),
        eq(workItemLinksTable.linkType, "blocks"),
      ),
    );
  const edges: GraphEdge[] = links
    .filter((l) => l.dismissedAt == null)
    .map((l) => ({ from: l.fromItemId, to: l.toItemId }));

  const { waves, cyclic } = topologicalWaves(
    open.map((t) => t.id),
    edges,
  );
  const waveOf = new Map<number, number>();
  waves.forEach((w, i) => w.forEach((id) => waveOf.set(id, i + 1)));

  // Unmet direct blockers per item. Everything needed is already loaded, so
  // this is map lookups rather than another query.
  const openById = new Map(open.map((t) => [t.id, t]));
  const blockersOf = new Map<number, string[]>();
  for (const e of edges) {
    // A blocker missing from `open` is done, and therefore satisfied.
    const from = openById.get(e.from);
    if (!from) continue;
    const list = blockersOf.get(e.to);
    if (list) list.push(itemLabel(from));
    else blockersOf.set(e.to, [itemLabel(from)]);
  }

  return {
    items: open.map((t) => ({
      itemId: t.id,
      itemKey: itemLabel(t),
      title: t.title,
      status: t.status,
      wave: waveOf.get(t.id) ?? null,
      waitsOn: (blockersOf.get(t.id) ?? []).sort(),
    })),
    cycleCount: cyclic.length,
  };
}
