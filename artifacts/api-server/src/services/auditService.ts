import type { Request } from "express";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
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

// ── Hash-chain verification (governance item 7) ───────────────────
export interface ChainVerification {
  ok: boolean;
  firstBrokenId: number | null;
  rowsChecked: number;
}

/** Verify a team's audit hash chain via the DB verifier (0033). Reports the
 *  first tampered/deleted row, or ok across all hash-bearing rows. */
export async function verifyChain(teamId: number): Promise<ChainVerification> {
  const res = await db.execute(
    sql`SELECT ok, first_broken_id, rows_checked FROM audit_log_verify(${teamId})`,
  );
  const rows = (res as unknown as { rows?: Array<{ ok: boolean; first_broken_id: number | null; rows_checked: string | number }> }).rows ?? [];
  const r = rows[0];
  return {
    ok: Boolean(r?.ok),
    firstBrokenId: r?.first_broken_id != null ? Number(r.first_broken_id) : null,
    rowsChecked: r?.rows_checked != null ? Number(r.rows_checked) : 0,
  };
}

/** Verify every team's chain (for the nightly monitoring pass). Returns the
 *  teams whose chain is broken, empty when all verify clean. */
export async function verifyAllChains(): Promise<Array<{ teamId: number; firstBrokenId: number | null }>> {
  const teams = await db.select({ id: teamsTable.id }).from(teamsTable);
  const broken: Array<{ teamId: number; firstBrokenId: number | null }> = [];
  for (const t of teams) {
    const r = await verifyChain(t.id);
    if (!r.ok) broken.push({ teamId: t.id, firstBrokenId: r.firstBrokenId });
  }
  return broken;
}

// ── Retention cleanup (called by the nightly cron) ────────────────
export async function runRetentionCleanup(): Promise<{ deleted: number }> {
  // For each team, delete rows older than its retention window: the per-team
  // override (0031) when set, else the plan default.
  const allTeams = await db
    .select({ id: teamsTable.id, plan: teamsTable.plan, auditRetentionDays: teamsTable.auditRetentionDays })
    .from(teamsTable);

  let totalDeleted = 0;

  for (const team of allTeams) {
    const retentionDays = team.auditRetentionDays ?? AUDIT_RETENTION_DAYS[team.plan] ?? 30;
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
