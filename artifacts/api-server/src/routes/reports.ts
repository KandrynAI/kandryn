import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  runsTable,
  suggestionsTable,
  tasksTable,
  repositoriesTable,
  projectsTable,
  changePlansTable,
  auditLogTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { getTeamMembers } from "../services/teamService.js";

const router: IRouter = Router();

const ReportQuery = z.object({
  days: z.coerce.number().int().optional(),
  projectId: z.coerce.number().int().positive().optional(),
});

const ALLOWED_DAYS = [7, 30, 90];

// --- small date helpers (UTC, Monday-start weeks) --------------------------
function startOfWeek(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0=Sun..6=Sat
  x.setUTCDate(x.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return x;
}
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function shortLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function dayKey(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}
function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function agentDisplayName(agent: string): string {
  switch (agent) {
    case "claude":
      return "Claude";
    case "openai":
      return "OpenAI";
    case "copilot":
      return "Copilot";
    case "antigravity":
      return "Antigravity";
    default:
      return agent;
  }
}

/**
 * GET /reports/summary — KPIs + chart datasets for the reporting dashboard.
 * Team-aware: an admin sees every team member's runs/items; a member (or a user
 * with no team) sees only their own. Optional ?projectId scopes to one project;
 * ?days is one of 7 / 30 / 90 (default 30).
 */
router.get("/reports/summary", async (req, res): Promise<void> => {
  const parsed = ReportQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    return;
  }
  const days = ALLOWED_DAYS.includes(parsed.data.days ?? 30) ? (parsed.data.days ?? 30) : 30;
  const projectId = parsed.data.projectId;

  // --- scope --------------------------------------------------------------
  const isAdmin = req.teamId != null && req.teamRole === "admin";
  let userIds: string[];
  if (isAdmin && req.teamId != null) {
    const members = await getTeamMembers(req.teamId);
    userIds = members.map((m) => m.userId);
    if (!userIds.includes(req.userId)) userIds.push(req.userId);
  } else {
    userIds = [req.userId];
  }

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // --- fetch --------------------------------------------------------------
  const runConds = [inArray(runsTable.userId, userIds), gte(runsTable.createdAt, since)];
  if (projectId != null) runConds.push(eq(runsTable.projectId, projectId));
  const runs = await db
    .select()
    .from(runsTable)
    .where(and(...runConds))
    .orderBy(asc(runsTable.createdAt));

  const runIds = runs.map((r) => r.id);
  const suggestions = runIds.length
    ? await db.select().from(suggestionsTable).where(inArray(suggestionsTable.runId, runIds))
    : [];

  const taskConds = [inArray(tasksTable.userId, userIds)];
  if (projectId != null) taskConds.push(eq(tasksTable.projectId, projectId));
  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(...taskConds));

  // --- week / day buckets --------------------------------------------------
  const weeks: Date[] = [];
  {
    const end = startOfWeek(now);
    let w = startOfWeek(since);
    while (w.getTime() <= end.getTime()) {
      weeks.push(new Date(w));
      w = new Date(w);
      w.setUTCDate(w.getUTCDate() + 7);
    }
  }
  const weekIndex = new Map(weeks.map((d, i) => [d.getTime(), i]));
  const weekBucket = (d: Date): number => weekIndex.get(startOfWeek(d).getTime()) ?? -1;

  const dayList: string[] = [];
  {
    const end = startOfDay(now);
    let d = startOfDay(since);
    while (d.getTime() <= end.getTime()) {
      dayList.push(dayKey(d));
      d = new Date(d);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }

  // --- run volume by week --------------------------------------------------
  const runVolume = new Array(weeks.length).fill(0);
  for (const r of runs) {
    const i = weekBucket(r.createdAt);
    if (i >= 0) runVolume[i]++;
  }

  // --- outcomes ------------------------------------------------------------
  const statusOrder = ["succeeded", "failed", "canceled", "running", "queued", "scheduled"];
  const statusCounts = new Map<string, number>();
  for (const r of runs) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  const outcomeLabels = statusOrder.filter((s) => statusCounts.has(s));
  const outcomes = {
    labels: outcomeLabels,
    data: outcomeLabels.map((s) => statusCounts.get(s) ?? 0),
  };

  // --- time-to-PR daily average (hours) -----------------------------------
  const ttpSum = new Map<string, number>();
  const ttpCount = new Map<string, number>();
  for (const r of runs) {
    if (r.prUrl && r.startedAt && r.finishedAt) {
      const key = dayKey(r.finishedAt);
      const hrs = (r.finishedAt.getTime() - r.startedAt.getTime()) / 3_600_000;
      ttpSum.set(key, (ttpSum.get(key) ?? 0) + hrs);
      ttpCount.set(key, (ttpCount.get(key) ?? 0) + 1);
    }
  }
  const timeToPrDaily = {
    labels: dayList.map((k) => shortLabel(new Date(k + "T00:00:00Z"))),
    data: dayList.map((k) => {
      const c = ttpCount.get(k);
      return c ? round((ttpSum.get(k) ?? 0) / c, 2) : null;
    }),
  };

  // --- agent win rate (committed suggestions by agent) --------------------
  const committedIds = new Set(
    runs.map((r) => r.committedSuggestionId).filter((id): id is number => id != null),
  );
  const agentWins = new Map<string, number>();
  const runCreatedById = new Map(runs.map((r) => [r.id, r.createdAt]));
  for (const s of suggestions) {
    if (committedIds.has(s.id)) agentWins.set(s.agent, (agentWins.get(s.agent) ?? 0) + 1);
  }
  const agentKeys = [...agentWins.keys()];
  const agentWinRate = {
    labels: agentKeys.map(agentDisplayName),
    data: agentKeys.map((a) => agentWins.get(a) ?? 0),
  };

  // --- synthesis score trend (avg suggestion score by week) ---------------
  const scoreSum = new Array(weeks.length).fill(0);
  const scoreCnt = new Array(weeks.length).fill(0);
  for (const s of suggestions) {
    if (s.score == null) continue;
    const created = runCreatedById.get(s.runId) ?? s.createdAt;
    const i = weekBucket(created);
    if (i >= 0) {
      scoreSum[i] += s.score;
      scoreCnt[i]++;
    }
  }
  const scoreTrend = {
    labels: weeks.map(shortLabel),
    data: weeks.map((_, i) => (scoreCnt[i] ? round(scoreSum[i] / scoreCnt[i], 1) : null)),
  };

  // --- security findings by OWASP category (stacked by severity) ----------
  const owaspSev = new Map<string, { critical: number; high: number; medium: number; low: number }>();
  let securityFindingsTotal = 0;
  for (const r of runs) {
    const scan = r.securityScan;
    if (!scan?.findings) continue;
    for (const f of scan.findings) {
      securityFindingsTotal++;
      const cat = f.owasp || "Other";
      const b = owaspSev.get(cat) ?? { critical: 0, high: 0, medium: 0, low: 0 };
      if (f.severity === "critical") b.critical++;
      else if (f.severity === "high") b.high++;
      else if (f.severity === "medium") b.medium++;
      else if (f.severity === "low") b.low++;
      owaspSev.set(cat, b);
    }
  }
  const owaspCats = [...owaspSev.keys()];
  const securityByOwasp = {
    labels: owaspCats,
    datasets: [
      { label: "Critical", data: owaspCats.map((c) => owaspSev.get(c)!.critical) },
      { label: "High", data: owaspCats.map((c) => owaspSev.get(c)!.high) },
      { label: "Medium", data: owaspCats.map((c) => owaspSev.get(c)!.medium) },
      { label: "Low", data: owaspCats.map((c) => owaspSev.get(c)!.low) },
    ],
  };

  // --- work items by type --------------------------------------------------
  const typeOrder = ["epic", "story", "task", "bug", "test_case"];
  const typeCounts = new Map<string, number>();
  for (const t of tasks) typeCounts.set(t.itemType, (typeCounts.get(t.itemType) ?? 0) + 1);
  const typeLabels = typeOrder.filter((t) => typeCounts.has(t));
  const workItemsByType = {
    labels: typeLabels,
    data: typeLabels.map((t) => typeCounts.get(t) ?? 0),
  };

  // --- backlog burn (created vs completed by week) ------------------------
  const created = new Array(weeks.length).fill(0);
  const completed = new Array(weeks.length).fill(0);
  for (const t of tasks) {
    const ci = weekBucket(t.createdAt);
    if (ci >= 0) created[ci]++;
    if (t.status === "done") {
      const ui = weekBucket(t.updatedAt);
      if (ui >= 0) completed[ui]++;
    }
  }
  const backlogBurn = { labels: weeks.map(shortLabel), created, completed };

  // --- KPIs ---------------------------------------------------------------
  const totalRuns = runs.length;
  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const prsOpened = runs.filter((r) => r.prUrl != null).length;
  const committedRuns = runs.filter((r) => r.committedSuggestionId != null).length;
  const ttpAll: number[] = [];
  for (const r of runs) {
    if (r.prUrl && r.startedAt && r.finishedAt) {
      ttpAll.push((r.finishedAt.getTime() - r.startedAt.getTime()) / 3_600_000);
    }
  }
  const avgTimeToPrHours = ttpAll.length
    ? round(ttpAll.reduce((a, b) => a + b, 0) / ttpAll.length, 1)
    : null;

  res.json({
    range: { days, since: since.toISOString(), until: now.toISOString() },
    scope: isAdmin ? "team" : "personal",
    kpis: {
      totalRuns,
      successRate: totalRuns ? Math.round((succeeded / totalRuns) * 100) : 0,
      prsOpened,
      committedRuns,
      avgTimeToPrHours,
      securityFindings: securityFindingsTotal,
    },
    charts: {
      runVolumeByWeek: { labels: weeks.map(shortLabel), data: runVolume },
      outcomes,
      timeToPrDaily,
      agentWinRate,
      scoreTrend,
      securityByOwasp,
      workItemsByType,
      backlogBurn,
    },
  });
});

