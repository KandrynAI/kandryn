import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, inArray, isNotNull, like } from "drizzle-orm";
import {
  db,
  runsTable,
  suggestionsTable,
  suggestionFilesTable,
  tasksTable,
  repositoriesTable,
  projectsTable,
  changePlansTable,
  changePlanFilesTable,
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

// ─── Manager panels (Reporting Phase B) ─────────────────────────────────────
// Delivery-quality panels that extend the /reports analytics view. Team-AWARE
// (not admin-gated, matching /reports/summary): an admin sees every team
// member's data, a member sees only their own. Optional `projectId` scopes to
// one project; `days` (7/30/90) bounds the window. Read-only, no migration.

/** Resolve the team-aware scope (admin → all member ids, else own) + window.
 *  Non-gated — everyone with a report view gets a scope. Null after a 400. */
async function resolveReportScope(
  req: Request,
  res: Response,
): Promise<{ userIds: string[]; projectId?: number; days: number } | null> {
  const parsed = ReportQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    return null;
  }
  const isAdmin = req.teamId != null && req.teamRole === "admin";
  let userIds: string[];
  if (isAdmin && req.teamId != null) {
    const members = await getTeamMembers(req.teamId);
    userIds = members.map((m) => m.userId);
    if (!userIds.includes(req.userId)) userIds.push(req.userId);
  } else {
    userIds = [req.userId];
  }
  const days = ALLOWED_DAYS.includes(parsed.data.days ?? 30) ? (parsed.data.days ?? 30) : 30;
  return { userIds, projectId: parsed.data.projectId, days };
}

// Runs still mid-flight — their plan decision (accept/edit/reject) isn't made.
const IN_FLIGHT_RUN = new Set(["scheduled", "queued", "running", "awaiting_review"]);

/** Outcome of a run that produced a usable plan: accepted as-is (still rev 1),
 *  edited (a revision > 1 exists), rejected (canceled), or pending (in-flight).
 *  Shared by plan-acceptance and the confidence below-threshold breakdown. */
function classifyOutcome(status: string, maxRevision: number): "accepted" | "edited" | "rejected" | "pending" {
  if (IN_FLIGHT_RUN.has(status)) return "pending";
  if (maxRevision > 1) return "edited";
  if (status === "canceled") return "rejected";
  return "accepted";
}

/**
 * GET /reports/retrieval-attribution — how well retrieval served the planner, in
 * scope/window. Two views over `change_plan_files.in_candidates`:
 *   • planner — over every planned file, was the path in the candidate set?
 *     `false` = the planner planned a file retrieval never surfaced (a retrieval
 *     miss). This has data on real runs even before anyone hand-edits a plan.
 *   • manual — over files a user added by hand (`added_by_user = true`): in
 *     candidates = "retrieval found it, planner chose badly" (prompt problem);
 *     not in candidates = "retrieval never found it" (retrieval problem). Plus
 *     the top hand-added paths with one example run each. Empty until users edit
 *     plans.
 */
router.get("/reports/retrieval-attribution", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const since = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);

  const runConds = [inArray(runsTable.userId, scope.userIds), gte(runsTable.createdAt, since)];
  if (scope.projectId != null) runConds.push(eq(runsTable.projectId, scope.projectId));

  const rows = await db
    .select({
      addedByUser: changePlanFilesTable.addedByUser,
      filePath: changePlanFilesTable.filePath,
      inCandidates: changePlanFilesTable.inCandidates,
      runId: changePlansTable.runId,
    })
    .from(changePlanFilesTable)
    .innerJoin(changePlansTable, eq(changePlanFilesTable.planId, changePlansTable.id))
    .innerJoin(runsTable, eq(changePlansTable.runId, runsTable.id))
    .where(and(...runConds));

  // Planner coverage (all planned files) — how much of what the planner planned
  // retrieval actually surfaced.
  let plannerInCandidates = 0;
  let plannerMissed = 0;
  // Manual adds (added_by_user = true).
  let found = 0; // in_candidates = true  → planner chose badly
  let missed = 0; // in_candidates = false → retrieval miss
  const byPath = new Map<string, { count: number; exampleRunId: number }>();

  for (const r of rows) {
    if (r.addedByUser) {
      if (r.inCandidates === true) found++;
      else if (r.inCandidates === false) missed++;
      const prev = byPath.get(r.filePath);
      if (prev) prev.count++;
      else byPath.set(r.filePath, { count: 1, exampleRunId: r.runId });
    } else {
      if (r.inCandidates === true) plannerInCandidates++;
      else if (r.inCandidates === false) plannerMissed++;
    }
  }

  const topPaths = [...byPath.entries()]
    .map(([filePath, v]) => ({ filePath, count: v.count, exampleRunId: v.exampleRunId }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const plannerTotal = plannerInCandidates + plannerMissed;
  res.json({
    planner: {
      inCandidates: plannerInCandidates,
      missed: plannerMissed,
      coverageRate: plannerTotal ? Math.round((plannerInCandidates / plannerTotal) * 100) : null,
    },
    manual: { found, missed, topPaths },
  });
});

