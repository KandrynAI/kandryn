import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  changePlansTable,
  db,
  projectsTable,
  runsTable,
  tasksTable,
  teamMembersTable,
} from "@workspace/db";
import { analyzeWorkItem } from "../sequenceService.js";
import { logger } from "../../lib/logger.js";

/**
 * What the Jira panel is allowed to know about one issue (0043, phase 1).
 *
 * Two rules govern this file.
 *
 * ACCESS. Everything is read AS THE LINKED KANDRYN USER, under the same
 * predicate the rest of the app uses (owner, or a member of the team that owns
 * a team-visible project). "Not found" and "not allowed" return the identical
 * shape, because telling a Jira user that an issue exists in a project they
 * cannot open is itself a leak.
 *
 * SHAPE. Only the fields in the contract leave this file. No run logs, no
 * diffs, no prompts, no context pack, no document names, no secrets — a panel
 * is a summary, and anything more is surface area on somebody else's page.
 */

export interface IssueViewReady {
  state: "ready";
  workItem: { id: number; title: string; status: string };
  confidence: { score: number; label: string } | null;
  order: {
    status: "ok" | "warning" | "unknown";
    blockers: Array<{ key: string; title: string; state: string }>;
    moreCount: number;
  };
  latestRun: { id: number; status: string; startedAt: string | null; prUrl: string | null } | null;
  links: { openInKandryn: string };
  degraded?: string[];
}

export type IssueView =
  | { state: "not_linked" }
  | { state: "not_in_kandryn"; projectHint: null }
  | IssueViewReady;

const MAX_BLOCKERS = 5;

/**
 * The work item for a Jira site + key, among the projects this user may see.
 *
 * The site is matched on the host inside `tasks.plm_url`, which sync writes as
 * `<domain>/browse/<KEY>`. That is the only site identifier Kandryn stores —
 * there is no cloud id column — and using it keeps this feature away from the
 * PLM credentials in `integration_configs`, which it must not touch.
 *
 * Matching is by KEY, because `tasks.external_id` holds the Jira key and the
 * numeric issue id is not stored. Known consequence: moving an issue between
 * Jira projects changes its key, and the panel will show "not imported" until
 * the next sync re-keys the row.
 */
async function findWorkItem(
  userId: string,
  teamId: number | null,
  siteUrl: string,
  key: string,
): Promise<{ id: number; title: string; status: string; projectId: number } | null> {
  const rows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      projectId: tasksTable.projectId,
      plmUrl: tasksTable.plmUrl,
    })
    .from(tasksTable)
    .innerJoin(projectsTable, eq(projectsTable.id, tasksTable.projectId))
    .leftJoin(
      teamMembersTable,
      and(eq(teamMembersTable.teamId, projectsTable.teamId), eq(teamMembersTable.userId, userId)),
    )
    .where(
      and(
        eq(tasksTable.externalId, key),
        eq(projectsTable.plmProvider, "jira"),
        // The same access rule the Knowledge routes apply: the owner, or a
        // member of the team that owns a team-visible project.
        or(
          eq(projectsTable.userId, userId),
          and(eq(projectsTable.visibility, "team"), eq(teamMembersTable.userId, userId)),
        ),
      ),
    );

  // The site comparison happens here rather than in SQL: plm_url is a full
  // browse URL, and parsing a host in Postgres would be fragile where a tiny
  // loop over at most a handful of same-key rows is not.
  const host = siteUrl.replace(/^https?:\/\//i, "").toLowerCase();
  for (const row of rows) {
    if (!row.plmUrl) continue;
    try {
      if (new URL(row.plmUrl).hostname.toLowerCase() === host && row.projectId != null) {
        return { id: row.id, title: row.title, status: row.status, projectId: row.projectId };
      }
    } catch {
      // A malformed stored URL is not a match, and not an error either.
    }
  }
  return null;
}

/** The confidence of the newest plan for this work item's newest run. */
async function latestConfidence(workItemId: number, userId: string): Promise<{ score: number; label: string } | null> {
  const [row] = await db
    .select({ score: changePlansTable.confidenceScore })
    .from(changePlansTable)
    .innerJoin(runsTable, eq(runsTable.id, changePlansTable.runId))
    .where(and(eq(runsTable.workItemId, workItemId), eq(runsTable.userId, userId), eq(changePlansTable.superseded, false)))
    .orderBy(desc(changePlansTable.id))
    .limit(1);
  if (row?.score == null) return null;
  const score = Number(row.score);
  if (!Number.isFinite(score)) return null;
  // The label is the panel's word for the number, not a new judgement: the
  // confidence gate's own threshold decides, and it lives on the project.
  return { score, label: score >= 0.6 ? "ok" : "low" };
}

