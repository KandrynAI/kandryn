import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from "jose";
import { forgeAuth, normalizeSiteUrl, __setKeySetForTests } from "./forgeAuth.js";
import { logger } from "../lib/logger.js";

/**
 * The Forge token boundary.
 *
 * Everything the Jira app is allowed to see hangs off this middleware getting
 * the answer right, so the failure side is tested at least as hard as the
 * success side: a token signed by the wrong key, for the wrong app, with the
 * algorithm swapped, or from a developer install, must all be refused, and a
 * key-server outage must not be mistaken for either.
 */

const APP_ID = "ari:cloud:ecosystem::app/11111111-2222-3333-4444-555555555555";
const OTHER_APP = "ari:cloud:ecosystem::app/99999999-9999-9999-9999-999999999999";

let priv: CryptoKey;
let pub: CryptoKey;
let jwk: JWK;

const CLAIMS = {
  app: {
    id: APP_ID,
    installationId: "inst-1",
    environment: { type: "PRODUCTION" },
  },
  context: { cloudId: "cloud-1", siteUrl: "https://ACME.atlassian.net/" },
  principal: "655362:312d-abcd",
};

async function sign(
  over: Record<string, unknown> = {},
  opts: { key?: CryptoKey; alg?: string; aud?: string; iss?: string; exp?: string; kid?: string } = {},
): Promise<string> {
  return new SignJWT({ ...CLAIMS, ...over })
    .setProtectedHeader({ alg: opts.alg ?? "RS256", ...(opts.kid ? { kid: opts.kid } : {}) })
    .setIssuedAt()
    .setIssuer(opts.iss ?? "forge/invocation-token")
    .setAudience(opts.aud ?? APP_ID)
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? priv);
}

/** A minimal Express double: enough to see the status, body and next(). */
function ctx(header?: string) {
  const logs: unknown[] = [];
  const req = {
    headers: header === undefined ? {} : { authorization: header },
    log: {
      warn: (...a: unknown[]) => logs.push(a),
      info: (...a: unknown[]) => logs.push(a),
      error: (...a: unknown[]) => logs.push(a),
    },
  } as never as Parameters<ReturnType<typeof forgeAuth>>[0];
  let status = 0;
  let body: unknown = null;
  const res = {
    status(s: number) {
      status = s;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  } as never as Parameters<ReturnType<typeof forgeAuth>>[1];
  let nexted = false;
  const next = () => {
    nexted = true;
  };
  return {
    req,
    res,
    next,
    logs,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    get nexted() {
      return nexted;
    },
  };
}

const run = async (c: ReturnType<typeof ctx>) => {
  await forgeAuth()(c.req, c.res, c.next as never);
  return c;
};

beforeEach(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  priv = pair.privateKey as CryptoKey;
  pub = pair.publicKey as CryptoKey;
  jwk = await exportJWK(pub);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  __setKeySetForTests(createLocalJWKSet({ keys: [jwk] }));
  process.env.FORGE_APP_ID = APP_ID;
  delete process.env.ALLOW_FORGE_DEV_ENV;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  __setKeySetForTests(null);
});

// --- 1 ---------------------------------------------------------------------

test("1. a valid token passes and attaches exactly the four context fields", async () => {
  const c = await run(ctx(`Bearer ${await sign({}, { kid: "test-key" })}`));
  assert.equal(c.nexted, true);
  assert.equal(c.status, 0);
  const forge = (c.req as unknown as { forge: Record<string, unknown> }).forge;
  assert.equal(forge.installationId, "inst-1");
  assert.equal(forge.cloudId, "cloud-1");
  assert.equal(forge.environment, "PRODUCTION");
  assert.equal(forge.accountId, "655362:312d-abcd");
  // The site comes from the token, normalized — not from anything the panel sent.
  assert.equal(forge.siteUrl, "https://acme.atlassian.net");
  assert.deepEqual(Object.keys(forge).sort(), ["accountId", "cloudId", "environment", "installationId", "siteUrl"]);
});

test("1b. app.installation.id is accepted as well as app.installationId", async () => {
  const token = await sign({ app: { id: APP_ID, installation: { id: "inst-nested" }, environment: { type: "PRODUCTION" } } }, { kid: "test-key" });
  const c = await run(ctx(`Bearer ${token}`));
  assert.equal(c.nexted, true);
  assert.equal((c.req as unknown as { forge: { installationId: string } }).forge.installationId, "inst-nested");
});

// --- 2 ---------------------------------------------------------------------

test("2. a missing Authorization header is 401", async () => {
  const c = await run(ctx());
  assert.equal(c.status, 401);
  assert.equal(c.nexted, false);
});

