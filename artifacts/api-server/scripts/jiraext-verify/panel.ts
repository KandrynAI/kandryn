// The /api/ext/jira/v1 routes end to end: a locally signed Forge token, real
// handlers, a real Postgres. Needs DATABASE_URL — see README.md.
import express from "express";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { eq } from "drizzle-orm";
import {
  db,
  jiraAccountLinksTable,
  jiraInstallationsTable,
  jiraLinkCodesTable,
  jiraSiteMapTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { __setKeySetForTests } from "../../src/middlewares/forgeAuth.js";
import { __resetRateLimitForTests } from "../../src/services/jiraExt/installations.js";
import { completeLink } from "../../src/services/jiraExt/linking.js";
import extJiraRouter from "../../src/routes/extJira.js";
import { logger } from "../../src/lib/logger.js";

let pass = 0, fail = 0;
const t = (n: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
};

const APP_ID = "ari:cloud:ecosystem::app/test-app";
process.env.FORGE_APP_ID = APP_ID;
process.env.APP_BASE_URL = "https://app.kandryn.test";

let priv: CryptoKey;
let jwk: JWK;

async function token(over: Record<string, unknown> = {}): Promise<string> {
  const claims = {
    app: { id: APP_ID, installationId: "inst-A", environment: { type: "PRODUCTION" } },
    context: { cloudId: "cloud-A", siteUrl: "https://acme.atlassian.net" },
    principal: "acct-1",
    ...over,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setIssuedAt()
    .setIssuer("forge/invocation-token")
    .setAudience(APP_ID)
    .setExpirationTime("5m")
    .sign(priv);
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as never as Record<string, unknown>).log = logger;
  next();
});
app.use(extJiraRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _n: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});
const server = app.listen(0);
const port = () => (server.address() as { port: number }).port;

