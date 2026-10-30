import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import { forgeAuth } from "../middlewares/forgeAuth.js";
import { canUseJiraApp } from "../services/jiraExt/entitlement.js";
import {
  auditInstallationRegistered,
  disableInstallation,
  ensureInstallation,
  rateLimited,
} from "../services/jiraExt/installations.js";
import { linkedUser, startLink } from "../services/jiraExt/linking.js";
import { buildIssueView } from "../services/jiraExt/issueView.js";

/**
 * The Jira panel's API (0043, phase 1) — mounted at /api/ext/jira/v1.
 *
 * These routes are reached by Atlassian, not a browser: there is no Clerk
 * session, no cookie and no CORS to satisfy. `forgeAuth` is the only thing
 * that says who is calling, and the panel's identity cannot be asserted by
 * the panel — installation, Jira user and site all come out of the signed
 * token.
 *
 * Versioned in the path from the start, so a later panel can change the
 * contract without breaking the panels already installed on customer sites.
 *
 * Phase 1 is READ-ONLY. Nothing here writes to Jira and nothing starts work.
 */

const router: IRouter = Router();

/**
 * The kill switch, first in the chain.
 *
 * Before the token is read and before any database call, so the feature can
 * be turned off in Vercel's environment without deploying code and without
 * the ext routes touching anything on the way out.
 */
function killSwitch(_req: Request, res: Response, next: NextFunction): void {
  if (process.env.JIRA_EXT_ENABLED === "false") {
    res.status(503).json({ error: "Service unavailable" });
    return;
  }
  next();
}

const appBaseUrl = (): string => process.env.APP_BASE_URL ?? "https://app.kandryn.com";

/** Per-installation and per-account limits. In memory, so per instance. */
function limited(req: Request, res: Response): boolean {
  const f = req.forge;
  if (!f) return false;
  if (
    rateLimited(`jira:inst:${f.installationId}`, 600, 60 * 1000) ||
    rateLimited(`jira:acct:${f.accountId}`, 120, 60 * 1000)
  ) {
    res.status(429).json({ error: "Too many requests" });
    return true;
  }
  return false;
}

/**
 * Register the installation and refuse a disabled one.
 *
 * An installation Kandryn has never seen is created on its first verified
 * call: the lifecycle event is a convenience, not a precondition, so a site
 * whose install event was missed still works.
 */
async function withInstallation(req: Request, res: Response, next: NextFunction): Promise<void> {
  const forge = req.forge;
  if (!forge) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { installation, created } = await ensureInstallation(forge);
  if (created) auditInstallationRegistered(forge, installation.id);
  if (installation.status === "disabled") {
    res.status(403).json({ error: "installation_disabled" });
    return;
  }
  (req as Request & { installationRowId: number }).installationRowId = installation.id;
  next();
}

const chain = [killSwitch, forgeAuth(), withInstallation] as const;

// ---------------------------------------------------------------------------
// POST /link/start — mint a code for this Jira identity
// ---------------------------------------------------------------------------

router.post("/ext/jira/v1/link/start", ...chain, async (req, res): Promise<void> => {
  if (limited(req, res)) return;
  const forge = req.forge!;
  const installationRowId = (req as Request & { installationRowId: number }).installationRowId;

  const started = await startLink(installationRowId, forge.accountId);
  if ("rateLimited" in started) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({
    code: started.code,
    expiresInSeconds: started.expiresInSeconds,
    // No code in this URL, by design. The person types what the panel shows.
    pageUrl: `${appBaseUrl().replace(/\/$/, "")}/integrations/jira/link`,
  });
});

// ---------------------------------------------------------------------------
// GET /issue — what Kandryn knows about one Jira issue
// ---------------------------------------------------------------------------

const IssueQuery = z.object({
  key: z.string().max(40).regex(/^[A-Z][A-Z0-9_]+-\d+$/),
  // Accepted and validated but unused: Kandryn stores the Jira key, not the
  // numeric id, so matching is by key in phase 1. Taking the parameter now
  // means the panel's contract does not change when that is fixed.
  issueId: z.string().max(20).regex(/^\d+$/).optional(),
});

router.get("/ext/jira/v1/issue", ...chain, async (req, res): Promise<void> => {
  if (limited(req, res)) return;
  const forge = req.forge!;
  const installationRowId = (req as Request & { installationRowId: number }).installationRowId;

  const parsed = IssueQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid issue key" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  const userId = await linkedUser(installationRowId, forge.accountId);
  if (!userId) {
    res.json({ state: "not_linked" });
    return;
  }
  if (!(await canUseJiraApp(userId))) {
    res.json({ state: "not_linked" });
    return;
  }

  // The site comes from the token's signed claim. A site the token did not
  // name cannot be matched, and the panel is told the issue is not imported
  // rather than being given an error to show.
  const siteUrl = forge.siteUrl;
  if (!siteUrl) {
    res.json({ state: "not_in_kandryn", projectHint: null });
    return;
  }

  const view = await buildIssueView({ userId, siteUrl, key: parsed.data.key, appBaseUrl: appBaseUrl() });
  res.json(view);
});

// ---------------------------------------------------------------------------
// POST /lifecycle/uninstalled — the preUninstall module's endpoint
// ---------------------------------------------------------------------------

/**
 * Must answer inside 5 seconds and be safe to receive up to four times.
 *
 * Verified like any other call, so an unauthenticated POST cannot disable a
 * customer's installation. It does NOT go through `withInstallation`: an
 * uninstall for an installation we never saw is a no-op, not a registration.
 */
router.post("/ext/jira/v1/lifecycle/uninstalled", killSwitch, forgeAuth(), async (req, res): Promise<void> => {
  const forge = req.forge!;
  await disableInstallation(forge.installationId);
  res.status(204).end();
});

export default router;
