import { pgTable, serial, text, integer, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";

export type TeamPlan = "free" | "pro" | "max" | "enterprise";
export type TeamRole = "admin" | "member";
export type SequencePolicy = "off" | "warn" | "admin_override_only";
/**
 * Mirrors shared/types/agentKey.ts (kept local because lib/db is a composite
 * project rooted at src/ and cannot import from ../../../../shared), the same
 * way runs.ts keeps its persisted result shapes.
 */
export type WorkspaceAgentSource = "kandryn" | "workspace_keys";

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
    // Run-order policy (0038). Null = the application default, 'warn'. Nullable
    // rather than defaulted so a user with no team row gets the same default
    // through one code path, matching auditRetentionDays above.
    sequencePolicy: text("sequence_policy").$type<SequencePolicy | null>(),
    /**
     * Whose credentials this workspace's agents run on (0046):
     * "workspace_keys" (the credentials the workspace saved) or "kandryn" (the
     * platform's). Null = the application default, "workspace_keys", following
     * the same nullable-not-defaulted shape as the two settings above.
     */
    agentKeySource: text("agent_key_source").$type<WorkspaceAgentSource | null>(),
    /**
     * Whether a member may override the workspace with their own saved
     * credentials (0046).
     *
     * NOT nullable-with-a-default like its neighbours, and the exception is
     * deliberate: the answer differs by age. Workspaces that existed before
     * this shipped are backfilled `true`, because their members were already
     * running on personal credentials and turning that off under them would
     * break every run. New workspaces get `false` from the column default, so
     * an enterprise starts closed and opens up by choice. A single nullable
     * default cannot say both things.
     */
    // Default TRUE (0053). It was false, and 0046's backfill set true only for
    // workspaces that already existed, so every workspace created after that
    // deploy silently ignored the credentials its own users had pasted: the
    // resolver skips a personal token when this is false, and a new workspace
    // owns none of its own. Confirmed in production on run #42, where the
    // commit reached GitHub with no credential at all.
    //
    // True is also the right default on its own terms: the flag exists so an
    // admin can RESTRICT a workspace to credentials it owns, which is a
    // decision to take once there is something to restrict to. Starting
    // restricted with nothing configured is not a safe default, it is a
    // broken one.
    allowPersonalCredentials: boolean("allow_personal_credentials").notNull().default(true),
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
