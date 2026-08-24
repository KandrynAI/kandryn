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
 * GET /reports/retrieval-attribution — for every plan file a user added by hand
 * (`added_by_user = true`) in scope/window, split by whether the path was in the
 * planner's candidate set: `in_candidates = true` means retrieval surfaced it but
 * the planner didn't pick it (a prompt problem); `false` means retrieval never
 * found it (a retrieval problem). Plus the top manually-added paths with one
 * example run each for drill-in.
 */
router.get("/reports/retrieval-attribution", async (req, res): Promise<void> => {
  const scope = await resolveReportScope(req, res);
  if (!scope) return;
  const since = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);

  const runConds = [
    eq(changePlanFilesTable.addedByUser, true),
    inArray(runsTable.userId, scope.userIds),
    gte(runsTable.createdAt, since),
  ];
  if (scope.projectId != null) runConds.push(eq(runsTable.projectId, scope.projectId));

  const rows = await db
    .select({
      filePath: changePlanFilesTable.filePath,
      inCandidates: changePlanFilesTable.inCandidates,
      runId: changePlansTable.runId,
    })
    .from(changePlanFilesTable)
    .innerJoin(changePlansTable, eq(changePlanFilesTable.planId, changePlansTable.id))
    .innerJoin(runsTable, eq(changePlansTable.runId, runsTable.id))
    .where(and(...runConds));

  let found = 0; // in_candidates = true  → planner miss
  let missed = 0; // in_candidates = false → retrieval miss
  const byPath = new Map<string, { count: number; exampleRunId: number }>();
  for (const r of rows) {
    if (r.inCandidates === true) found++;
    else if (r.inCandidates === false) missed++;
    const prev = byPath.get(r.filePath);
    if (prev) prev.count++;
    else byPath.set(r.filePath, { count: 1, exampleRunId: r.runId });
  }
  const topPaths = [...byPath.entries()]
    .map(([filePath, v]) => ({ filePath, count: v.count, exampleRunId: v.exampleRunId }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json({ found, missed, topPaths });
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
