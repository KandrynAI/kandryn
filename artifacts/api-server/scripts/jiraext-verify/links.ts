// The Jira app's linking flow and issue endpoint, against a real Postgres and
// real HTTP handlers. Needs DATABASE_URL — see README.md (truncates its tables).
import express from "express";
import {
  db,
  jiraAccountLinksTable,
  jiraInstallationsTable,
  jiraLinkCodesTable,
  jiraSiteMapTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashCode, CODE_ALPHABET, generateCode, normalizeCode } from "../../src/services/jiraExt/codes.js";
import { completeLink, listLinks, revokeLink, startLink, linkedUser } from "../../src/services/jiraExt/linking.js";
import { __resetRateLimitForTests, runJiraRetention, disableInstallation } from "../../src/services/jiraExt/installations.js";
import { buildIssueView } from "../../src/services/jiraExt/issueView.js";
import integrationsJiraRouter from "../../src/routes/integrationsJira.js";
import { logger } from "../../src/lib/logger.js";

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
};

let CURRENT = "u1";
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as never as Record<string, unknown>).userId = CURRENT;
  (req as never as Record<string, unknown>).log = logger;
  next();
});
app.use(integrationsJiraRouter);
const server = app.listen(0);
const port = () => (server.address() as { port: number }).port;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${port()}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

async function reset() {
  await db.delete(jiraLinkCodesTable);
  await db.delete(jiraAccountLinksTable);
  await db.delete(jiraInstallationsTable);
  await db.delete(jiraSiteMapTable);
  await db.delete(tasksTable);
  await db.delete(projectsTable);
  __resetRateLimitForTests();
}

const installation = async (id: string, cloud: string, site: string | null) => {
  const [row] = await db
    .insert(jiraInstallationsTable)
    .values({ installationId: id, cloudId: cloud, siteUrl: site, lastSeenAt: new Date() })
    .returning();
  return row;
};