/**
 * GET /reports/plan-acceptance — the headline "how often is the first plan good
 * enough to run as-is" number. Over runs that produced a usable plan and reached
 * a terminal state, the share accepted without edits (current plan still
 * revision 1, run not rejected). Editing supersedes revision 1 (a revision > 1
 * exists); rejecting cancels the run. Returns the rate, the component counts, a
 * trend vs. the prior equivalent window, and a weekly sparkline.
 */
router.get("/reports/plan-acceptance", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const now = Date.now();
  const windowMs = scope.days * 24 * 60 * 60 * 1000;
  const since = new Date(now - windowMs);
  const priorSince = new Date(now - 2 * windowMs);

  // Pull runs over the current + prior window in one query, then split by time.
  const runConds = [inArray(runsTable.userId, scope.userIds), gte(runsTable.createdAt, priorSince)];
  if (scope.projectId != null) runConds.push(eq(runsTable.projectId, scope.projectId));
  const runs = await db
    .select({ id: runsTable.id, status: runsTable.status, createdAt: runsTable.createdAt })
    .from(runsTable)
    .where(and(...runConds));

  const runIds = runs.map((r) => r.id);
  const plans = runIds.length
    ? await db
        .select({ runId: changePlansTable.runId, revision: changePlansTable.revision, status: changePlansTable.status })
        .from(changePlansTable)
        .where(inArray(changePlansTable.runId, runIds))
    : [];

  // Per-run plan facts.
  const planByRun = new Map<number, { hasUsable: boolean; maxRevision: number }>();
  for (const p of plans) {
    const e = planByRun.get(p.runId) ?? { hasUsable: false, maxRevision: 0 };
    if (p.status !== "failed" && p.status !== "planning") e.hasUsable = true;
    if (p.revision > e.maxRevision) e.maxRevision = p.revision;
    planByRun.set(p.runId, e);
  }

  // Classify one run: null = not eligible (no usable plan / still in-flight).
  function classify(run: { status: string }, runId: number): "accepted" | "edited" | "rejected" | null {
    const pf = planByRun.get(runId);
    if (!pf?.hasUsable) return null; // planning failed or never produced a plan
    const o = classifyOutcome(run.status, pf.maxRevision);
    return o === "pending" ? null : o; // in-flight decision not made yet
  }

  function rateOver(rs: typeof runs): { rate: number | null; accepted: number; edited: number; rejected: number; total: number } {
    let accepted = 0, edited = 0, rejected = 0;
    for (const r of rs) {
      const c = classify(r, r.id);
      if (c === "accepted") accepted++;
      else if (c === "edited") edited++;
      else if (c === "rejected") rejected++;
    }
    const total = accepted + edited + rejected;
    return { rate: total ? Math.round((accepted / total) * 100) : null, accepted, edited, rejected, total };
  }

  const current = runs.filter((r) => r.createdAt >= since);
  const prior = runs.filter((r) => r.createdAt < since);
  const cur = rateOver(current);
  const pri = rateOver(prior);

  // Weekly sparkline of the acceptance rate across the current window. Weeks
  // with no eligible runs are skipped, not zero-filled — a quiet week is a data
  // gap, not a 0% acceptance rate.
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const buckets = Math.max(1, Math.ceil(windowMs / weekMs));
  const spark: number[] = [];
  for (let i = buckets - 1; i >= 0; i--) {
    const hi = now - i * weekMs;
    const lo = hi - weekMs;
    const slice = current.filter((r) => r.createdAt.getTime() >= lo && r.createdAt.getTime() < hi);
    const { rate } = rateOver(slice);
    if (rate != null) spark.push(rate);
  }

  res.json({
    rate: cur.rate,
    accepted: cur.accepted,
    edited: cur.edited,
    rejected: cur.rejected,
    total: cur.total,
    priorRate: pri.rate,
    delta: cur.rate != null && pri.rate != null ? cur.rate - pri.rate : null,
    sparkline: spark,
  });
});