async function latestRun(workItemId: number, userId: string): Promise<IssueViewReady["latestRun"]> {
  const [row] = await db
    .select({
      id: runsTable.id,
      status: runsTable.status,
      startedAt: runsTable.startedAt,
      prUrl: runsTable.prUrl,
    })
    .from(runsTable)
    .where(and(eq(runsTable.workItemId, workItemId), eq(runsTable.userId, userId)))
    .orderBy(desc(runsTable.id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    prUrl: row.prUrl ?? null,
  };
}

/**
 * Run order, from Sequence Guard's own analysis.
 *
 * `analyzeWorkItem` is called unchanged, with the linked user as the actor —
 * its `SequenceActor` is a plain object, so nothing about it assumes a
 * request. A failure here degrades the one section rather than the response.
 */
async function runOrder(
  workItemId: number,
  projectId: number,
  actor: { userId: string; teamId: number | null; teamRole: string | null },
): Promise<{ order: IssueViewReady["order"]; failed: boolean }> {
  try {
    const check = await analyzeWorkItem(workItemId, actor);
    // Only warnings are "run after this" — a caution is advisory and would
    // make the panel cry wolf.
    const warnings = (check.findings ?? []).filter((f) => f.severity === "warning");

    // The blocker keys live on each finding's evidence; the titles do not, so
    // they are read from the same project's tasks. Scoped to the project that
    // was already access-checked, so this adds no reach.
    const keys: string[] = [];
    const stateByKey = new Map<string, string>();
    for (const f of warnings) {
      for (const k of f.evidence.itemKeys ?? []) {
        if (!stateByKey.has(k)) {
          stateByKey.set(k, f.type);
          keys.push(k);
        }
      }
    }

    const shown = keys.slice(0, MAX_BLOCKERS);
    const titles = new Map<string, string>();
    if (shown.length > 0) {
      const rows = await db
        .select({ externalId: tasksTable.externalId, title: tasksTable.title })
        .from(tasksTable)
        .where(and(eq(tasksTable.projectId, projectId), inArray(tasksTable.externalId, shown)));
      for (const r of rows) if (r.externalId) titles.set(r.externalId, r.title);
    }

    return {
      order: {
        status: warnings.length > 0 ? "warning" : "ok",
        blockers: shown.map((k) => ({ key: k, title: titles.get(k) ?? "", state: stateByKey.get(k) ?? "unmet_blocker" })),
        moreCount: Math.max(0, keys.length - shown.length),
      },
      failed: false,
    };
  } catch (err) {
    logger.warn({ err, workItemId }, "Jira panel: run-order check failed");
    return { order: { status: "unknown", blockers: [], moreCount: 0 }, failed: true };
  }
}

/**
 * Assemble the panel's view. Never throws for a partial failure: a section
 * that cannot be read is reported in `degraded` with the rest intact, because
 * a 500 in a Jira sidebar reads as "Kandryn is broken".
 */
export async function buildIssueView(input: {
  userId: string;
  siteUrl: string;
  key: string;
  appBaseUrl: string;
}): Promise<IssueView> {
  const { userId, siteUrl, key, appBaseUrl } = input;

  const [membership] = await db
    .select({ teamId: teamMembersTable.teamId, role: teamMembersTable.role })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId));
  const teamId = membership?.teamId ?? null;
  const teamRole = membership?.role ?? null;

  const item = await findWorkItem(userId, teamId, siteUrl, key);
  if (!item) return { state: "not_in_kandryn", projectHint: null };

  const degraded: string[] = [];
  const [confidence, run, order] = await Promise.all([
    latestConfidence(item.id, userId).catch((err) => {
      logger.warn({ err }, "Jira panel: confidence read failed");
      degraded.push("confidence");
      return null;
    }),
    latestRun(item.id, userId).catch((err) => {
      logger.warn({ err }, "Jira panel: latest run read failed");
      degraded.push("latestRun");
      return null;
    }),
    runOrder(item.id, item.projectId, { userId, teamId, teamRole }),
  ]);
  if (order.failed) degraded.push("order");

  return {
    state: "ready",
    workItem: { id: item.id, title: item.title, status: item.status },
    confidence,
    order: order.order,
    latestRun: run,
    links: { openInKandryn: `${appBaseUrl.replace(/\/$/, "")}/p/${item.projectId}/board` },
    ...(degraded.length > 0 ? { degraded } : {}),
  };
}
