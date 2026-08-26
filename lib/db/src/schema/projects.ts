import { pgTable, serial, text, integer, numeric, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { repositoriesTable } from "./repositories";

/**
 * A Blue Mantis project binds exactly one PLM project (Jira or Azure DevOps)
 * to exactly one repository (strict 1:1:1 in v1).
 *
 * NOTE: the spec models ids as uuid, but the existing tables (repositories,
 * tasks) use serial integer PKs. A uuid FK cannot reference a serial PK, so all
 * new tables use serial integer PKs to stay consistent and keep migration risk
 * low (per the spec's own goal).
 */
export const projectsTable = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    plmProvider: text("plm_provider").$type<"jira" | "azure-devops">().notNull(),
    // Nullable ONLY for legacy/migrated projects; the API enforces non-null on create.
    plmProjectKey: text("plm_project_key"),
    plmProjectName: text("plm_project_name"),
    // @deprecated (0020) — repositories.project_id is the single source of truth
    // for the project↔repo binding. This column is no longer written and will be
    // dropped once all read paths are migrated; kept nullable for safety. Resolve
    // a project's repository via `repositories WHERE project_id = :projectId`.
    repositoryId: integer("repository_id").references(() => repositoriesTable.id, {
      onDelete: "restrict",
    }),
    defaultTarget: text("default_target").$type<"story" | "task">().notNull().default("task"),
    // Multi-tenancy (0017). teamId is a plain int (no Drizzle .references() to
    // avoid a schema import cycle; the FK lives in the SQL migration).
    teamId: integer("team_id"),
    visibility: text("visibility").$type<"personal" | "team">().notNull().default("personal"),
    // Confidence gate threshold (Phase 4, 0029). A plan whose confidence_score is
    // below this parks in awaiting_review before generation. 0.6 is an
    // UNCALIBRATED placeholder — the eval harness should tune it.
    confidenceThreshold: numeric("confidence_threshold").notNull().default("0.6"),
    // Per-provider pinned generation model (0030, governance item 2). Null =
    // unpinned = use the current default for that provider.
    pinnedClaudeModel: text("pinned_claude_model"),
    pinnedOpenaiModel: text("pinned_openai_model"),
    // Segregation of duties (0032, governance item 6). When true, the user who
    // triggered a run may not approve its own parked plan — a different admin must.
    requireSecondApprover: boolean("require_second_approver").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("projects_user_id_idx").on(t.userId),
    // One binding per PLM project per user (nulls are distinct in Postgres, so
    // legacy rows with a null key do not collide).
    uniqueIndex("projects_user_plm_key_idx").on(t.userId, t.plmProvider, t.plmProjectKey),
  ],
);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
