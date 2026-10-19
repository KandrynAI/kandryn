import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod/v4";
import { db, sequenceOverridesTable, sequenceChecksTable, teamsTable, auditLogTable } from "@workspace/db";
import { analyzeWorkItem, projectRunOrder, resolvePolicy } from "../services/sequenceService.js";
import { buildImpact } from "../services/sequenceImpactService.js";
import { requireAdmin } from "../middlewares/team.js";
import * as audit from "../services/auditService.js";

const router: IRouter = Router();

const IdParam = z.object({ id: z.coerce.number().int().positive() });
const CheckParams = z.object({
  id: z.coerce.number().int().positive(),
  checkId: z.coerce.number().int().positive(),
});

const actorOf = (req: { userId: string; teamId?: number | null; teamRole?: string | null }) => ({
  userId: req.userId,
  teamId: req.teamId ?? null,
  teamRole: req.teamRole ?? null,
});

// ---------------------------------------------------------------------------
// The check and its impact
// ---------------------------------------------------------------------------

router.post("/work-items/:id/sequence-check", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid work item id" });
    return;
  }
  res.json(await analyzeWorkItem(params.data.id, actorOf(req)));
});

router.post("/work-items/:id/sequence-check/:checkId/impact", async (req, res): Promise<void> => {
  const params = CheckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  // buildImpact scopes the check to the caller, so a checkId from another
  // account reads as not found rather than leaking that it exists.
  const [check] = await db
    .select({ workItemId: sequenceChecksTable.workItemId, expiresAt: sequenceChecksTable.expiresAt })
    .from(sequenceChecksTable)
    .where(and(eq(sequenceChecksTable.id, params.data.checkId), eq(sequenceChecksTable.userId, req.userId)));
  if (!check || check.workItemId !== params.data.id) {
    res.status(404).json({ error: "Sequence check not found" });
    return;
  }
  if (check.expiresAt.getTime() < Date.now()) {
    res.status(409).json({ error: "That run-order check has expired. Review the current one." });
    return;
  }
  res.json(await buildImpact(params.data.checkId, actorOf(req)));
});

/**
 * The trail for the paths that are NOT an override: the user took the advice,
 * or closed the dialog. Worth recording — "how often does the warning work"
 * is the question that says whether this feature earns its place.
 */
const EventBody = z.object({ event: z.enum(["heeded", "canceled"]) });

router.post("/work-items/:id/sequence-check/:checkId/event", async (req, res): Promise<void> => {
  const params = CheckParams.safeParse(req.params);
  const body = EventBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid submission" });
    return;
  }
  const [check] = await db
    .select({ id: sequenceChecksTable.id, verdict: sequenceChecksTable.verdict })
    .from(sequenceChecksTable)
    .where(and(eq(sequenceChecksTable.id, params.data.checkId), eq(sequenceChecksTable.userId, req.userId)));
  if (!check) {
    res.status(404).json({ error: "Sequence check not found" });
    return;
  }

  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: body.data.event === "heeded" ? "sequence.heeded" : "sequence.canceled",
    entityType: "work_item",
    entityId: params.data.id,
    metadata: { checkId: check.id, verdict: check.verdict },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// Project order view
// ---------------------------------------------------------------------------

router.get("/projects/:id/run-order", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  res.json(await projectRunOrder(params.data.id, actorOf(req)));
});

// ---------------------------------------------------------------------------
// Team policy
// ---------------------------------------------------------------------------

router.get("/team/sequence-policy", async (req, res): Promise<void> => {
  res.json({ policy: await resolvePolicy(req.teamId ?? null), isDefault: req.teamId == null });
});

const PolicyBody = z.object({ policy: z.enum(["off", "warn", "admin_override_only"]) });