const call = async (method: string, path: string, tok?: string) => {
  const r = await fetch(`http://127.0.0.1:${port()}${path}`, {
    method,
    headers: tok ? { authorization: `Bearer ${tok}` } : {},
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
};

async function main() {
  const pair = await generateKeyPair("RS256", { extractable: true });
  priv = pair.privateKey as CryptoKey;
  jwk = await exportJWK(pair.publicKey as CryptoKey);
  jwk.kid = "k";
  jwk.alg = "RS256";
  __setKeySetForTests(createLocalJWKSet({ keys: [jwk] }));

  await db.delete(jiraLinkCodesTable);
  await db.delete(jiraAccountLinksTable);
  await db.delete(jiraInstallationsTable);
  await db.delete(jiraSiteMapTable);
  await db.delete(tasksTable);
  await db.delete(projectsTable);
  __resetRateLimitForTests();

  // 20. The installation is created on first verified call, exactly once.
  const first = await call("GET", "/ext/jira/v1/issue?key=PAY-1", await token());
  const second = await call("GET", "/ext/jira/v1/issue?key=PAY-1", await token());
  const installs = await db.select().from(jiraInstallationsTable);
  t("20. two calls from a new installation create one row", installs.length === 1, `${installs.length}`);
  t("14. an unlinked Jira user gets not_linked, not an error", first.body?.state === "not_linked" && first.status === 200, JSON.stringify(first.body));
  t("14b. and it is stable across calls", second.body?.state === "not_linked");

  // The site claim is recorded from the token.
  const siteRow = await db.select().from(jiraSiteMapTable);
  t("25. the site is recorded from the signed claim", siteRow[0]?.siteUrl === "https://acme.atlassian.net", JSON.stringify(siteRow));

  // 21. The attack: /link/start returns a pageUrl that carries no code.
  __resetRateLimitForTests();
  const start = await call("POST", "/ext/jira/v1/link/start", await token());
  const code = start.body?.code as string;
  t(
    "21. the page URL contains no code, and nothing else in the body does either",
    typeof code === "string" && code.length === 10 &&
      !String(start.body.pageUrl).includes(code) &&
      !/[?#]/.test(String(start.body.pageUrl)),
    JSON.stringify(start.body),
  );
  t("21b. the page URL is the plain link page", start.body?.pageUrl === "https://app.kandryn.test/integrations/jira/link", String(start.body?.pageUrl));
  t("no-store is set on the panel's responses", first.headers.get("cache-control") === "no-store", String(first.headers.get("cache-control")));

  // 19. Key validation.
  for (const bad of ["pay-1", "PAY", "PAY-", "1-PAY", "P-1", "PAY-1x", encodeURIComponent("PAY-1; DROP TABLE tasks")]) {
    const r = await call("GET", `/ext/jira/v1/issue?key=${bad}`, await token());
    if (r.status !== 400) { t(`19. invalid key "${bad}" is 400`, false, String(r.status)); break; }
  }
  const okKey = await call("GET", "/ext/jira/v1/issue?key=PAY-1", await token());
  t("19. invalid key shapes are 400 and a valid one is not", okKey.status === 200);

  // 14c. Linked but no matching work item.
  const linked = await completeLink("u1", code);
  if (!linked.ok) throw new Error("link failed in fixture");
  const noMatch = await call("GET", "/ext/jira/v1/issue?key=PAY-404", await token());
  t("14c. linked with no match is not_in_kandryn", noMatch.body?.state === "not_in_kandryn", JSON.stringify(noMatch.body));

  // 17. A failing sub-service degrades one section, not the response.
  const [proj] = await db
    .insert(projectsTable)
    .values({ userId: "u1", name: "P", plmProvider: "jira", plmProjectKey: "PAY" })
    .returning();
  await db.insert(tasksTable).values({
    userId: "u1", projectId: proj.id, source: "tracker", type: "feature",
    title: "Card", status: "open", externalId: "PAY-1",
    plmUrl: "https://acme.atlassian.net/browse/PAY-1",
  });
  const ready = await call("GET", "/ext/jira/v1/issue?key=PAY-1", await token());
  t(
    "17. a ready issue returns 200 with the contract's sections",
    ready.status === 200 && ready.body?.state === "ready" && ready.body.workItem.title === "Card" &&
      "order" in ready.body && "latestRun" in ready.body && "links" in ready.body,
    JSON.stringify(ready.body),
  );
  t(
    "17b. openInKandryn points at the right project",
    ready.body?.links?.openInKandryn === `https://app.kandryn.test/p/${proj.id}/board`,
    String(ready.body?.links?.openInKandryn),
  );

  // 25b. A site URL in the query is ignored — the token decides.
  const spoof = await call("GET", "/ext/jira/v1/issue?key=PAY-1&siteUrl=https://evil.atlassian.net", await token());
  t("25b. a panel-supplied siteUrl is ignored", spoof.body?.state === "ready", JSON.stringify(spoof.body?.state));
  const otherSiteToken = await token({ context: { cloudId: "cloud-A", siteUrl: "https://evil.atlassian.net" } });
  const otherSite = await call("GET", "/ext/jira/v1/issue?key=PAY-1", otherSiteToken);
  t("25c. a token naming another site does not match this item", otherSite.body?.state === "not_in_kandryn", JSON.stringify(otherSite.body?.state));

  // 20b. Uninstall disables, and later calls are refused.
  const un = await call("POST", "/ext/jira/v1/lifecycle/uninstalled", await token());
  const un2 = await call("POST", "/ext/jira/v1/lifecycle/uninstalled", await token());
  const afterUninstall = await call("GET", "/ext/jira/v1/issue?key=PAY-1", await token());
  const row = await db.select().from(jiraInstallationsTable).where(eq(jiraInstallationsTable.installationId, "inst-A"));
  t(
    "20b. uninstall is idempotent, sets disabled, and later calls are 403",
    un.status === 204 && un2.status === 204 && row[0].status === "disabled" &&
      afterUninstall.status === 403 && afterUninstall.body?.error === "installation_disabled",
    JSON.stringify({ un: un.status, un2: un2.status, status: row[0]?.status, after: afterUninstall.status }),
  );

  // 24. The kill switch answers before any database work.
  process.env.JIRA_EXT_ENABLED = "false";
  const realSelect = db.select;
  let touchedDb = false;
  (db as unknown as Record<string, unknown>).select = (...args: unknown[]) => {
    touchedDb = true;
    return (realSelect as (...a: unknown[]) => unknown).apply(db, args);
  };
  const off = await call("GET", "/ext/jira/v1/issue?key=PAY-1", await token());
  const offStart = await call("POST", "/ext/jira/v1/link/start", await token());
  (db as unknown as Record<string, unknown>).select = realSelect;
  process.env.JIRA_EXT_ENABLED = "true";
  t(
    "24. JIRA_EXT_ENABLED=false is 503 on every ext route, before any db call",
    off.status === 503 && offStart.status === 503 && !touchedDb,
    JSON.stringify({ issue: off.status, start: offStart.status, touchedDb }),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
}

main();
