import { and, eq, lt, isNull } from "drizzle-orm";
import {
  db,
  jiraAccountLinksTable,
  jiraInstallationsTable,
  jiraLinkCodesTable,
  jiraSiteMapTable,
  type JiraInstallation,
} from "@workspace/db";
import * as audit from "../auditService.js";
import { logger } from "../../lib/logger.js";
import type { ForgeContext } from "../../middlewares/forgeAuth.js";

/**
 * The installation registry (0043).
 *
 * Kandryn learns about a Jira site the first time a verified token arrives
 * from it. That is deliberate: the lifecycle event is a nice-to-have, not a
 * precondition, so a site whose install event was missed still works.
 */

/** `last_seen_at` is written at most this often per installation. */
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

/** How long a disabled installation keeps its links before cleanup. */
export const RETENTION_DAYS = 30;

const lastSeenAt = new Map<string, number>();

export interface EnsureResult {
  installation: JiraInstallation;
  /** True only on the insert, so the audit row is written once. */
  created: boolean;
}

/**
 * Find or create the installation for a verified token, and remember the site.
 *
 * The site URL comes from the token's signed `context.siteUrl`, so storing it
 * here is not trusting the panel — the panel cannot alter a signed claim.
 */
export async function ensureInstallation(forge: ForgeContext): Promise<EnsureResult> {
  const [existing] = await db
    .select()
    .from(jiraInstallationsTable)
    .where(eq(jiraInstallationsTable.installationId, forge.installationId));

  if (existing) {
    await touch(existing, forge);
    return { installation: existing, created: false };
  }

  // onConflictDoNothing + re-read: two panel loads can race on first open.
  await db
    .insert(jiraInstallationsTable)
    .values({
      installationId: forge.installationId,
      cloudId: forge.cloudId,
      siteUrl: forge.siteUrl,
      environment: forge.environment.toLowerCase(),
      status: "active",
      lastSeenAt: new Date(),
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(jiraInstallationsTable)
    .where(eq(jiraInstallationsTable.installationId, forge.installationId));
  if (!row) throw new Error("Installation row could not be created");

  await rememberSite(forge);
  return { installation: row, created: true };
}

/** Cheap heartbeat, throttled so a busy panel is not a write amplifier. */
async function touch(row: JiraInstallation, forge: ForgeContext): Promise<void> {
  const now = Date.now();
  const seen = lastSeenAt.get(forge.installationId) ?? 0;
  if (now - seen < LAST_SEEN_THROTTLE_MS) return;
  lastSeenAt.set(forge.installationId, now);

  const patch: Partial<typeof jiraInstallationsTable.$inferInsert> = { lastSeenAt: new Date() };
  // Backfill the site if the first token we saw had no claim for it.
  if (forge.siteUrl && row.siteUrl !== forge.siteUrl) patch.siteUrl = forge.siteUrl;
  await db
    .update(jiraInstallationsTable)
    .set(patch)
    .where(eq(jiraInstallationsTable.id, row.id))
    .catch((err) => logger.warn({ err }, "Jira installation heartbeat failed"));
  if (forge.siteUrl) await rememberSite(forge);
}

/** cloud id -> site host, from the signed claim. Best-effort cache. */
async function rememberSite(forge: ForgeContext): Promise<void> {
  if (!forge.siteUrl) return;
  await db
    .insert(jiraSiteMapTable)
    .values({ cloudId: forge.cloudId, siteUrl: forge.siteUrl })
    .onConflictDoUpdate({
      target: jiraSiteMapTable.cloudId,
      set: { siteUrl: forge.siteUrl, resolvedAt: new Date() },
    })
    .catch((err) => logger.warn({ err }, "Jira site map write failed"));
}

/** The site host for a cloud id, if one has ever been seen. */
export async function siteForCloudId(cloudId: string): Promise<string | null> {
  const [row] = await db
    .select({ siteUrl: jiraSiteMapTable.siteUrl })
    .from(jiraSiteMapTable)
    .where(eq(jiraSiteMapTable.cloudId, cloudId));
  return row?.siteUrl ?? null;
}

export function auditInstallationRegistered(forge: ForgeContext, installationRowId: number): void {
  audit.log({
    // No Kandryn user exists yet at install time; the installation is the actor.
    userId: `jira-installation:${forge.installationId}`,
    teamId: null,
    action: "jira.installation_registered",
    entityType: "jira_installation",
    entityId: installationRowId,
    // Identifiers only. Never a token, never issue text.
    metadata: { cloudId: forge.cloudId, environment: forge.environment },
  });
}

/** Mark an installation disabled. Idempotent — the event may arrive 4 times. */
export async function disableInstallation(installationId: string): Promise<void> {
  await db
    .update(jiraInstallationsTable)
    .set({ status: "disabled" })
    .where(eq(jiraInstallationsTable.installationId, installationId));
  lastSeenAt.delete(installationId);
}

/**
 * Cleanup for installations disabled longer than the retention window.
 *
 * Links are revoked and unused codes deleted; the installation row stays, so
 * the audit trail still explains what happened. A reinstall gets a new Forge
 * installation id anyway, so it starts clean regardless.
 */
export async function runJiraRetention(): Promise<{ installations: number; links: number; codes: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const stale = await db
    .select({ id: jiraInstallationsTable.id })
    .from(jiraInstallationsTable)
    .where(and(eq(jiraInstallationsTable.status, "disabled"), lt(jiraInstallationsTable.lastSeenAt, cutoff)));
  if (stale.length === 0) return { installations: 0, links: 0, codes: 0 };

  let links = 0;
  let codes = 0;
  for (const { id } of stale) {
    const revoked = await db
      .update(jiraAccountLinksTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(jiraAccountLinksTable.installationId, id), isNull(jiraAccountLinksTable.revokedAt)))
      .returning({ id: jiraAccountLinksTable.id });
    links += revoked.length;
    const dropped = await db
      .delete(jiraLinkCodesTable)
      .where(and(eq(jiraLinkCodesTable.installationId, id), isNull(jiraLinkCodesTable.usedAt)))
      .returning({ id: jiraLinkCodesTable.id });
    codes += dropped.length;
  }
  return { installations: stale.length, links, codes };
}

/** A tiny in-memory limiter. Per instance on Vercel, so a speed bump only. */
const hits = new Map<string, number[]>();

export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

export function __resetRateLimitForTests(): void {
  hits.clear();
  lastSeenAt.clear();
}
