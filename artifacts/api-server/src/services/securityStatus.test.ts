import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { postSecurityStatus, type SecurityStatusTarget } from "./securityStatus.js";
import { SECURITY_CHECK_CONTEXT } from "../../../../shared/types/branding.js";

/**
 * The Azure DevOps path has never run against a live organisation — it is
 * written from the REST documentation. These tests are the only thing standing
 * between that and a customer, so they pin the parts a live call would reject:
 * the URL, the payload shape, the auth scheme, and the state vocabulary, which
 * differs from GitHub's by more than casing.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Captured {
  url: string;
  init: RequestInit;
}

/** Stub fetch, capturing the single request the poster makes. */
function capture(status = 200): { calls: Captured[] } {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status === 200 ? "{}" : "denied", { status });
  }) as typeof fetch;
  return { calls };
}

const body = (c: Captured): Record<string, unknown> => JSON.parse(String(c.init.body));
const header = (c: Captured, k: string): string =>
  String((c.init.headers as Record<string, string> | undefined)?.[k] ?? "");

const ado = (over: Partial<SecurityStatusTarget> = {}): SecurityStatusTarget => ({
  repoUrl: "https://dev.azure.com/acme/Payments/_git/payments-api",
  commitHash: "abc123",
  prUrl: "https://dev.azure.com/acme/Payments/_git/payments-api/pullrequest/4821",
  runId: 77,
  gate: "blocked",
  details: "Blocked: 2 high, 0 critical across 7 file(s)",
  creds: { azureReposToken: "pat-value" },
  ...over,
});

const gh = (over: Partial<SecurityStatusTarget> = {}): SecurityStatusTarget => ({
  repoUrl: "https://github.com/acme/payments-api",
  commitHash: "abc123",
  prUrl: "https://github.com/acme/payments-api/pull/12",
  runId: 77,
  gate: "blocked",
  details: "Blocked: 2 high",
  creds: { githubToken: "gh-token" },
  ...over,
});

// ---------------------------------------------------------------------------
// Azure DevOps
// ---------------------------------------------------------------------------

test("Azure Repos: posts to the pull request statuses endpoint", async () => {
  const { calls } = capture();
  const out = await postSecurityStatus(ado());
  assert.deepEqual(out, { posted: true, provider: "azure-repos" });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://dev.azure.com/acme/Payments/_apis/git/repositories/payments-api" +
      "/pullRequests/4821/statuses?api-version=7.1",
  );
  assert.equal(calls[0].init.method, "POST");
});

test("Azure Repos: sends the check as a genre/name pair matching the shared constant", async () => {
  const { calls } = capture();
  await postSecurityStatus(ado());
  const ctx = body(calls[0]).context as { genre: string; name: string };
  assert.deepEqual(ctx, { genre: "kandryn", name: "security" });
  assert.equal(`${ctx.genre}/${ctx.name}`, SECURITY_CHECK_CONTEXT);
});

test("Azure Repos: uses ADO's state vocabulary, not GitHub's", async () => {
  // succeeded/failed/pending — NOT success/failure. A wrong value here is a
  // 400 that would only show up against a live organisation.
  for (const [gate, expected] of [
    ["approved", "succeeded"],
    ["blocked", "failed"],
    ["pending", "pending"],
  ] as const) {
    const { calls } = capture();
    await postSecurityStatus(ado({ gate }));
    assert.equal(body(calls[0]).state, expected, `gate ${gate}`);
  }
});

test("Azure Repos: authenticates as Basic with an empty username", async () => {
  const { calls } = capture();
  await postSecurityStatus(ado());
  assert.equal(header(calls[0], "Authorization"), `Basic ${Buffer.from(":pat-value").toString("base64")}`);
});

test("Azure Repos: targetUrl points at the run, not the commit", async () => {
  const { calls } = capture();
  await postSecurityStatus(ado());
  assert.match(String(body(calls[0]).targetUrl), /\/runs\/77$/);
});

test("Azure Repos: no pull request means nothing to attach to, and it says so", async () => {
  // The one irreducible asymmetry with GitHub, which can always fall back to
  // the commit. Reported rather than silently skipped.
  const { calls } = capture();
  const out = await postSecurityStatus(ado({ prUrl: null }));
  assert.equal(calls.length, 0);
  assert.equal(out.posted, false);
  assert.match(out.posted === false ? out.reason : "", /pull request/i);
});

test("Azure Repos: a 403 names the likely token-scope cause", async () => {
  // The failure we most expect on first contact with a real organisation.
  const { calls } = capture(403);
  const out = await postSecurityStatus(ado());
  assert.equal(calls.length, 1);
  assert.equal(out.posted, false);
  assert.match(out.posted === false ? out.reason : "", /403/);
  assert.match(out.posted === false ? out.reason : "", /scope|Contribute/i);
});

test("Azure Repos: a missing token is reported, not thrown", async () => {
  const { calls } = capture();
  const out = await postSecurityStatus(ado({ creds: {} }));
  assert.equal(calls.length, 0);
  assert.equal(out.posted, false);
});

test("Azure Repos: a network error is contained — a status problem never fails a scan", async () => {
  globalThis.fetch = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  const out = await postSecurityStatus(ado());
  assert.equal(out.posted, false);
});

// ---------------------------------------------------------------------------
// GitHub — unchanged behaviour, pinned so the refactor cannot have moved it
// ---------------------------------------------------------------------------

test("GitHub: still posts a commit status with the flat context string", async () => {
  const { calls } = capture();
  const out = await postSecurityStatus(gh());
  assert.deepEqual(out, { posted: true, provider: "github" });
  assert.equal(calls[0].url, "https://api.github.com/repos/acme/payments-api/statuses/abc123");
  assert.equal(body(calls[0]).context, SECURITY_CHECK_CONTEXT);
  assert.equal(body(calls[0]).state, "failure");
  assert.match(String(body(calls[0]).target_url), /\/runs\/77$/);
});

test("GitHub: posts on the commit even with no pull request", async () => {
  const { calls } = capture();
  const out = await postSecurityStatus(gh({ prUrl: null }));
  assert.equal(out.posted, true);
  assert.equal(calls.length, 1);
});

test("GitHub: description is clipped to the 140-char API limit", async () => {
  const { calls } = capture();
  await postSecurityStatus(gh({ details: "x".repeat(300) }));
  assert.equal(String(body(calls[0]).description).length, 140);
});

// ---------------------------------------------------------------------------
// Neither provider
// ---------------------------------------------------------------------------

test("an unrecognised host posts nothing and reports why", async () => {
  const { calls } = capture();
  const out = await postSecurityStatus(gh({ repoUrl: "https://gitlab.com/acme/thing" }));
  assert.equal(calls.length, 0);
  assert.equal(out.posted, false);
  assert.match(out.posted === false ? out.reason : "", /neither GitHub nor Azure Repos/i);
});