/**
 * GET /reports/coherence — coherence pass rate, scoped to C# suggestions. The
 * Phase 3 checker is deliberately C#-only, and it returns 'passed' for
 * unsupported languages (an auto-pass), so a suggestion is only counted here if
 * its change set touches a `.cs` file. Share of those with status='passed', over
 * ones with a non-null status (pre-Phase-3 suggestions are null → excluded, not
 * counted as failures). With a trend vs. the prior window.
 */
router.get("/reports/coherence", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const now = Date.now();
  const windowMs = scope.days * 24 * 60 * 60 * 1000;
  const since = new Date(now - windowMs);

  const conds = [
    isNotNull(suggestionsTable.coherenceStatus),
    like(suggestionFilesTable.filePath, "%.cs"),
    inArray(runsTable.userId, scope.userIds),
    gte(runsTable.createdAt, new Date(now - 2 * windowMs)),
  ];
  if (scope.projectId != null) conds.push(eq(runsTable.projectId, scope.projectId));

  // Distinct so a suggestion touching several .cs files counts once.
  const rows = await db
    .selectDistinct({
      id: suggestionsTable.id,
      status: suggestionsTable.coherenceStatus,
      createdAt: runsTable.createdAt,
    })
    .from(suggestionsTable)
    .innerJoin(suggestionFilesTable, eq(suggestionFilesTable.suggestionId, suggestionsTable.id))
    .innerJoin(runsTable, eq(suggestionsTable.runId, runsTable.id))
    .where(and(...conds));

  function tally(rs: typeof rows) {
    let passed = 0, warnings = 0, failed = 0;
    for (const r of rs) {
      if (r.status === "passed") passed++;
      else if (r.status === "warnings") warnings++;
      else if (r.status === "failed") failed++;
    }
    const total = passed + warnings + failed;
    return { passed, warnings, failed, total, rate: total ? Math.round((passed / total) * 100) : null };
  }

  const cur = tally(rows.filter((r) => r.createdAt >= since));
  const pri = tally(rows.filter((r) => r.createdAt < since));

  res.json({
    ...cur,
    priorRate: pri.rate,
    delta: cur.rate != null && pri.rate != null ? cur.rate - pri.rate : null,
  });
});

/**
 * GET /reports/confidence-distribution — histogram of the Phase 4 confidence
 * score over ready plans (revision 1; the score is not recomputed on revisions).
 * The threshold marker is single-project only — under "All projects" there is no
 * one threshold, so it's null and the client hides the line. Below-threshold
 * plans are broken down by their run's outcome (each compared to ITS project's
 * threshold, so "All projects" stays correct with mixed thresholds).
 */
router.get("/reports/confidence-distribution", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const since = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);

  const conds = [
    isNotNull(changePlansTable.confidenceScore),
    inArray(runsTable.userId, scope.userIds),
    gte(runsTable.createdAt, since),
  ];
  if (scope.projectId != null) conds.push(eq(runsTable.projectId, scope.projectId));

  const planRows = await db
    .select({
      runId: changePlansTable.runId,
      score: changePlansTable.confidenceScore,
      projectId: runsTable.projectId,
      runStatus: runsTable.status,
    })
    .from(changePlansTable)
    .innerJoin(runsTable, eq(changePlansTable.runId, runsTable.id))
    .where(and(...conds));

  // maxRevision per run (to tell edited from accepted-as-is).
  const runIds = [...new Set(planRows.map((p) => p.runId))];
  const maxRev = new Map<number, number>();
  if (runIds.length) {
    const allPlans = await db
      .select({ runId: changePlansTable.runId, revision: changePlansTable.revision })
      .from(changePlansTable)
      .where(inArray(changePlansTable.runId, runIds));
    for (const p of allPlans) maxRev.set(p.runId, Math.max(maxRev.get(p.runId) ?? 0, p.revision));
  }

  // Per-project thresholds (include the scoped project so its marker resolves
  // even when it has no plans in-window).
  const projectIds = [...new Set(planRows.map((p) => p.projectId))];
  if (scope.projectId != null && !projectIds.includes(scope.projectId)) projectIds.push(scope.projectId);
  const thresholdByProject = new Map<number, number>();
  if (projectIds.length) {
    const projRows = await db
      .select({ id: projectsTable.id, threshold: projectsTable.confidenceThreshold })
      .from(projectsTable)
      .where(inArray(projectsTable.id, projectIds));
    for (const p of projRows) thresholdByProject.set(p.id, Number(p.threshold));
  }

  const NB = 10;
  const hist = new Array(NB).fill(0);
  let approved = 0, edited = 0, rejected = 0, pending = 0;
  let total = 0;
  for (const p of planRows) {
    const s = Number(p.score);
    if (!Number.isFinite(s)) continue;
    total++;
    hist[Math.min(NB - 1, Math.max(0, Math.floor(s * NB)))]++;
    const th = thresholdByProject.get(p.projectId) ?? 0.6;
    if (s < th) {
      const o = classifyOutcome(p.runStatus, maxRev.get(p.runId) ?? 1);
      if (o === "accepted") approved++;
      else if (o === "edited") edited++;
      else if (o === "rejected") rejected++;
      else pending++;
    }
  }

  const histogram = hist.map((count, i) => ({ lo: i / NB, hi: (i + 1) / NB, count }));
  const threshold = scope.projectId != null ? (thresholdByProject.get(scope.projectId) ?? 0.6) : null;

  res.json({ histogram, threshold, total, belowThreshold: { approved, edited, rejected, pending } });
});