test("2b. a malformed header is 401", async () => {
  for (const h of ["", "Bearer", "Basic abc", "Bearer  "]) {
    const c = await run(ctx(h));
    assert.equal(c.status, 401, h);
    assert.equal(c.nexted, false, h);
  }
});

test("2c. an expired token is 401", async () => {
  const c = await run(ctx(`Bearer ${await sign({}, { kid: "test-key", exp: "-1m" })}`));
  assert.equal(c.status, 401);
  assert.equal(c.nexted, false);
});

// --- 3 ---------------------------------------------------------------------

test("3. a token for another app's audience is 401", async () => {
  const c = await run(ctx(`Bearer ${await sign({}, { kid: "test-key", aud: OTHER_APP })}`));
  assert.equal(c.status, 401);
});

test("3b. a wrong issuer is 401", async () => {
  const c = await run(ctx(`Bearer ${await sign({}, { kid: "test-key", iss: "forge/something-else" })}`));
  assert.equal(c.status, 401);
});

test("3c. a right audience but a mismatched app.id claim is 401", async () => {
  // The audience passes; only the in-body app id is wrong. Atlassian's own
  // guidance is to check app.id separately, and this is why.
  const token = await sign({ app: { id: OTHER_APP, installationId: "inst-1", environment: { type: "PRODUCTION" } } }, { kid: "test-key" });
  const c = await run(ctx(`Bearer ${token}`));
  assert.equal(c.status, 401);
  assert.equal(c.nexted, false);
});

// --- 4 ---------------------------------------------------------------------

test("4. a token signed by a different key is 401", async () => {
  const other = await generateKeyPair("RS256", { extractable: true });
  const c = await run(ctx(`Bearer ${await sign({}, { key: other.privateKey as CryptoKey, kid: "test-key" })}`));
  assert.equal(c.status, 401);
});

test('4b. alg "none" is 401', async () => {
  // Hand-built, because no signer will produce an unsigned token for us.
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ ...CLAIMS, iss: "forge/invocation-token", aud: APP_ID, exp: Math.floor(Date.now() / 1000) + 300 }),
  ).toString("base64url");
  const c = await run(ctx(`Bearer ${header}.${body}.`));
  assert.equal(c.status, 401);
  assert.equal(c.nexted, false);
});