// ─── Admin diagnostics (Reporting Phase A) ──────────────────────────────────
// Operational-health panels for team admins. Every endpoint below is admin-only
// and team-scoped: it reads across every team member's runs/repositories (the
// same member-userIds scope as /reports/summary), never a single user. An
// optional `scope` narrows to one project; `days` (7/30/90) bounds the
// time-windowed panels. Read-only — no migration, reuses existing columns and
// the `aegis.scan_run` audit action.

const AdminQuery = z.object({
  days: z.coerce.number().int().optional(),
  scope: z.coerce.number().int().positive().optional(),
});

/** Resolve the admin guard + team member ids + optional project scope. Returns
 *  null (after writing the 403) when the caller is not a team admin. */
async function resolveAdminScope(
  req: Request,
  res: Response,
): Promise<{ userIds: string[]; projectId?: number; days: number } | null> {
  if (!req.teamId || req.teamRole !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return null;
  }
  const parsed = AdminQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    return null;
  }
  const members = await getTeamMembers(req.teamId);
  const userIds = members.map((m) => m.userId);
  if (!userIds.includes(req.userId)) userIds.push(req.userId);
  const days = ALLOWED_DAYS.includes(parsed.data.days ?? 30) ? (parsed.data.days ?? 30) : 30;
  return { userIds, projectId: parsed.data.scope, days };
}