/**
 * GET /reports/agent-win — Raptia vs. Fovea. DB agents (claude/antigravity →
 * Raptia, openai/copilot → Fovea) mapped to display names. Recommended rate =
 * share of runs where each agent's suggestion was picked; plus the average of
 * each Synthesia dimension's per-suggestion score. Dimension names/weights are
 * fixed on the client to match Synthesia exactly.
 */
router.get("/reports/agent-win", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const since = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);

  const conds = [
    isNotNull(suggestionsTable.scoreBreakdown),
    inArray(runsTable.userId, scope.userIds),
    gte(runsTable.createdAt, since),
  ];
  if (scope.projectId != null) conds.push(eq(runsTable.projectId, scope.projectId));

  const rows = await db
    .select({
      agent: suggestionsTable.agent,
      recommendation: suggestionsTable.recommendation,
      scoreBreakdown: suggestionsTable.scoreBreakdown,
      runId: suggestionsTable.runId,
    })
    .from(suggestionsTable)
    .innerJoin(runsTable, eq(suggestionsTable.runId, runsTable.id))
    .where(and(...conds));

  const DIMS = ["correctness", "coherence", "conventions", "acCoverage", "readability", "minimalDiff"] as const;
  const displayName = (a: string): "Raptia" | "Fovea" => (a === "claude" || a === "antigravity" ? "Raptia" : "Fovea");

  type Acc = { runIds: Set<number>; recRunIds: Set<number>; dimSum: Record<string, number>; dimCount: Record<string, number> };
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const name = displayName(r.agent);
    const e = acc.get(name) ?? { runIds: new Set(), recRunIds: new Set(), dimSum: {}, dimCount: {} };
    e.runIds.add(r.runId);
    if (r.recommendation === "Recommended") e.recRunIds.add(r.runId);
    const sb = r.scoreBreakdown as Record<string, { score?: number } | undefined> | null;
    if (sb) {
      for (const d of DIMS) {
        const v = sb[d]?.score;
        if (v != null) {
          e.dimSum[d] = (e.dimSum[d] ?? 0) + v;
          e.dimCount[d] = (e.dimCount[d] ?? 0) + 1;
        }
      }
    }
    acc.set(name, e);
  }

  const agents = (["Raptia", "Fovea"] as const).map((name) => {
    const e = acc.get(name);
    const dimensions: Record<string, number | null> = {};
    for (const d of DIMS) dimensions[d] = e?.dimCount[d] ? Math.round(e.dimSum[d] / e.dimCount[d]) : null;
    return {
      name,
      runs: e ? e.runIds.size : 0,
      recommendedRate: e && e.runIds.size ? Math.round((e.recRunIds.size / e.runIds.size) * 100) : null,
      dimensions,
    };
  });

  res.json({ agents });
});

// --- shared helpers for the throughput/latency/cost/security panels ---------
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Rolling 7-day buckets covering `days`, oldest→newest, each with ms bounds and
 *  a short label at the bucket start. Used for the trend series. */
