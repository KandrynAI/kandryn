import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, jiraAccountLinksTable, jiraInstallationsTable, jiraLinkCodesTable } from "@workspace/db";
import * as audit from "../auditService.js";
import { logger } from "../../lib/logger.js";
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  MAX_STARTS_PER_HOUR,
  MAX_USER_FAILURES_PER_HOUR,
  generateCode,
  hashCode,
  normalizeCode,
} from "./codes.js";
import { rateLimited } from "./installations.js";

/**
 * Account linking (0043): turning a Jira user into a Kandryn user, once.
 *
 * The code is TYPED, never clicked. A clickable link would let an attacker
 * mint a code against their own Jira account, send the URL to a Kandryn user,
 * and have that user's click bind the attacker's Jira account to the victim's
 * Kandryn data — after which the attacker's panel would show the victim's
 * work. Requiring the code to be read off the person's own Jira panel and
 * typed into their own Kandryn session closes that, and is the reason none of
 * these functions ever accepts a code from a query string.
 *
 * Every failure answers identically. A caller must not be able to tell an
 * expired code from a wrong one from one that never existed.
 */

export type CompleteFailure = "invalid" | "rate_limited" | "conflict";
export type CompleteResult =
  | { ok: true; installationRowId: number; siteUrl: string | null }
  | { ok: false; reason: CompleteFailure };

export interface StartedCode {
  code: string;
  expiresInSeconds: number;
}

/**
 * Mint a code for a verified Jira identity.
 *
 * Older unused codes for the same identity are burned first: two live codes
 * for one person is two chances for a guess, and the panel only ever shows
 * the newest.
 */