/**
 * GET /reports/admin/parked-runs — runs parked by the confidence gate
 * (status='awaiting_review'), oldest first. Not time-bounded: a park waits
 * indefinitely, and an old one is the most urgent, so `days` is deliberately
 * ignored here. This panel carries the real action (approve/reject the plan).
 */
router.get("/reports/admin/parked-runs", async (req, res): Promise<void> => {
  const scope = await resolveAdminScope(req, res);
  if (!scope) return;

  const conds = [inArray(runsTable.userId, scope.userIds), eq(runsTable.status, "awaiting_review")];
  if (scope.projectId != null) conds.push(eq(runsTable.projectId, scope.projectId));

  const rows = await db
    .select({
      runId: runsTable.id,
      projectId: runsTable.projectId,
      projectName: projectsTable.name,
      workItemTitle: tasksTable.title,
      externalId: tasksTable.externalId,
      itemType: tasksTable.itemType,
      plmUrl: tasksTable.plmUrl,
      trigger: runsTable.trigger,
      triggerContext: runsTable.triggerContext,
      createdAt: runsTable.createdAt,
    })
    .from(runsTable)
    .leftJoin(projectsTable, eq(runsTable.projectId, projectsTable.id))
    .leftJoin(tasksTable, eq(runsTable.workItemId, tasksTable.id))
    .where(and(...conds))
    .orderBy(asc(runsTable.createdAt));

  res.json({ items: rows });
});

