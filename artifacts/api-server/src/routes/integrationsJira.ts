import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { canUseJiraApp } from "../services/jiraExt/entitlement.js";
import { completeLink, listLinks, revokeLink } from "../services/jiraExt/linking.js";

/**
 * The Kandryn-side half of Jira account linking (0043).
 *
 * These are ordinary authenticated routes: a signed-in Kandryn user typing a
 * code they read in their own Jira panel. They are deliberately separate from
 * `/api/ext/jira/*`, which is reached by Atlassian with a Forge token — the
 * two never share a middleware, so neither can be mistaken for the other.
 *
 * Mounted after `requireAuth` with the rest of the app, so `req.userId` is
 * the signed-in user and every query below is scoped to it.
 */

const router: IRouter = Router();

/**
 * One message for every failure.
 *
 * A caller must not be able to tell a wrong code from an expired one from a
 * code that never existed — the difference is exactly what a guesser wants.
 * The rate-limit case is deliberately folded in here too.
 */
const GENERIC_FAILURE = {
  error: "That code did not work. Open the Kandryn panel in Jira to get a new one.",
};

const CompleteBody = z.object({ code: z.string().min(1).max(64) });

router.post("/integrations/jira/link/complete", async (req, res): Promise<void> => {
  const parsed = CompleteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(GENERIC_FAILURE);
    return;
  }
  if (!(await canUseJiraApp(req.userId))) {
    res.status(403).json(GENERIC_FAILURE);
    return;
  }

  const result = await completeLink(req.userId, parsed.data.code);
  if (!result.ok) {
    // A conflict is the one case worth distinguishing: the person needs to
    // know the Jira account is attached elsewhere, not keep retyping a code
    // that will never work. It reveals nothing about the code itself.
    if (result.reason === "conflict") {
      res.status(409).json({
        error: "That Jira account is already connected to a different Kandryn account.",
      });
      return;
    }
    res.status(400).json(GENERIC_FAILURE);
    return;
  }

  res.json({ ok: true, siteUrl: result.siteUrl });
});

router.get("/integrations/jira/links", async (req, res): Promise<void> => {
  const links = await listLinks(req.userId);
  res.json({
    links: links.map((l) => ({ id: l.id, siteUrl: l.siteUrl, linkedAt: l.linkedAt.toISOString() })),
  });
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

router.delete("/integrations/jira/links/:id", async (req, res): Promise<void> => {
  const parsed = IdParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid link id" });
    return;
  }
  // revokeLink filters by userId, so another user's link is simply not found.
  // A 404 rather than a 403: whose link it is is not the caller's to learn.
  const revoked = await revokeLink(req.userId, parsed.data.id);
  if (!revoked) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }
  res.status(204).end();
});

export default router;
