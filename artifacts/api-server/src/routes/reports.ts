import { Router, type IRouter } from "express";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db, runsTable, suggestionsTable, tasksTable } from "@workspace/db";
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

export default router;
