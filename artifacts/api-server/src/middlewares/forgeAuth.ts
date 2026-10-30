import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";

/**
 * Forge Invocation Token verification — the security core of the Jira app
 * (0043, phase 1).
 *
 * Every request from the Jira panel arrives as a JWT that Atlassian signed.
 * Nothing in it may be trusted until the signature verifies, which is why the
 * whole token is verified against Atlassian's published key set and the claims
 * are only read afterwards. The panel itself is untrusted: it cannot choose
 * which installation, user or Jira site the request is attributed to, because
 * all four come out of the token and none is read from the query or body.
 *
 * Deliberately small. Everything it decides is a yes or a no, and the failure
 * side is where the risk lives, so the paths are flat and each has a test.
 *
 * Contract source: Atlassian's Forge remote invocation contract —
 * issuer `forge/invocation-token`, audience the app id in the form
 * `ari:cloud:ecosystem::app/<id>`, keys at the JWKS URL below.
 */

/** Atlassian's published key set for Forge invocation tokens. */
const JWKS_URL = "https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json";

const ISSUER = "forge/invocation-token";

/**
 * The only signature algorithm accepted.
 *
 * Pinned rather than inferred: leaving it open is what makes "alg: none" and
 * HS256-with-the-public-key-as-secret work. Atlassian's contract page does not
 * state the algorithm, so this is the value observed on real tokens (RS256)
 * and anything else is refused — a wrong guess fails closed and loudly, which
 * is the right direction for this particular mistake.
 */
const ALGORITHMS = ["RS256"] as const;

/** How long a fetched key set is reused before Atlassian is asked again. */
const JWKS_CACHE_MS = 10 * 60 * 1000;

export interface ForgeContext {
  installationId: string;
  cloudId: string;
  environment: string;
  accountId: string;
  /** The token's signed `context.siteUrl`, normalized, when present. */
  siteUrl: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      forge?: ForgeContext;
    }
  }
}

/**
 * The claims this middleware reads, and nothing else.
 *
 * Every field is bounded: a claim is attacker-influenced until Atlassian's
 * signature says otherwise, and even then an unbounded string reaching a
 * database query or a log line is avoidable risk. `principal` is Atlassian's
 * name for the invoking user's identifier; their docs do not state that it
 * equals the account id, so it is carried as an opaque value.
 */
const bounded = z.string().min(1).max(256);

const FitClaims = z.object({
  app: z.object({
    id: bounded,
    installationId: bounded.optional(),
    installation: z.object({ id: bounded.optional() }).loose().optional(),
    environment: z.object({ type: bounded.optional() }).loose().optional(),
  }).loose(),
  context: z.object({
    cloudId: bounded.optional(),
    siteUrl: z.string().max(512).optional(),
  }).loose().optional(),
  principal: bounded.optional(),
});

/** https, lowercase host, no trailing slash — the one form stored and compared. */
export function normalizeSiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
    if (url.hostname === "") return null;
    return `https://${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

// --- key set ---------------------------------------------------------------
// Cached in module scope: a serverless instance serves many requests, and
// refetching Atlassian's keys per request would be both slow and rude.

let keySet: JWTVerifyGetKey | null = null;
let keySetAt = 0;

function jwks(): JWTVerifyGetKey {
  const now = Date.now();
  if (!keySet || now - keySetAt > JWKS_CACHE_MS) {
    // createRemoteJWKSet handles its own fetching, caching and — on an unknown
    // `kid` — a single cooldown-limited refetch, which is exactly the
    // "refetch once, then fail" behaviour this needs.
    keySet = createRemoteJWKSet(new URL(JWKS_URL), {
      cacheMaxAge: JWKS_CACHE_MS,
      cooldownDuration: 30 * 1000,
    });
    keySetAt = now;
  }
  return keySet;
}

/** Test seam: inject a local key set so the tests need no network. */
export function __setKeySetForTests(fn: JWTVerifyGetKey | null): void {
  keySet = fn;
  keySetAt = fn ? Date.now() : 0;
}

/** One of the reasons a request was refused. Logged; never the token. */
type Reason =
  | "no_app_id_configured"
  | "missing_header"
  | "malformed_header"
  | "verify_failed"
  | "claims_invalid"
  | "app_id_mismatch"
  | "dev_environment_refused"
  | "keys_unavailable";

function refuse(res: Response, status: number, reason: Reason, req: Request): void {
  // The reason code only. Never the token, never the header, never the claims.
  req.log?.warn({ reason }, "Forge token refused");
  res.status(status).json({ error: status === 503 ? "Service unavailable" : "Unauthorized" });
}

/**
 * Whether a JWKS failure is "Atlassian unreachable" rather than "bad token".
 *
 * These two must not collapse together: a network blip answering 401 would
 * tell the panel its link is broken, and a bad signature answering 503 would
 * invite a retry loop.
 *
 * Every jose failure carries an `ERR_*` code, so an error WITHOUT one came
 * from the fetch itself and is an outage. A timeout is an outage too. An
 * unknown key id is NOT: jose has already refetched the key set once by the
 * time it raises that, so the key genuinely is not Atlassian's and the token
 * is bad.
 */
function isKeyFetchFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "ERR_JWKS_TIMEOUT") return true;
  return typeof code !== "string";
}

export function forgeAuth() {
  return async function forgeAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const appId = process.env.FORGE_APP_ID;
    // Fail closed. An unconfigured app id means we cannot check the audience,
    // and a middleware that cannot check the audience must not pass anything.
    if (!appId) {
      refuse(res, 503, "no_app_id_configured", req);
      return;
    }

    const header = req.headers.authorization;
    if (!header) {
      refuse(res, 401, "missing_header", req);
      return;
    }
    const match = /^Bearer (.+)$/i.exec(header.trim());
    if (!match?.[1]) {
      refuse(res, 401, "malformed_header", req);
      return;
    }

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(match[1], jwks(), {
        issuer: ISSUER,
        audience: appId,
        algorithms: [...ALGORITHMS],
      });
      payload = verified.payload;
    } catch (err) {
      // No cached key and Atlassian unreachable is an outage, not a refusal.
      if (isKeyFetchFailure(err)) {
        refuse(res, 503, "keys_unavailable", req);
        return;
      }
      refuse(res, 401, "verify_failed", req);
      return;
    }

    const claims = FitClaims.safeParse(payload);
    if (!claims.success) {
      refuse(res, 401, "claims_invalid", req);
      return;
    }

    // The audience check above already pinned this, but Atlassian's own
    // guidance is to confirm app.id against a trusted source rather than
    // trust the token's word for which app it is.
    if (claims.data.app.id !== appId) {
      refuse(res, 401, "app_id_mismatch", req);
      return;
    }

    const installationId = claims.data.app.installationId ?? claims.data.app.installation?.id;
    const cloudId = claims.data.context?.cloudId;
    const accountId = claims.data.principal;
    if (!installationId || !cloudId || !accountId) {
      refuse(res, 401, "claims_invalid", req);
      return;
    }

    const environment = (claims.data.app.environment?.type ?? "PRODUCTION").toUpperCase();
    // A development-environment token is a real signed token, so nothing but
    // this check stops a developer install from reading production data.
    if (environment !== "PRODUCTION" && process.env.NODE_ENV === "production" && process.env.ALLOW_FORGE_DEV_ENV !== "true") {
      refuse(res, 401, "dev_environment_refused", req);
      return;
    }

    req.forge = {
      installationId,
      cloudId,
      environment,
      accountId,
      siteUrl: normalizeSiteUrl(claims.data.context?.siteUrl),
    };
    next();
  };
}