router.put("/team/sequence-policy", requireAdmin, async (req, res): Promise<void> => {
  const body = PolicyBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Policy must be off, warn or admin_override_only." });
    return;
  }
  if (req.teamId == null) {
    res.status(422).json({ error: "You are not in a team, so there is no team policy to set." });
    return;
  }

  const from = await resolvePolicy(req.teamId);
  await db.update(teamsTable).set({ sequencePolicy: body.data.policy }).where(eq(teamsTable.id, req.teamId));

  audit.log({
    userId: req.userId,
    teamId: req.teamId,
    action: "sequence.policy_changed",
    entityType: "team",
    entityId: req.teamId,
    metadata: { from, to: body.data.policy },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.json({ policy: body.data.policy });
});

// ---------------------------------------------------------------------------
// Admin: the decision records
// ---------------------------------------------------------------------------

const ListQuery = z.object({
  days: z.coerce.number().int().positive().max(3650).optional(),
  userId: z.string().max(200).optional(),
  workItemKey: z.string().max(100).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/** Team-scoped: an admin reads their own team's decisions and no one else's. */
async function listOverrides(teamId: number, q: z.infer<typeof ListQuery>) {
  const since = new Date(Date.now() - (q.days ?? 90) * 24 * 3600 * 1000);
  const conds = [eq(sequenceOverridesTable.teamId, teamId), gte(sequenceOverridesTable.createdAt, since)];
  if (q.userId) conds.push(eq(sequenceOverridesTable.userId, q.userId));
  if (q.workItemKey) conds.push(eq(sequenceOverridesTable.workItemKey, q.workItemKey));
  if (q.before) conds.push(lt(sequenceOverridesTable.id, q.before));

  return db
    .select()
    .from(sequenceOverridesTable)
    .where(and(...conds))
    .orderBy(desc(sequenceOverridesTable.createdAt))
    .limit(q.limit ?? 50);
}

router.get("/sequence-overrides", requireAdmin, async (req, res): Promise<void> => {
  const q = ListQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  if (req.teamId == null) {
    res.json([]);
    return;
  }
  res.json(await listOverrides(req.teamId, q.data));
});

// Registered before the :id route so "export.csv" is not read as an id.
router.get("/sequence-overrides/export.csv", requireAdmin, async (req, res): Promise<void> => {
  const q = ListQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const rows = req.teamId == null ? [] : await listOverrides(req.teamId, { ...q.data, limit: 200 });

  const header = [
    "created_at", "user_id", "user_role", "work_item_key", "work_item_title", "verdict",
    "reason_category", "reason_text", "impact_source", "impact_model", "run_id",
    "scheduled_at", "ip_address", "record_hash", "findings",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.createdAt.toISOString(), r.userId, r.userRole, r.workItemKey, r.workItemTitle,
        r.verdictAtDecision, r.reasonCategory,
        // Never truncated: the justification is the record.
        r.reasonText ?? "", r.impactSource, r.impactModel ?? "", r.runId ?? "",
        r.scheduledAt?.toISOString() ?? "", r.ipAddress ?? "", r.recordHash,
        JSON.stringify(r.findingsAcknowledged),
      ].map(csvCell).join(","),
    ),
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="sequence-overrides.csv"');
  res.send(lines.join("\n"));
});

router.get("/sequence-overrides/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(sequenceOverridesTable)
    .where(
      and(
        eq(sequenceOverridesTable.id, params.data.id),
        eq(sequenceOverridesTable.teamId, req.teamId ?? -1),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Override not found" });
    return;
  }

  // The outcome events recorded against this run, so the detail view can
  // answer "did overriding actually cause trouble".
  const outcomes = row.runId
    ? await db
        .select()
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.entityId, row.runId),
            eq(auditLogTable.action, "sequence.override_outcome"),
          ),
        )
        .orderBy(desc(auditLogTable.createdAt))
    : [];
  res.json({ ...row, outcomes });
});

/**
 * A CSV cell. Quoted whenever it contains a delimiter, and a leading =, +, -
 * or @ is prefixed so a spreadsheet treats it as text rather than a formula —
 * reason_text is free text a user wrote, and this file is opened in Excel.
 */
function csvCell(value: unknown): string {
  const s = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export default router;