function weekBuckets(now: number, days: number): { lo: number; hi: number; label: string }[] {
  const n = Math.max(1, Math.ceil(days / 7));
  const out: { lo: number; hi: number; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const hi = now - i * WEEK_MS;
    const lo = hi - WEEK_MS;
    out.push({ lo, hi, label: shortLabel(new Date(lo)) });
  }
  return out;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Planning-stage token pricing (Sonnet 4.5 published rates, USD per 1M tokens).
// Estimate only — generation-stage tokens (Raptia/Fovea/Veria/Aegis/Narratia)
// are not instrumented, so this covers the planning call alone.
const PLAN_INPUT_USD_PER_M = 3;
const PLAN_OUTPUT_USD_PER_M = 15;
const planCostUsd = (input: number, output: number): number =>
  (input / 1_000_000) * PLAN_INPUT_USD_PER_M + (output / 1_000_000) * PLAN_OUTPUT_USD_PER_M;

/**
 * GET /reports/throughput — run volume this window, split manual vs. scheduled
 * trigger, with a trend vs. the prior equivalent window.
 */
router.get("/reports/throughput", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const now = Date.now();
  const windowMs = scope.days * 24 * 60 * 60 * 1000;
  const since = new Date(now - windowMs);
  const priorSince = new Date(now - 2 * windowMs);

  const conds = [inArray(runsTable.userId, scope.userIds), gte(runsTable.createdAt, priorSince)];
  if (scope.projectId != null) conds.push(eq(runsTable.projectId, scope.projectId));
  const runs = await db
    .select({ trigger: runsTable.trigger, createdAt: runsTable.createdAt })
    .from(runsTable)
    .where(and(...conds));

  const cur = runs.filter((r) => r.createdAt >= since);
  const prior = runs.filter((r) => r.createdAt < since);
  const manual = cur.filter((r) => r.trigger === "manual").length;
  const scheduled = cur.filter((r) => r.trigger === "scheduled").length;

  res.json({
    total: cur.length,
    manual,
    scheduled,
    priorTotal: prior.length,
    delta: cur.length - prior.length,
  });
});

/**
 * GET /reports/time-to-pr — median hours from run start to finish for runs that
 * opened a PR, with a weekly trend and a prior-window comparison. A week with no
 * PR-opening runs is null in the trend (a gap, not a 0). Phase-2 "multi-file
 * generation began here" annotation is deferred until there's enough pre/post
 * data for a clean before/after — noted as a follow-up.
 */
router.get("/reports/time-to-pr", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const now = Date.now();
  const windowMs = scope.days * 24 * 60 * 60 * 1000;
  const since = new Date(now - windowMs);
  const priorSince = new Date(now - 2 * windowMs);

  const conds = [
    inArray(runsTable.userId, scope.userIds),
    gte(runsTable.createdAt, priorSince),
    isNotNull(runsTable.prUrl),
    isNotNull(runsTable.startedAt),
    isNotNull(runsTable.finishedAt),
  ];
  if (scope.projectId != null) conds.push(eq(runsTable.projectId, scope.projectId));
  const runs = await db
    .select({ startedAt: runsTable.startedAt, finishedAt: runsTable.finishedAt, createdAt: runsTable.createdAt })
    .from(runsTable)
    .where(and(...conds));

  const hoursOf = (r: (typeof runs)[number]): number =>
    (r.finishedAt!.getTime() - r.startedAt!.getTime()) / 3_600_000;

  const cur = runs.filter((r) => r.createdAt >= since);
  const prior = runs.filter((r) => r.createdAt < since);
  const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

  const trend = weekBuckets(now, scope.days).map((b) => {
    const slice = cur.filter((r) => r.createdAt.getTime() >= b.lo && r.createdAt.getTime() < b.hi);
    return { label: b.label, median: slice.length ? round1(median(slice.map(hoursOf))) : null };
  });

  const curMed = round1(median(cur.map(hoursOf)));
  const priMed = round1(median(prior.map(hoursOf)));
  res.json({
    medianHours: curMed,
    priorMedianHours: priMed,
    delta: curMed != null && priMed != null ? Math.round((curMed - priMed) * 10) / 10 : null,
    runsWithPr: cur.length,
    trend,
  });
});

/**
 * GET /reports/planning-cost — estimated PLANNING-STAGE cost per run, from
 * change_plans token counts (revision 1). Generation-stage tokens aren't
 * instrumented, so this is the planning call only — the client labels it as such.
 * Weekly trend + prior-window comparison; empty weeks are null (a gap, not $0).
 */
