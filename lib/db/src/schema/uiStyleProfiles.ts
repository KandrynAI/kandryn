import { pgTable, serial, integer, text, boolean, timestamp, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type UiStyleStatus = "pending" | "extracting" | "ready" | "not_applicable" | "failed";

/** Where a value was read from. Every extracted item carries one. */
export interface UiStyleEvidence {
  file: string;
  line: number;
}

export interface UiStyleToken {
  name: string;
  value: string;
  /** The CSS selector a custom property was declared under, e.g. ":root", ".dark". */
  scope?: string;
  source: UiStyleEvidence;
}

export interface UiStyleTokens {
  colors: UiStyleToken[];
  typography: UiStyleToken[];
  radius: UiStyleToken[];
  spacing: UiStyleToken[];
  shadows: UiStyleToken[];
  other: UiStyleToken[];
}

export interface UiStyleComponent {
  name: string;
  path: string;
  group: "primitive" | "composed";
  /** Import specifier usable from app code, with tsconfig aliases resolved. */
  importPath: string;
  /** Inbound import count from the Graphify graph, or null when not measured. */
  usedBy: number | null;
  hasVariants?: boolean;
}

export interface UiStyleFramework {
  ui: string | null;
  uiVersion?: string | null;
  styling: Array<{ name: string; version?: string | null }>;
  componentLib?: string | null;
}

export interface UiStyleConventions {
  classHelper?: { name: string; importPath: string } | null;
  iconLibrary?: string | null;
  primitives?: string[];
  fileNaming?: "PascalCase" | "kebab-case" | "mixed" | null;
  colocatedStyles?: boolean;
  theming?: "class" | "data-attribute" | "prefers-color-scheme" | "none" | null;
  layoutShell?: string | null;
}

export interface UiStyleExemplar {
  path: string;
  sha: string;
}

/**
 * How a project's interface is already styled (0042).
 *
 * Extracted by STATIC PARSING only — nothing from the customer's repository is
 * executed, imported or evaluated, and no file content is stored. Every value
 * here passed validation at extraction time and carries evidence (file, line)
 * so a reader can check it against the repository.
 *
 * One row per project: the profile belongs to the project and survives a
 * repository rebind, while `repositoryId` records what it was read from.
 */
export const uiStyleProfilesTable = pgTable(
  "ui_style_profiles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: integer("project_id").notNull(),
    repositoryId: integer("repository_id"),
    status: text("status").$type<UiStyleStatus>().notNull().default("pending"),
    /** A styling file changed since extraction. A hint in the UI, never a block. */
    stale: boolean("stale").notNull().default(false),
    /** Whether runs may use this profile. */
    enabled: boolean("enabled").notNull().default(true),
    revision: integer("revision").notNull().default(0),
    uiRoot: text("ui_root"),
    uiRootOptions: jsonb("ui_root_options").$type<string[] | null>().default(null),
    /** Default-branch HEAD captured BEFORE the fetches, so the read is attributable. */
    sourceRef: text("source_ref"),
    framework: jsonb("framework").$type<UiStyleFramework | null>().default(null),
    tokens: jsonb("tokens").$type<UiStyleTokens | null>().default(null),
    components: jsonb("components").$type<UiStyleComponent[] | null>().default(null),
    conventions: jsonb("conventions").$type<UiStyleConventions | null>().default(null),
    exemplars: jsonb("exemplars").$type<UiStyleExemplar[] | null>().default(null),
    /** What was skipped, unreadable, capped or dropped by validation. */
    warnings: jsonb("warnings").$type<string[] | null>().default(null),
    error: text("error"),
    extractMs: integer("extract_ms"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    /** Set when a worker claims the row; also the staleness check for a stuck claim. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Both indexes are declared here, not only in the migration: drizzle-kit
    // push DROPS an index it cannot see in the schema (the 0041 pitfall), and
    // losing either one here costs the duplicate guard or the claim query.
    uniqueIndex("ui_style_profiles_project_uq").on(t.projectId),
    index("ui_style_profiles_pending_idx")
      .on(t.status, t.claimedAt)
      .where(sql`status = 'pending'`),
  ],
);

export type UiStyleProfile = typeof uiStyleProfilesTable.$inferSelect;
