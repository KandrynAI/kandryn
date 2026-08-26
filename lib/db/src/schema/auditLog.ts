import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { teamsTable } from "./teams";

/**
 * Immutable audit trail of significant platform actions (migration 0018).
 * Rows are only ever inserted (fire-and-forget) and eventually deleted by the
 * retention cron per plan tier — never updated. team_id is nullable so actions
 * taken before a user has a team are still recorded.
 */
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id").references(() => teamsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Tamper-evident hash chain (0033, governance item 7). Computed by a DB
    // BEFORE INSERT trigger — never set by the application. prev_hash links to the
    // team's previous row; row_hash = sha256(prev_hash || canonical content).
    prevHash: text("prev_hash"),
    rowHash: text("row_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_team_created_idx").on(t.teamId, t.createdAt),
    index("audit_log_user_created_idx").on(t.userId, t.createdAt),
    index("audit_log_action_idx").on(t.action),
  ],
);

export type AuditLogRecord = typeof auditLogTable.$inferSelect;