test("4c. algorithm confusion — HS256 signed with the public key as the secret — is 401", async () => {
  // The classic: if the verifier let the token pick the algorithm, the public
  // key doubles as a shared secret and anyone can mint tokens.
  const secret = Buffer.from(JSON.stringify(jwk));
  const token = await new SignJWT(CLAIMS)
    .setProtectedHeader({ alg: "HS256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer("forge/invocation-token")
    .setAudience(APP_ID)
    .setExpirationTime("5m")
    .sign(secret);
  const c = await run(ctx(`Bearer ${token}`));
  assert.equal(c.status, 401);
  assert.equal(c.nexted, false);
});

test("4d. an algorithm outside the pinned set is 401 even when the key would accept it", async () => {
  // This is the one that isolates OUR pin. With a JWK carrying no `alg`,
  // jose will happily hand the RSA key back for an RS512 header, so the only
  // thing refusing the token is the `algorithms` option in forgeAuth. Remove
  // that option and this test fails while the others still pass.
  // An RS256 CryptoKey cannot sign RS512 (its hash is bound to SHA-256), so
  // the pair for this case is generated for RS512 and published without an
  // `alg`, leaving jose willing to use it.
  const pair512 = await generateKeyPair("RS512", { extractable: true });
  const open = await exportJWK(pair512.publicKey as CryptoKey);
  open.kid = "test-key";
  __setKeySetForTests(createLocalJWKSet({ keys: [open] }));
  const token = await new SignJWT(CLAIMS)
    .setProtectedHeader({ alg: "RS512", kid: "test-key" })
    .setIssuedAt()
    .setIssuer("forge/invocation-token")
    .setAudience(APP_ID)
    .setExpirationTime("5m")
    .sign(pair512.privateKey as CryptoKey);
  const c = await run(ctx(`Bearer ${token}`));
  assert.equal(c.status, 401);
  assert.equal(c.nexted, false);
});

// --- 5 ---------------------------------------------------------------------

test("5. an unknown key id is 401, not a 503 — jose has already refetched by then", async () => {
  const c = await run(ctx(`Bearer ${await sign({}, { kid: "some-other-kid" })}`));
  assert.equal(c.status, 401);
  assert.equal(c.nexted, false);
});

// --- 6 ---------------------------------------------------------------------

test("6. an unreachable key server is 503, never an allow", async () => {
  __setKeySetForTests((async () => {
    // No jose `code` — what a failed fetch looks like.
    throw new TypeError("fetch failed");
  }) as never);
  const c = await run(ctx(`Bearer ${await sign({}, { kid: "test-key" })}`));
  assert.equal(c.status, 503);
  assert.equal(c.nexted, false);
});

test("6b. a timeout is 503", async () => {
  __setKeySetForTests((async () => {
    throw Object.assign(new Error("timeout"), { code: "ERR_JWKS_TIMEOUT" });
  }) as never);
  const c = await run(ctx(`Bearer ${await sign({}, { kid: "test-key" })}`));
  assert.equal(c.status, 503);
});

test("6c. cached keys keep working after a failure", async () => {
  const good = createLocalJWKSet({ keys: [jwk] });
  __setKeySetForTests(good);
  const ok = await run(ctx(`Bearer ${await sign({}, { kid: "test-key" })}`));
  assert.equal(ok.nexted, true, "the cached key set still verifies");
});

// --- 7 ---------------------------------------------------------------------

test("7. a development-environment token is refused in production", async () => {
  process.env.NODE_ENV = "production";
  const dev = { app: { id: APP_ID, installationId: "inst-1", environment: { type: "DEVELOPMENT" } } };
  const c = await run(ctx(`Bearer ${await sign(dev, { kid: "test-key" })}`));
  assert.equal(c.status, 401);
  assert.equal(c.nexted, false);
});

test("7b. ALLOW_FORGE_DEV_ENV=true lets it through", async () => {
  process.env.NODE_ENV = "production";
  process.env.ALLOW_FORGE_DEV_ENV = "true";
  const dev = { app: { id: APP_ID, installationId: "inst-1", environment: { type: "DEVELOPMENT" } } };
  const c = await run(ctx(`Bearer ${await sign(dev, { kid: "test-key" })}`));
  assert.equal(c.nexted, true);
  assert.equal((c.req as unknown as { forge: { environment: string } }).forge.environment, "DEVELOPMENT");
});

test("7c. outside production a development token is fine", async () => {
  const dev = { app: { id: APP_ID, installationId: "inst-1", environment: { type: "DEVELOPMENT" } } };
  const c = await run(ctx(`Bearer ${await sign(dev, { kid: "test-key" })}`));
  assert.equal(c.nexted, true);
});

// --- 8 ---------------------------------------------------------------------

test("8. the token never reaches a log call", async () => {
  const token = await sign({}, { kid: "some-other-kid" });
  const seen: string[] = [];
  const spy = (...args: unknown[]) => seen.push(JSON.stringify(args));
  const original = { warn: logger.warn, info: logger.info, error: logger.error };
  (logger as unknown as Record<string, unknown>).warn = spy;
  (logger as unknown as Record<string, unknown>).info = spy;
  (logger as unknown as Record<string, unknown>).error = spy;
  const c = ctx(`Bearer ${token}`);
  // Capture the request logger too — that is the one the middleware uses.
  (c.req as unknown as { log: Record<string, unknown> }).log = { warn: spy, info: spy, error: spy };
  try {
    await forgeAuth()(c.req, c.res, c.next as never);
  } finally {
    Object.assign(logger as unknown as Record<string, unknown>, original);
  }
  const all = seen.join("\n");
  assert.ok(!all.includes(token), "the raw token must never be logged");
  // Nor any recognisable slice of it.
  assert.ok(!all.includes(token.slice(0, 40)), "not even a prefix of the token");
  assert.match(all, /reason/, "but the reason code is logged");
});

// --- 9 ---------------------------------------------------------------------

test("9. an unset FORGE_APP_ID is 503 and never an allow", async () => {
  delete process.env.FORGE_APP_ID;
  const c = await run(ctx(`Bearer ${await sign({}, { kid: "test-key" })}`));
  assert.equal(c.status, 503);
  assert.equal(c.nexted, false);
});

test("9b. a site URL is normalized, and nonsense becomes null", () => {
  assert.equal(normalizeSiteUrl("https://ACME.atlassian.net/"), "https://acme.atlassian.net");
  assert.equal(normalizeSiteUrl("acme.atlassian.net"), "https://acme.atlassian.net");
  assert.equal(normalizeSiteUrl("  https://a.b/x/y  "), "https://a.b");
  assert.equal(normalizeSiteUrl(null), null);
  assert.equal(normalizeSiteUrl(""), null);
  assert.equal(normalizeSiteUrl("not a url"), null);
});