/**
 * GET /reports/admin/repo-health — per-repository operational health: graph
 * freshness (built <24h ago and status='succeeded'), reconfiguration/
 * verification flags, and the last completed Aegis scan. Not time-bounded.
 */
router.get("/reports/admin/repo-health", async (req, res): Promise<void> => {
  const scope = await resolveAdminScope(req, res);
  if (!scope) return;

  const repoConds = [inArray(repositoriesTable.userId, scope.userIds)];
  if (scope.projectId != null) repoConds.push(eq(repositoriesTable.projectId, scope.projectId));

  const repos = await db
    .select({
      repositoryId: repositoriesTable.id,
      name: repositoriesTable.name,
      provider: repositoriesTable.provider,
      projectId: repositoriesTable.projectId,
      projectName: projectsTable.name,
      graphStatus: repositoriesTable.graphStatus,
      graphBuiltAt: repositoriesTable.graphBuiltAt,
      graphNodeCount: repositoriesTable.graphNodeCount,
      needsReconfiguration: repositoriesTable.needsReconfiguration,
      needsVerification: repositoriesTable.needsVerification,
    })
    .from(repositoriesTable)
    .leftJoin(projectsTable, eq(repositoriesTable.projectId, projectsTable.id))
    .where(and(...repoConds))
    .orderBy(asc(repositoriesTable.name));

  // Last completed Aegis scan per repo — one query, reduced in JS.
  const repoIds = repos.map((r) => r.repositoryId);
  const lastScanByRepo = new Map<number, Date>();
  if (repoIds.length) {
    const scanned = await db
      .select({ repositoryId: runsTable.repositoryId, finishedAt: runsTable.finishedAt, createdAt: runsTable.createdAt })
      .from(runsTable)
      .where(and(inArray(runsTable.repositoryId, repoIds), eq(runsTable.securityScanStatus, "done")));
    for (const s of scanned) {
      if (s.repositoryId == null) continue;
      const at = s.finishedAt ?? s.createdAt;
      const prev = lastScanByRepo.get(s.repositoryId);
      if (!prev || at.getTime() > prev.getTime()) lastScanByRepo.set(s.repositoryId, at);
    }
  }

  const now = Date.now();
  const items = repos.map((r) => {
    const ageHours = r.graphBuiltAt ? (now - r.graphBuiltAt.getTime()) / 3_600_000 : null;
    const graphFresh = r.graphStatus === "succeeded" && ageHours != null && ageHours < 24;
    const lastAegisScanAt = lastScanByRepo.get(r.repositoryId) ?? null;
    return {
      ...r,
      graphAgeHours: ageHours != null ? Math.round(ageHours * 10) / 10 : null,
      graphFresh,
      lastAegisScanAt: lastAegisScanAt ? lastAegisScanAt.toISOString() : null,
    };
  });

  res.json({ items });
});

/**
 * GET /reports/admin/aegis-failures — Aegis gate blocks in the window, from the
 * `aegis.scan_run` audit trail (metadata.gateDecision='blocked'). The audit log
 * is the source of truth: it records every scan event and its coverage, so a
 * fail-closed block (unscanned files) is auditable after the fact. Bounded by
 * `days`; older rows may be pruned by the team's audit retention window.
 */
