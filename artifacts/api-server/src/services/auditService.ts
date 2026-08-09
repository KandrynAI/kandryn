import type { Request } from "express";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { db, auditLogTable, teamsTable } from "@workspace/db";
import type { AuditAction } from "../../../../shared/types/auditLog.js";
import { AUDIT_RETENTION_DAYS } from "../../../../shared/types/auditLog.js";
import { logger } from "../lib/logger.js";

interface LogParams {
  userId: string;
  teamId?: number | null;
  action: AuditAction;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// ── Core logging function ─────────────────────────────────────────
// ALWAYS call this fire-and-forget. Never await at the call site.
//   Wrong:  await audit.log({...})
//   Right:  audit.log({...})   // no await
export function log(params: LogParams): void {
  // Insert async but never block or fail the caller.
  db.insert(auditLogTable)
    .values({
      teamId: params.teamId ?? null,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      metadata: params.metadata ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    })
    .catch((err) => {
      // Audit failures must never crash or slow requests.
      logger.warn({ err, action: params.action }, "Audit log insert failed");
    });
}

// ── Extract the client IP from an Express request ─────────────────
export function getIp(req: Request): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : xff?.split(",")[0];
  return first?.trim() || req.socket?.remoteAddress || undefined;
}

// ── Query audit log (admin only) ──────────────────────────────────
interface QueryParams {
  teamId: number;
  days?: number; // default 30
  action?: string;
  userId?: string; // filter to one member
  before?: Date; // cursor for pagination
  limit?: number; // default 50, max 200
}

export async function queryLog(params: QueryParams): Promise<AuditLogRecordRow[]> {
  const { teamId, days = 30, action, userId, before, limit = 50 } = params;

  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const cap = Math.min(limit, 200);

  const conditions = [eq(auditLogTable.teamId, teamId), gte(auditLogTable.createdAt, since)];
  if (action) conditions.push(eq(auditLogTable.action, action));
  if (userId) conditions.push(eq(auditLogTable.userId, userId));
  if (before) conditions.push(lt(auditLogTable.createdAt, before));

  return db
    .select()
    .from(auditLogTable)
    .where(and(...conditions))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(cap + 1); // fetch one extra to detect hasMore
}

type AuditLogRecordRow = typeof auditLogTable.$inferSelect;

// ── CSV export ────────────────────────────────────────────────────
export async function exportCsv(teamId: number, days: number): Promise<string> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const rows = await db
    .select()
    .from(auditLogTable)
    .where(and(eq(auditLogTable.teamId, teamId), gte(auditLogTable.createdAt, since)))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(10000);

  const headers = ["timestamp", "user_id", "action", "entity_type", "entity_id", "ip_address", "metadata"];

  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.createdAt.toISOString(),
        csvEscape(r.userId),
        csvEscape(r.action),
        csvEscape(r.entityType ?? ""),
        r.entityId ?? "",
        csvEscape(r.ipAddress ?? ""),
        csvEscape(r.metadata ? JSON.stringify(r.metadata) : ""),
      ].join(","),
    ),
  ];

  return lines.join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// ── Retention cleanup (called by the nightly cron) ────────────────
export async function runRetentionCleanup(): Promise<{ deleted: number }> {
  // For each team, delete rows older than their plan's retention window.
  const allTeams = await db.select({ id: teamsTable.id, plan: teamsTable.plan }).from(teamsTable);

  let totalDeleted = 0;

  for (const team of allTeams) {
    const retentionDays = AUDIT_RETENTION_DAYS[team.plan] ?? 30;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);

    const result = await db
      .delete(auditLogTable)
      .where(and(eq(auditLogTable.teamId, team.id), lt(auditLogTable.createdAt, cutoff)))
      .returning({ id: auditLogTable.id });
    totalDeleted += result.length;
  }

  // Also clean up orphan rows (no team, older than 30 days).
  const orphanCutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const orphans = await db
    .delete(auditLogTable)
    .where(and(isNull(auditLogTable.teamId), lt(auditLogTable.createdAt, orphanCutoff)))
    .returning({ id: auditLogTable.id });
  totalDeleted += orphans.length;

  return { deleted: totalDeleted };
}