router.get("/reports/planning-cost", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const now = Date.now();
  const windowMs = scope.days * 24 * 60 * 60 * 1000;
  const since = new Date(now - windowMs);
  const priorSince = new Date(now - 2 * windowMs);

  const conds = [
    eq(changePlansTable.revision, 1),
    isNotNull(changePlansTable.inputTokens),
    inArray(runsTable.userId, scope.userIds),
    gte(runsTable.createdAt, priorSince),
  ];
  if (scope.projectId != null) conds.push(eq(runsTable.projectId, scope.projectId));
  const plans = await db
    .select({
      input: changePlansTable.inputTokens,
      output: changePlansTable.outputTokens,
      createdAt: runsTable.createdAt,
    })
    .from(changePlansTable)
    .innerJoin(runsTable, eq(changePlansTable.runId, runsTable.id))
    .where(and(...conds));

  const costOf = (p: (typeof plans)[number]): number => planCostUsd(p.input ?? 0, p.output ?? 0);
  const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const round4 = (n: number | null) => (n == null ? null : Math.round(n * 10000) / 10000);

  const cur = plans.filter((p) => p.createdAt >= since);
  const prior = plans.filter((p) => p.createdAt < since);

  const trend = weekBuckets(now, scope.days).map((b) => {
    const slice = cur.filter((p) => p.createdAt.getTime() >= b.lo && p.createdAt.getTime() < b.hi);
    return { label: b.label, cost: slice.length ? round4(avg(slice.map(costOf))) : null };
  });

  const curAvg = round4(avg(cur.map(costOf)));
  const priAvg = round4(avg(prior.map(costOf)));
  res.json({
    avgCostUsd: curAvg,
    priorAvgCostUsd: priAvg,
    delta: curAvg != null && priAvg != null ? round4(curAvg - priAvg) : null,
    avgInputTokens: cur.length ? Math.round(avg(cur.map((p) => p.input ?? 0))!) : null,
    avgOutputTokens: cur.length ? Math.round(avg(cur.map((p) => p.output ?? 0))!) : null,
    runsWithTokens: cur.length,
    trend,
  });
});

/**
 * GET /reports/security-posture — Aegis findings by severity over the window,
 * plus the count of gate-blocked runs, plus a weekly findings trend. A week with
 * no scanned runs is null in the trend (a gap); a scanned week with no findings
 * is 0 (a real clean week).
 */
router.get("/reports/security-posture", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const now = Date.now();
  const since = new Date(now - scope.days * 24 * 60 * 60 * 1000);

  const conds = [
    isNotNull(runsTable.securityScan),
    inArray(runsTable.userId, scope.userIds),
    gte(runsTable.createdAt, since),
  ];
  if (scope.projectId != null) conds.push(eq(runsTable.projectId, scope.projectId));
  const runs = await db
    .select({ securityScan: runsTable.securityScan, securityGate: runsTable.securityGate, createdAt: runsTable.createdAt })
    .from(runsTable)
    .where(and(...conds));

  const severities = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let gateBlocked = 0;
  const findingsAt: { at: number; n: number }[] = [];
  for (const r of runs) {
    if (r.securityGate === "blocked") gateBlocked++;
    const findings = r.securityScan?.findings ?? [];
    findingsAt.push({ at: r.createdAt.getTime(), n: findings.length });
    for (const f of findings) {
      if (f.severity in severities) severities[f.severity as keyof typeof severities]++;
    }
  }
  const total = severities.critical + severities.high + severities.medium + severities.low + severities.info;

  const trend = weekBuckets(now, scope.days).map((b) => {
    const slice = findingsAt.filter((f) => f.at >= b.lo && f.at < b.hi);
    return { label: b.label, count: slice.length ? slice.reduce((a, f) => a + f.n, 0) : null };
  });

  res.json({ severities, gateBlocked, total, scannedRuns: runs.length, trend });
});

/**
 * GET /reports/executive — the six aggregate numbers for the Executive tier.
 * Admin-only (same gate as the Admin diagnostics), team-scoped, defaulting to
 * every project; an optional `scope` narrows to one. Range is month-to-date;
 * deltas compare against last month at the SAME elapsed time into the month
 * (lastMonthStart + (now - thisMonthStart)) so a mid-month read is fair. Each
 * number rolls up a metric Phase B already computes — no new data shapes.
 */
