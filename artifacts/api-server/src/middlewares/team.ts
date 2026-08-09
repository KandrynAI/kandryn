import type { Request, Response, NextFunction } from "express";
import { getTeamForUser } from "../services/teamService.js";
import type { TeamRole } from "../../../../shared/types/team.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      teamId?: number | null;
      teamRole?: TeamRole | null;
    }
  }
}

/**
 * Attach the caller's primary team + role to the request. Runs after requireAuth
 * so req.userId is set. Non-fatal: a lookup failure leaves teamId/teamRole null
 * rather than 500-ing every request.
 */
export async function attachTeam(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    next();
    return;
  }
  try {
    const membership = await getTeamForUser(req.userId);
    req.teamId = membership?.team.id ?? null;
    req.teamRole = membership?.role ?? null;
  } catch (err) {
    req.log?.warn?.({ err }, "attachTeam: team lookup failed");
    req.teamId = null;
    req.teamRole = null;
  }
  next();
}

/** Gate a route to team admins. Requires attachTeam to have run first. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.teamRole !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
}
