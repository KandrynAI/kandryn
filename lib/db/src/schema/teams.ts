import { pgTable, serial, text, integer, timestamp, index, unique } from "drizzle-orm/pg-core";

export type TeamPlan = "free" | "pro" | "max" | "enterprise";
export type TeamRole = "admin" | "member";

export const teamsTable = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").unique(),
    ownerUserId: text("owner_user_id").notNull(),
    plan: text("plan").$type<TeamPlan>().notNull().default("free"),
    // Per-team audit-log retention in days (0031, governance item 5). Null =
    // fall back to the plan default (AUDIT_RETENTION_DAYS). Admin-configurable;
    // supports multi-year retention for regulated customers.
    auditRetentionDays: integer("audit_retention_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("teams_owner_idx").on(t.ownerUserId)],
);

export const teamMembersTable = pgTable(
  "team_members",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").$type<TeamRole>().notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("team_members_team_idx").on(t.teamId),
    index("team_members_user_idx").on(t.userId),
    unique("team_members_team_user_uq").on(t.teamId, t.userId),
  ],
);

export const teamInvitesTable = pgTable(
  "team_invites",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id, { onDelete: "cascade" }),
    invitedBy: text("invited_by").notNull(),
    email: text("email").notNull(),
    role: text("role").$type<TeamRole>().notNull().default("member"),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    index("team_invites_token_idx").on(t.token),
    index("team_invites_team_idx").on(t.teamId),
    unique("team_invites_team_email_uq").on(t.teamId, t.email),
  ],
);

export const teamIntegrationsTable = pgTable(
  "team_integrations",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    setBy: text("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("team_integrations_team_idx").on(t.teamId),
    unique("team_integrations_team_key_uq").on(t.teamId, t.key),
  ],
);

export type Team = typeof teamsTable.$inferSelect;
export type TeamMember = typeof teamMembersTable.$inferSelect;
export type TeamInvite = typeof teamInvitesTable.$inferSelect;
export type TeamIntegration = typeof teamIntegrationsTable.$inferSelect;