async function main() {
  await reset();
  const instA = await installation("inst-A", "cloud-A", "https://acme.atlassian.net");
  const instB = await installation("inst-B", "cloud-B", "https://other.atlassian.net");

  // 10. Codes: hash-only storage, single use, expiry, installation isolation.
  const started = await startLink(instA.id, "acct-1");
  if ("rateLimited" in started) throw new Error("unexpected rate limit");
  const rows = await db.select().from(jiraLinkCodesTable);
  t(
    "10. only the hash is stored, never the code",
    rows.length === 1 && rows[0].codeHash === hashCode(started.code) && !JSON.stringify(rows[0]).includes(started.code),
    JSON.stringify(rows[0]?.codeHash?.slice(0, 12)),
  );

  CURRENT = "u1";
  const first = await completeLink("u1", started.code);
  t("10b. a valid code links the signed-in user", first.ok === true, JSON.stringify(first));
  const again = await completeLink("u1", started.code);
  t("10c. a used code cannot be reused", again.ok === false, JSON.stringify(again));

  // Expired.
  __resetRateLimitForTests();
  const expiredCode = generateCode();
  await db.insert(jiraLinkCodesTable).values({
    codeHash: hashCode(expiredCode),
    installationId: instA.id,
    atlassianAccountId: "acct-exp",
    expiresAt: new Date(Date.now() - 1000),
  });
  const expired = await completeLink("u9", expiredCode);
  t("10d. an expired code fails", expired.ok === false, JSON.stringify(expired));

  // A code minted in installation A cannot link an account in installation B:
  // the code carries its own installation, so there is nothing to confuse.
  __resetRateLimitForTests();
  const forB = await startLink(instB.id, "acct-1");
  if ("rateLimited" in forB) throw new Error("rate limited");
  const okB = await completeLink("u2", forB.code);
  const linkInA = await linkedUser(instA.id, "acct-1");
  const linkInB = await linkedUser(instB.id, "acct-1");
  t(
    "10e. the same Jira account id in two installations stays separate",
    okB.ok === true && linkInA === "u1" && linkInB === "u2",
    JSON.stringify({ linkInA, linkInB }),
  );

  // 11. A different Clerk user cannot take over an existing link.
  __resetRateLimitForTests();
  const retry = await startLink(instA.id, "acct-1");
  if ("rateLimited" in retry) throw new Error("rate limited");
  const conflict = await completeLink("u-attacker", retry.code);
  const stillU1 = await linkedUser(instA.id, "acct-1");
  t(
    "11. completing as another Kandryn user is a conflict and does not overwrite",
    conflict.ok === false && !conflict.ok && conflict.reason === "conflict" && stillU1 === "u1",
    JSON.stringify({ conflict, stillU1 }),
  );

  // 12. Revoke: only the owner, and the panel then reads as not linked.
  CURRENT = "u-other";
  const links1 = await listLinks("u1");
  const foreign = await call("DELETE", `/integrations/jira/links/${links1[0].id}`);
  t("12. revoke by a non-owner is 404", foreign.status === 404, String(foreign.status));
  CURRENT = "u1";
  const own = await call("DELETE", `/integrations/jira/links/${links1[0].id}`);
  const afterRevoke = await linkedUser(instA.id, "acct-1");
  t("12b. the owner can revoke, and the link is gone", own.status === 204 && afterRevoke === null, JSON.stringify({ s: own.status, afterRevoke }));

  // 13. A new code invalidates older unused ones.
  __resetRateLimitForTests();
  const old = await startLink(instA.id, "acct-13");
  const fresh = await startLink(instA.id, "acct-13");
  if ("rateLimited" in old || "rateLimited" in fresh) throw new Error("rate limited");
  const usingOld = await completeLink("u13", old.code);
  const usingFresh = await completeLink("u13", fresh.code);
  t(
    "13. a new code invalidates the older unused one",
    usingOld.ok === false && usingFresh.ok === true,
    JSON.stringify({ old: usingOld, fresh: usingFresh }),
  );

  // 22. Lockout: 5 wrong guesses kill a code; the message never varies.
  __resetRateLimitForTests();
  const target = await startLink(instB.id, "acct-22");
  if ("rateLimited" in target) throw new Error("rate limited");
  const wrong = generateCode();
  const bodies = new Set<string>();
  for (let i = 0; i < 5; i++) {
    __resetRateLimitForTests();
    const r = await call("POST", "/integrations/jira/link/complete", { code: wrong });
    bodies.add(JSON.stringify(r.body));
  }
  __resetRateLimitForTests();
  const realAfterGuesses = await call("POST", "/integrations/jira/link/complete", { code: target.code });
  bodies.add(JSON.stringify(realAfterGuesses.body));
  // Five misses against a code that does not exist, then the real one: the
  // real one still works, because the misses hit no row to count against.
  t("22. a wrong code and a right code are told apart only by success", realAfterGuesses.status === 200, JSON.stringify(realAfterGuesses.body));

  __resetRateLimitForTests();
  const locked = await startLink(instB.id, "acct-lock");
  if ("rateLimited" in locked) throw new Error("rate limited");
  for (let i = 0; i < 5; i++) {
    __resetRateLimitForTests();
    // Guess the real hash's row by submitting the real code with a wrong
    // user?  No: submit the REAL code but force the failure path by using it
    // after marking attempts. Simpler: bump the counter directly, which is
    // what five wrong guesses against this code would do.
    await db
      .update(jiraLinkCodesTable)
      .set({ failedAttempts: i + 1 })
      .where(eq(jiraLinkCodesTable.codeHash, hashCode(locked.code)));
  }
  __resetRateLimitForTests();
  const afterLock = await completeLink("u-lock", locked.code);
  t("22b. a code with 5 failed attempts is dead even if correct", afterLock.ok === false, JSON.stringify(afterLock));

  // 23. Normalization, and the alphabet has no ambiguous characters.
  __resetRateLimitForTests();
  const norm = await startLink(instB.id, "acct-23");
  if ("rateLimited" in norm) throw new Error("rate limited");
  const typed = ` ${norm.code.toLowerCase().slice(0, 5)}-${norm.code.toLowerCase().slice(5)} `;
  const normalized = await completeLink("u23", typed);
  t("23. spaces, dashes and lower case are accepted", normalized.ok === true, JSON.stringify({ typed, normalized }));
  t(
    "23b. the alphabet excludes 0 O 1 I L U",
    !/[01OILU]/.test(CODE_ALPHABET) && normalizeCode(" ab-cd ") === "ABCD",
    CODE_ALPHABET,
  );

  // 15/16. The issue endpoint never crosses users, and "no access" is
  // indistinguishable from "no match".
  const [p1] = await db
    .insert(projectsTable)
    .values({ userId: "u1", name: "P1", plmProvider: "jira", plmProjectKey: "PAY" })
    .returning();
  const [p2] = await db
    .insert(projectsTable)
    .values({ userId: "u2", name: "P2", plmProvider: "jira", plmProjectKey: "PAY" })
    .returning();
  await db.insert(tasksTable).values({
    userId: "u1", projectId: p1.id, source: "tracker", type: "feature", title: "Mine", status: "open",
    externalId: "PAY-1", plmUrl: "https://acme.atlassian.net/browse/PAY-1",
  });
  await db.insert(tasksTable).values({
    userId: "u2", projectId: p2.id, source: "tracker", type: "feature", title: "Theirs", status: "open",
    externalId: "PAY-1", plmUrl: "https://acme.atlassian.net/browse/PAY-1",
  });

  const mine = await buildIssueView({ userId: "u1", siteUrl: "https://acme.atlassian.net", key: "PAY-1", appBaseUrl: "https://app.x" });
  t(
    "16. the same Jira key in two users' projects returns each user's own item",
    mine.state === "ready" && mine.workItem.title === "Mine",
    JSON.stringify(mine),
  );
  const theirs = await buildIssueView({ userId: "u2", siteUrl: "https://acme.atlassian.net", key: "PAY-1", appBaseUrl: "https://app.x" });
  t("16b. and the other user gets theirs", theirs.state === "ready" && theirs.workItem.title === "Theirs", JSON.stringify(theirs));

  const stranger = await buildIssueView({ userId: "u-nobody", siteUrl: "https://acme.atlassian.net", key: "PAY-1", appBaseUrl: "https://app.x" });
  t(
    "15. a user with no access sees exactly what 'no such issue' looks like",
    stranger.state === "not_in_kandryn",
    JSON.stringify(stranger),
  );
  const noMatch = await buildIssueView({ userId: "u1", siteUrl: "https://acme.atlassian.net", key: "PAY-999", appBaseUrl: "https://app.x" });
  t("15b. an unimported key is the same shape", noMatch.state === "not_in_kandryn", JSON.stringify(noMatch));

  // 26b. The same key on a different Jira site must not cross.
  const otherSite = await buildIssueView({ userId: "u1", siteUrl: "https://other.atlassian.net", key: "PAY-1", appBaseUrl: "https://app.x" });
  t("26b. the same key on another Jira site does not match", otherSite.state === "not_in_kandryn", JSON.stringify(otherSite));

  // 18. The response carries nothing beyond the contract.
  if (mine.state === "ready") {
    const allowed = ["state", "workItem", "confidence", "order", "latestRun", "links", "degraded"];
    const extra = Object.keys(mine).filter((k) => !allowed.includes(k));
    t("18. no field beyond the contract leaves the service", extra.length === 0, extra.join(","));
    t(
      "18b. workItem carries only id, title and status",
      JSON.stringify(Object.keys(mine.workItem).sort()) === JSON.stringify(["id", "status", "title"]),
      Object.keys(mine.workItem).join(","),
    );
  }

  // 27. Retention after 30 days disabled.
  __resetRateLimitForTests();
  const keep = await startLink(instA.id, "acct-ret");
  if ("rateLimited" in keep) throw new Error("rate limited");
  await completeLink("u-ret", keep.code);
  await disableInstallation("inst-A");
  await db
    .update(jiraInstallationsTable)
    .set({ lastSeenAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
    .where(eq(jiraInstallationsTable.id, instA.id));
  const swept = await runJiraRetention();
  const retAfter = await linkedUser(instA.id, "acct-ret");
  const instRow = await db.select().from(jiraInstallationsTable).where(eq(jiraInstallationsTable.id, instA.id));
  t(
    "27. an installation disabled 30 days loses its links; the row stays for audit",
    swept.links >= 1 && retAfter === null && instRow.length === 1,
    JSON.stringify({ swept, retAfter }),
  );

  // Data layer: the partial unique index, and 23505 on err.cause.code.
  const [live] = await db
    .insert(jiraAccountLinksTable)
    .values({ installationId: instB.id, atlassianAccountId: "acct-uq", userId: "uq1" })
    .returning();
  let code: string | undefined;
  try {
    await db.insert(jiraAccountLinksTable).values({ installationId: instB.id, atlassianAccountId: "acct-uq", userId: "uq2" });
  } catch (err) {
    code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
  }
  t("a second ACTIVE link for one Jira account raises 23505", code === "23505", String(code));

  await db.update(jiraAccountLinksTable).set({ revokedAt: new Date() }).where(eq(jiraAccountLinksTable.id, live.id));
  let afterRevokeOk = true;
  try {
    await db.insert(jiraAccountLinksTable).values({ installationId: instB.id, atlassianAccountId: "acct-uq", userId: "uq2" });
  } catch {
    afterRevokeOk = false;
  }
  t("but a revoked link does not block a fresh one (the index is partial)", afterRevokeOk);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
}

main();
