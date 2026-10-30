import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The Jira app (Forge), phase 1 — read-only (0043).
 *
 * Kandryn shows up inside Jira Cloud as an issue panel. These tables hold
 * only what the extension needs to answer "who is asking, and may they see
 * this": the installations, the Jira-user-to-Kandryn-user links, the typed
 * codes that create them, and a cloud id -> site host cache.
 *
 * The extension never uses the existing PLM credentials in
 * `integration_configs`, and it never trusts a site URL the panel sends — the
 * site comes from the signed Forge invocation token.
 *
 * No triggers here, so the push-does-not-create-triggers trap does not apply.
 * All three indexes are declared below as well as in the SQL, because
 * drizzle-kit push drops an index it cannot see in the schema (the 0041
 * pitfall) — and losing the partial unique index would silently allow two
 * active links for one Jira user.
 */

export type JiraInstallationStatus = "active" | "disabled";

export const jiraInstallationsTable = pgTable(
  "jira_installations",
  {
    id: serial("id").primaryKey(),
    /** Forge installation id. Changes on reinstall, not on upgrade. */
    installationId: text("installation_id").notNull(),
    cloudId: text("cloud_id").notNull(),
    /** From the token's signed `context.siteUrl`, normalized. */
    siteUrl: text("site_url"),
    environment: text("environment").notNull().default("production"),
    status: text("status").$type<JiraInstallationStatus>().notNull().default("active"),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("jira_installations_installation_uq").on(t.installationId)],
);

export const jiraAccountLinksTable = pgTable(
  "jira_account_links",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => jiraInstallationsTable.id, { onDelete: "cascade" }),
    /**
     * The token's `principal` claim. Atlassian documents it as the invoking
     * user's identifier and does NOT state that it equals the account id, so
     * it is treated as an opaque bounded string.
     */
    atlassianAccountId: text("atlassian_account_id").notNull(),
    /** Clerk user id. */
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    // Partial: revoked rows stay for audit, so only ACTIVE links are unique.
    uniqueIndex("jira_account_links_active_uq")
      .on(t.installationId, t.atlassianAccountId)
      .where(sql`revoked_at IS NULL`),
    index("jira_account_links_user_idx").on(t.userId),
  ],
);

export const jiraLinkCodesTable = pgTable("jira_link_codes", {
  id: serial("id").primaryKey(),
  /** sha256 of the typed code. The code itself is never stored. */
  codeHash: text("code_hash").notNull().unique(),
  installationId: integer("installation_id")
    .notNull()
    .references(() => jiraInstallationsTable.id, { onDelete: "cascade" }),
  atlassianAccountId: text("atlassian_account_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jiraSiteMapTable = pgTable(
  "jira_site_map",
  {
    id: serial("id").primaryKey(),
    cloudId: text("cloud_id").notNull().unique(),
    /** Normalized: https scheme, lowercase host, no trailing slash. */
    siteUrl: text("site_url").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jira_site_map_site_url_idx").on(t.siteUrl)],
);

export type JiraInstallation = typeof jiraInstallationsTable.$inferSelect;
export type JiraAccountLink = typeof jiraAccountLinksTable.$inferSelect;
export type JiraLinkCode = typeof jiraLinkCodesTable.$inferSelect;
export type JiraSiteMapRow = typeof jiraSiteMapTable.$inferSelect;