router.get("/reports/admin/aegis-failures", async (req, res): Promise<void> => {
  const scope = await resolveAdminScope(req, res);
  if (!scope) return;
  const teamId = req.teamId!;
  const since = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.teamId, teamId),
        eq(auditLogTable.action, "aegis.scan_run"),
        gte(auditLogTable.createdAt, since),
      ),
    )
    .orderBy(desc(auditLogTable.createdAt))
    .limit(200);

  const blocked = rows.filter(
    (r) => (r.metadata as { gateDecision?: string } | null)?.gateDecision === "blocked",
  );

  // Resolve run → project (name + scope filter) for the blocked events.
  const runIds = [...new Set(blocked.map((r) => r.entityId).filter((id): id is number => id != null))];
  const runMeta = new Map<number, { projectId: number; projectName: string | null }>();
  if (runIds.length) {
    const runRows = await db
      .select({ id: runsTable.id, projectId: runsTable.projectId, projectName: projectsTable.name })
      .from(runsTable)
      .leftJoin(projectsTable, eq(runsTable.projectId, projectsTable.id))
      .where(inArray(runsTable.id, runIds));
    for (const r of runRows) runMeta.set(r.id, { projectId: r.projectId, projectName: r.projectName });
  }

  const items = blocked
    .map((r) => {
      const meta = (r.metadata ?? {}) as {
        criticalCount?: number;
        highCount?: number;
        filesScanned?: number;
        filesTotal?: number;
        unscannedFiles?: string[];
      };
      const run = r.entityId != null ? runMeta.get(r.entityId) : undefined;
      return {
        runId: r.entityId,
        projectId: run?.projectId ?? null,
        projectName: run?.projectName ?? null,
        criticalCount: meta.criticalCount ?? 0,
        highCount: meta.highCount ?? 0,
        filesScanned: meta.filesScanned ?? null,
        filesTotal: meta.filesTotal ?? null,
        unscannedFiles: meta.unscannedFiles ?? [],
        createdAt: r.createdAt.toISOString(),
      };
    })
    .filter((it) => scope.projectId == null || it.projectId === scope.projectId);

  res.json({ items });
});

/**
 * GET /reports/admin/failed-by-stage — a derived breakdown of where runs fell
 * over in the window. The pipeline has no single "stage" column, so each bucket
 * is heuristically derived from the durable rows. Buckets are distinct signals
 * and may overlap only where noted:
 *   • planning         — a run whose change_plan ended status='failed'
 *   • commit           — a status='failed' run with an error that ISN'T a
 *                        planning failure (failed during generation/commit)
 *   • coherenceExcluded — runs with ≥1 suggestion whose coherence gate failed
 *   • aegisBlocked     — runs whose security gate blocked
 * planning ∪ commit partition the hard failures; the latter two are quality
 * gates, not necessarily failures.
 */
router.get("/reports/admin/failed-by-stage", async (req, res): Promise<void> => {
  const scope = await resolveAdminScope(req, res);
  if (!scope) return;
  const since = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);

  const runConds = [inArray(runsTable.userId, scope.userIds), gte(runsTable.createdAt, since)];
  if (scope.projectId != null) runConds.push(eq(runsTable.projectId, scope.projectId));
  const runs = await db
    .select({
      id: runsTable.id,
      status: runsTable.status,
      error: runsTable.error,
      securityGate: runsTable.securityGate,
    })
    .from(runsTable)
    .where(and(...runConds));

  const runIds = runs.map((r) => r.id);
  const sample = (ids: number[]) => ids.slice(0, 20);

  // planning: runs with a failed change_plan.
  let planningIds: number[] = [];
  if (runIds.length) {
    const failedPlans = await db
      .selectDistinct({ runId: changePlansTable.runId })
      .from(changePlansTable)
      .where(and(inArray(changePlansTable.runId, runIds), eq(changePlansTable.status, "failed")));
    planningIds = failedPlans.map((p) => p.runId);
  }
  const planningSet = new Set(planningIds);

  // commit: hard-failed runs with an error that aren't planning failures.
  const commitIds = runs
    .filter((r) => r.status === "failed" && r.error != null && !planningSet.has(r.id))
    .map((r) => r.id);

  // coherenceExcluded: distinct runs with a failed coherence gate.
  let coherenceIds: number[] = [];
  if (runIds.length) {
    const failedCoh = await db
      .selectDistinct({ runId: suggestionsTable.runId })
      .from(suggestionsTable)
      .where(and(inArray(suggestionsTable.runId, runIds), eq(suggestionsTable.coherenceStatus, "failed")));
    coherenceIds = failedCoh.map((s) => s.runId);
  }

  // aegisBlocked: runs whose security gate blocked.
  const aegisIds = runs.filter((r) => r.securityGate === "blocked").map((r) => r.id);

  res.json({
    days: scope.days,
    totalRuns: runs.length,
    stages: {
      planning: { count: planningIds.length, runIds: sample(planningIds) },
      commit: { count: commitIds.length, runIds: sample(commitIds) },
      coherenceExcluded: { count: coherenceIds.length, runIds: sample(coherenceIds) },
      aegisBlocked: { count: aegisIds.length, runIds: sample(aegisIds) },
    },
  });
});

export default router;