router.get("/reports/executive", async (req, res): Promise<void> => {
  const scope = await resolveAdminScope(req, res); // admin-gated; `days` unused here
  if (!scope) return;

  const now = new Date();
  const nowMs = now.getTime();
  const thisMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const lastMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const priorEnd = lastMonthStart + (nowMs - thisMonthStart); // equal elapsed time
  const fetchSince = new Date(Math.min(lastMonthStart, nowMs - 12 * WEEK_MS));

  const runConds = [inArray(runsTable.userId, scope.userIds), gte(runsTable.createdAt, fetchSince)];
  if (scope.projectId != null) runConds.push(eq(runsTable.projectId, scope.projectId));
  const runs = await db
    .select({
      id: runsTable.id,
      projectId: runsTable.projectId,
      status: runsTable.status,
      committedSuggestionId: runsTable.committedSuggestionId,
      securityGate: runsTable.securityGate,
      securityScan: runsTable.securityScan,
      createdAt: runsTable.createdAt,
    })
    .from(runsTable)
    .where(and(...runConds));

  const runIds = runs.map((r) => r.id);
  const plans = runIds.length
    ? await db
        .select({
          runId: changePlansTable.runId,
          revision: changePlansTable.revision,
          status: changePlansTable.status,
          input: changePlansTable.inputTokens,
          output: changePlansTable.outputTokens,
        })
        .from(changePlansTable)
        .where(inArray(changePlansTable.runId, runIds))
    : [];
  const planByRun = new Map<number, { hasUsable: boolean; maxRevision: number; rev1Input: number | null; rev1Output: number | null }>();
  for (const p of plans) {
    const e = planByRun.get(p.runId) ?? { hasUsable: false, maxRevision: 0, rev1Input: null, rev1Output: null };
    if (p.status !== "failed" && p.status !== "planning") e.hasUsable = true;
    if (p.revision > e.maxRevision) e.maxRevision = p.revision;
    if (p.revision === 1 && p.input != null) {
      e.rev1Input = p.input;
      e.rev1Output = p.output ?? 0;
    }
    planByRun.set(p.runId, e);
  }

  type R = (typeof runs)[number];
  const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

  const activeProjects = (rs: R[]): number => new Set(rs.map((r) => r.projectId)).size;
  const deliveryRate = (rs: R[]): number | null => {
    const terminal = rs.filter((r) => TERMINAL.has(r.status));
    if (!terminal.length) return null;
    return Math.round((terminal.filter((r) => r.committedSuggestionId != null).length / terminal.length) * 100);
  };
  const findingsBlocked = (rs: R[]): number =>
    rs.reduce((n, r) => (r.securityGate === "blocked" ? n + (r.securityScan?.criticalCount ?? 0) + (r.securityScan?.highCount ?? 0) : n), 0);
  const costPerRun = (rs: R[]): number | null => {
    const costs = rs
      .map((r) => planByRun.get(r.id))
      .filter((p): p is NonNullable<typeof p> => p?.rev1Input != null)
      .map((p) => planCostUsd(p.rev1Input!, p.rev1Output ?? 0));
    return costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10000) / 10000 : null;
  };
  const planAcceptance = (rs: R[]): number | null => {
    let acc = 0, tot = 0;
    for (const r of rs) {
      const pf = planByRun.get(r.id);
      if (!pf?.hasUsable) continue;
      const o = classifyOutcome(r.status, pf.maxRevision);
      if (o === "pending") continue;
      tot++;
      if (o === "accepted") acc++;
    }
    return tot ? Math.round((acc / tot) * 100) : null;
  };

  const cur = runs.filter((r) => r.createdAt.getTime() >= thisMonthStart && r.createdAt.getTime() <= nowMs);
  const pri = runs.filter((r) => r.createdAt.getTime() >= lastMonthStart && r.createdAt.getTime() < priorEnd);
  const ptsDelta = (a: number | null, b: number | null): number | null => (a != null && b != null ? a - b : null);

  // 12-week plan-acceptance trend — non-empty weeks only (a quiet week is a gap,
  // not a 0%). Range label reads first → last so it's legible without hovering.
  const trendPoints: number[] = [];
  for (const b of weekBuckets(nowMs, 84)) {
    const slice = runs.filter((r) => r.createdAt.getTime() >= b.lo && r.createdAt.getTime() < b.hi);
    const rate = planAcceptance(slice);
    if (rate != null) trendPoints.push(rate);
  }

  const apCur = activeProjects(cur), apPri = activeProjects(pri);
  const drCur = deliveryRate(cur), drPri = deliveryRate(pri);
  const fbCur = findingsBlocked(cur), fbPri = findingsBlocked(pri);
  const cprCur = costPerRun(cur), cprPri = costPerRun(pri);

  res.json({
    activeProjects: { value: apCur, delta: apCur - apPri },
    runs: { value: cur.length, delta: cur.length - pri.length },
    deliveryRate: { value: drCur, delta: ptsDelta(drCur, drPri) },
    findingsBlocked: { value: fbCur, delta: fbCur - fbPri },
    costPerRun: { valueUsd: cprCur, delta: cprCur != null && cprPri != null ? Math.round((cprCur - cprPri) * 10000) / 10000 : null },
    planAcceptanceTrend: {
      current: planAcceptance(cur),
      points: trendPoints,
      first: trendPoints[0] ?? null,
      last: trendPoints[trendPoints.length - 1] ?? null,
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

/**
 * GET /reports/admin/config-audit — structural configuration drift across the
 * team's repos + projects. Not time-bounded (a stale config is stale now
 * regardless of when it drifted). Stale graphs come from graph_status='stale'
 * (set on a repo URL change), NOT a graph_built_at/updated_at comparison — there
 * is no updated_at column, and staleness is an explicit lifecycle state. Credential
 * expiry is a known gap (not tracked) and is surfaced as a static note client-side.
 */
router.get("/reports/admin/config-audit", async (req, res): Promise<void> => {
  const scope = await resolveAdminScope(req, res);
  if (!scope) return;

  const repoConds = [inArray(repositoriesTable.userId, scope.userIds)];
  if (scope.projectId != null) repoConds.push(eq(repositoriesTable.projectId, scope.projectId));
  const repos = await db
    .select({
      repositoryId: repositoriesTable.id,
      name: repositoriesTable.name,
      projectId: repositoriesTable.projectId,
      projectName: projectsTable.name,
      graphStatus: repositoriesTable.graphStatus,
      needsVerification: repositoriesTable.needsVerification,
      needsReconfiguration: repositoriesTable.needsReconfiguration,
    })
    .from(repositoriesTable)
    .leftJoin(projectsTable, eq(repositoriesTable.projectId, projectsTable.id))
    .where(and(...repoConds));

  const projConds = [inArray(projectsTable.userId, scope.userIds)];
  if (scope.projectId != null) projConds.push(eq(projectsTable.id, scope.projectId));
  const projects = await db
    .select({ projectId: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(and(...projConds));

  const boundProjectIds = new Set(
    repos.map((r) => r.projectId).filter((id): id is number => id != null),
  );
  const trim = (r: (typeof repos)[number]) => ({
    repositoryId: r.repositoryId,
    name: r.name,
    projectId: r.projectId,
    projectName: r.projectName,
  });

  res.json({
    staleGraphs: repos.filter((r) => r.graphStatus === "stale").map(trim),
    unverifiedRepos: repos.filter((r) => r.needsVerification).map(trim),
    needsReconfigRepos: repos.filter((r) => r.needsReconfiguration).map(trim),
    projectsWithoutRepo: projects.filter((p) => !boundProjectIds.has(p.projectId)),
  });
});

// Curated slice of audit actions for the Access & Change panel: who can do what
// (membership/role/team) and the governance-sensitive changes (confidence
// threshold edits, coherence-gate overrides, team credentials). Everything else
// stays in the full Settings → Audit log, which this panel links out to.
const ACCESS_CHANGE_ACTIONS = [
  "member.invited",
  "member.joined",
  "member.removed",
  "member.role_changed",
  "invite.canceled",
  "team.updated",
  "project.updated",
  "run.override_committed",
  "team_credential.set",
  "team_credential.deleted",
];

/**
 * GET /reports/admin/access-changes — recent access + governance events from the
 * audit log, team-scoped and bounded by `days`. Not project-scoped (these are
 * team-level). Raw rows; the client renders labels/metadata (reusing the audit
 * log's presentation vocabulary).
 */
router.get("/reports/admin/access-changes", async (req, res): Promise<void> => {
  const scope = await resolveAdminScope(req, res);
  if (!scope) return;
  const teamId = req.teamId!;
  const since = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: auditLogTable.id,
      userId: auditLogTable.userId,
      action: auditLogTable.action,
      entityType: auditLogTable.entityType,
      entityId: auditLogTable.entityId,
      metadata: auditLogTable.metadata,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.teamId, teamId),
        gte(auditLogTable.createdAt, since),
        inArray(auditLogTable.action, ACCESS_CHANGE_ACTIONS),
      ),
    )
    .orderBy(desc(auditLogTable.createdAt))
    .limit(40);

  res.json({ items: rows });
});

export default router;
