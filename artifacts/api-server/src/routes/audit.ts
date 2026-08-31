import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import * as audit from "../services/auditService.js";
import { AUDIT_ACTIONS } from "../../../../shared/types/auditLog.js";

// Mounted after requireAuth + attachTeam (routes/index.ts), so req.userId,
// req.teamId and req.teamRole are populated. Audit visibility is admin-only.
const router: IRouter = Router();

const ListQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  action: z.string().optional(),
  userId: z.string().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// GET /api/audit — paginated audit log (admin only).
router.get("/audit", async (req, res): Promise<void> => {
  if (!req.teamId) {
    res.status(403).json({ error: "Team required." });
    return;
  }
  if (req.teamRole !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    return;
  }
  const query = parsed.data;

  const rows = await audit.queryLog({
    teamId: req.teamId,
    days: query.days,
    action: query.action,
    userId: query.userId,
    before: query.before ? new Date(query.before) : undefined,
    limit: query.limit,
  });

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;

  res.json({
    items,
    hasMore,
    nextBefore: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
  });
});

// GET /api/audit/export.csv — full CSV download (admin only).
router.get("/audit/export.csv", async (req, res): Promise<void> => {
  if (!req.teamId || req.teamRole !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const parsed = z
    .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
    .safeParse(req.query);
  const days = parsed.success ? parsed.data.days : 30;

  const csv = await audit.exportCsv(req.teamId, days);

  const filename = `kandryn-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

// GET /api/audit/actions — list of valid action strings (for the filter UI).
router.get("/audit/actions", (_req, res): void => {
  res.json({ actions: AUDIT_ACTIONS });
});

// GET /api/audit/verify — verify the team's tamper-evident hash chain (admin
// only, governance item 7). Reports the first broken row, if any.
router.get("/audit/verify", async (req, res): Promise<void> => {
  if (!req.teamId || req.teamRole !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const result = await audit.verifyChain(req.teamId);
  res.json({ ...result, checkedAt: new Date().toISOString() });
});

export default router;