export async function startLink(
  installationRowId: number,
  atlassianAccountId: string,
): Promise<StartedCode | { rateLimited: true }> {
  if (rateLimited(`jira:start:${installationRowId}:${atlassianAccountId}`, MAX_STARTS_PER_HOUR, 60 * 60 * 1000)) {
    return { rateLimited: true };
  }

  await db
    .delete(jiraLinkCodesTable)
    .where(
      and(
        eq(jiraLinkCodesTable.installationId, installationRowId),
        eq(jiraLinkCodesTable.atlassianAccountId, atlassianAccountId),
        isNull(jiraLinkCodesTable.usedAt),
      ),
    );

  const code = generateCode();
  await db.insert(jiraLinkCodesTable).values({
    codeHash: hashCode(code),
    installationId: installationRowId,
    atlassianAccountId,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  return { code, expiresInSeconds: Math.floor(CODE_TTL_MS / 1000) };
}

/**
 * Complete a link for a signed-in Kandryn user.
 *
 * The code is looked up by hash, so a stolen database row cannot be replayed
 * as a code. Marking it used and creating the link happen in one transaction:
 * two submissions of the same code must not both win.
 */
export async function completeLink(userId: string, typed: string): Promise<CompleteResult> {
  if (rateLimited(`jira:complete:${userId}`, MAX_USER_FAILURES_PER_HOUR, 60 * 60 * 1000)) {
    return { ok: false, reason: "rate_limited" };
  }

  const hash = hashCode(normalizeCode(typed));
  const [row] = await db
    .select()
    .from(jiraLinkCodesTable)
    .where(
      and(
        eq(jiraLinkCodesTable.codeHash, hash),
        isNull(jiraLinkCodesTable.usedAt),
        gt(jiraLinkCodesTable.expiresAt, new Date()),
        sql`${jiraLinkCodesTable.failedAttempts} < ${MAX_CODE_ATTEMPTS}`,
      ),
    );

  if (!row) {
    // Count the miss against any code that does exist under this hash, so a
    // guesser burns the code rather than probing it indefinitely.
    await db
      .update(jiraLinkCodesTable)
      .set({ failedAttempts: sql`${jiraLinkCodesTable.failedAttempts} + 1` })
      .where(eq(jiraLinkCodesTable.codeHash, hash))
      .catch(() => undefined);
    return { ok: false, reason: "invalid" };
  }

  // Already linked to somebody else: refuse rather than move the link.
  const [clash] = await db
    .select({ userId: jiraAccountLinksTable.userId })
    .from(jiraAccountLinksTable)
    .where(
      and(
        eq(jiraAccountLinksTable.installationId, row.installationId),
        eq(jiraAccountLinksTable.atlassianAccountId, row.atlassianAccountId),
        isNull(jiraAccountLinksTable.revokedAt),
      ),
    );
  if (clash && clash.userId !== userId) return { ok: false, reason: "conflict" };
  if (clash && clash.userId === userId) {
    await db.update(jiraLinkCodesTable).set({ usedAt: new Date() }).where(eq(jiraLinkCodesTable.id, row.id));
    const site = await installationSite(row.installationId);
    return { ok: true, installationRowId: row.installationId, siteUrl: site };
  }

  try {
    await db.transaction(async (tx) => {
      // Claim the code inside the transaction, conditional on it still being
      // unused, so a concurrent submission of the same code loses.
      const claimed = await tx
        .update(jiraLinkCodesTable)
        .set({ usedAt: new Date() })
        .where(and(eq(jiraLinkCodesTable.id, row.id), isNull(jiraLinkCodesTable.usedAt)))
        .returning({ id: jiraLinkCodesTable.id });
      if (claimed.length === 0) throw new Error("code_taken");

      await tx.insert(jiraAccountLinksTable).values({
        installationId: row.installationId,
        atlassianAccountId: row.atlassianAccountId,
        userId,
      });
    });
  } catch (err) {
    const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    // The partial unique index caught a concurrent link for this Jira user.
    if (code === "23505") return { ok: false, reason: "conflict" };
    logger.warn({ err }, "Jira link could not be completed");
    return { ok: false, reason: "invalid" };
  }

  const siteUrl = await installationSite(row.installationId);
  audit.log({
    userId,
    teamId: null,
    action: "jira.account_linked",
    entityType: "jira_account_link",
    entityId: row.installationId,
    metadata: { installationRowId: row.installationId },
  });
  return { ok: true, installationRowId: row.installationId, siteUrl };
}

async function installationSite(installationRowId: number): Promise<string | null> {
  const [row] = await db
    .select({ siteUrl: jiraInstallationsTable.siteUrl })
    .from(jiraInstallationsTable)
    .where(eq(jiraInstallationsTable.id, installationRowId));
  return row?.siteUrl ?? null;
}

export interface LinkView {
  id: number;
  siteUrl: string | null;
  linkedAt: Date;
}

/** This user's active links. Scoped by userId, like every other query. */
export async function listLinks(userId: string): Promise<LinkView[]> {
  const rows = await db
    .select({
      id: jiraAccountLinksTable.id,
      createdAt: jiraAccountLinksTable.createdAt,
      siteUrl: jiraInstallationsTable.siteUrl,
    })
    .from(jiraAccountLinksTable)
    .innerJoin(jiraInstallationsTable, eq(jiraInstallationsTable.id, jiraAccountLinksTable.installationId))
    .where(and(eq(jiraAccountLinksTable.userId, userId), isNull(jiraAccountLinksTable.revokedAt)));
  return rows.map((r) => ({ id: r.id, siteUrl: r.siteUrl, linkedAt: r.createdAt }));
}

/**
 * Revoke one of this user's links.
 *
 * Scoped by userId in the WHERE clause, so another user's link is simply not
 * found — a non-owner gets a 404, never a 403, because whose link it is is
 * not theirs to learn.
 */
export async function revokeLink(userId: string, linkId: number): Promise<boolean> {
  const revoked = await db
    .update(jiraAccountLinksTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(jiraAccountLinksTable.id, linkId),
        eq(jiraAccountLinksTable.userId, userId),
        isNull(jiraAccountLinksTable.revokedAt),
      ),
    )
    .returning({ id: jiraAccountLinksTable.id });
  if (revoked.length === 0) return false;
  audit.log({
    userId,
    teamId: null,
    action: "jira.account_unlinked",
    entityType: "jira_account_link",
    entityId: linkId,
  });
  return true;
}

/** The Kandryn user behind a verified Jira identity, or null. */
export async function linkedUser(installationRowId: number, atlassianAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: jiraAccountLinksTable.userId })
    .from(jiraAccountLinksTable)
    .where(
      and(
        eq(jiraAccountLinksTable.installationId, installationRowId),
        eq(jiraAccountLinksTable.atlassianAccountId, atlassianAccountId),
        isNull(jiraAccountLinksTable.revokedAt),
      ),
    );
  return row?.userId ?? null;
}
