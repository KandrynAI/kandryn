import { and, eq } from "drizzle-orm";
import {
  db,
  runsTable,
  projectsTable,
  aegisOverridesTable,
  type AegisOverride,
  type PersistedAegisFinding,
} from "@workspace/db";
import { RunError } from "./runService.js";
import { getRunRepository } from "./repoResolver.js";
import { getConfigs } from "./configService.js";
import { postSecurityStatus } from "./gitService.js";
import { canAdminister } from "./resourceAdmin.js";
import { logger } from "../lib/logger.js";

/**
 * Override a blocked Aegis security gate.
 *
 * Worth being precise about what this does, because the gate is not what it
 * looks like. Aegis runs POST-commit — the commit and PR already exist by the
 * time a gate decision is made. Kandryn itself blocks nothing; the block is the
 * GitHub commit status `blue-mantis/security` set to `failure`, enforced by the
 * repo's branch protection. So an override only has an external effect if it
 * re-posts that status as success. Where it can't (Azure Repos, no token) the
 * override is still recorded, but `statusReposted` is false and callers must
 * not claim the merge was unblocked.
 *
 * Segregation of duties: the actor may not be the run's trigger when the
 * project has `require_second_approver` on. With it off, a self-override is
 * permitted — a sole operator has no second admin — but it is recorded with
 * `sameActor: true` and surfaced in admin reporting.
 */

export interface OverrideActor {
  userId: string;
  teamId: number | null;
  teamRole: string | null;
}

export interface OverrideResult {
  override: AegisOverride;
  /** True only when the GitHub check actually flipped to success. */
  statusReposted: boolean;
  /** True when the actor also triggered the run (permitted, but recorded). */
  sameActor: boolean;
}

/** Preflight answer for the run-detail UI: may this caller override, and if not, why. */
export interface OverridePolicy {
  /** projects.require_second_approver as it stands right now. */
  requireSecondApprover: boolean;
  /** Is the caller the person who triggered this run? Null = unknown (legacy run). */
  sameActor: boolean | null;
  canOverride: boolean;
  /** Plain-language reason the caller cannot override. Null when they can. */
  blockedReason: string | null;
}

interface OverrideContext {
  run: typeof runsTable.$inferSelect;
  teamId: number | null;
  requireSecondApprover: boolean;
  triggeredBy: string | null;
  sameActor: boolean | null;
}

/**
 * Load the run and everything the override rules depend on, enforcing the same
 * owner-or-team-member access rule as `GET /runs/:id`. Being a team admin does
 * not grant access to another team's run.
 */
async function loadContext(runId: number, actor: OverrideActor): Promise<OverrideContext> {
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) throw new RunError("Run not found", 404);

  const [proj] = run.projectId
    ? await db
        .select({
          teamId: projectsTable.teamId,
          requireSecondApprover: projectsTable.requireSecondApprover,
        })
        .from(projectsTable)
        .where(eq(projectsTable.id, run.projectId))
    : [];

  if (run.userId !== actor.userId) {
    const isTeamProject = actor.teamId != null && proj?.teamId === actor.teamId;
    if (!isTeamProject) throw new RunError("Access denied.", 403);
  }

  // runs.run_by_user_id is null on runs predating 0032; fall back to the owner
  // so a self-override is still detected where it can be.
  const triggeredBy = run.runByUserId ?? run.userId ?? null;
  return {
    run,
    teamId: proj?.teamId ?? null,
    requireSecondApprover: proj?.requireSecondApprover ?? false,
    triggeredBy,
    sameActor: triggeredBy != null ? triggeredBy === actor.userId : null,
  };
}

/**
 * The one place the override rules live. `overrideSecurityGate` enforces exactly
 * what this reports, so the button the UI shows and the answer the API gives can
 * never drift apart — which for a security control matters more than the usual
 * don't-abstract-early rule.
 */
function evaluatePolicy(ctx: OverrideContext, actor: OverrideActor): OverridePolicy {
  const base = {
    requireSecondApprover: ctx.requireSecondApprover,
    sameActor: ctx.sameActor,
  };
  const deny = (blockedReason: string): OverridePolicy => ({ ...base, canOverride: false, blockedReason });

  // Admin OF THIS RUN'S TEAM — not merely an admin somewhere. On a personal
  // project (no team) the owner administers it: there is no second admin to
  // escalate to, and locking the only responsible party out of their own gate
  // would leave them no path at all.
  if (!canAdminister(actor, { ownerUserId: ctx.run.userId, teamId: ctx.teamId })) {
    return deny(
      ctx.teamId != null
        ? "Only an admin of this project's team can clear a security gate. Ask an admin on your team to review this run."
        : "Only the owner of this project can clear its security gate.",
    );
  }
  if (ctx.run.securityGate !== "blocked") {
    return deny(
      ctx.run.securityGate == null
        ? "This run has no Aegis scan to override. Run the security scan first."
        : `This run's security gate is '${ctx.run.securityGate}', not blocked. There is nothing to override.`,
    );
  }
  if (ctx.requireSecondApprover) {
    if (ctx.sameActor === true) {
      return deny("You triggered this run, so you cannot clear its security gate. This project requires a second approver.");
    }
    if (ctx.sameActor === null) {
      // Unlike approvePlan's allow-with-log, deny: a security override is
      // higher-stakes, and "we couldn't tell who triggered it" is not a basis
      // for waiving the rule the project explicitly opted into.
      return deny(
        "This run predates trigger attribution, so segregation of duties cannot be verified. It cannot be overridden while this project requires a second approver.",
      );
    }
  }
  return { ...base, canOverride: true, blockedReason: null };
}

/** Preflight for the UI. Readable by any team member; only admins get `canOverride`. */
export async function getOverridePolicy(runId: number, actor: OverrideActor): Promise<OverridePolicy> {
  return evaluatePolicy(await loadContext(runId, actor), actor);
}

export async function overrideSecurityGate(
  runId: number,
  reason: string,
  actor: OverrideActor,
): Promise<OverrideResult> {
  // Mandatory reason. Trimmed, so whitespace-only is rejected here as well as
  // by the route's Zod schema and the column CHECK — three layers because a
  // blank justification makes the whole record worthless.
  const cleanReason = reason.trim();
  if (!cleanReason) throw new RunError("A reason is required to override a security gate.", 400);

  const ctx = await loadContext(runId, actor);
  const { run, sameActor, triggeredBy } = ctx;

  const policy = evaluatePolicy(ctx, actor);
  if (!policy.canOverride) {
    // A gate that isn't blocked is a state conflict; everything else is a
    // permission the caller does not have.
    throw new RunError(policy.blockedReason!, run.securityGate !== "blocked" ? 409 : 403);
  }

  // Freeze the findings now. runs.security_scan is overwritten on re-scan, so a
  // reference would not survive; this snapshot is the record.
  const scan = run.securityScan;
  const blocking: PersistedAegisFinding[] = (scan?.findings ?? []).filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  const unscanned = scan?.unscannedFiles ?? [];

  const [override] = await db
    .insert(aegisOverridesTable)
    .values({
      runId,
      suggestionId: run.committedSuggestionId ?? null,
      projectId: run.projectId ?? null,
      teamId: ctx.teamId ?? actor.teamId ?? null,
      overriddenBy: actor.userId,
      triggeredBy,
      sameActor,
      secondApproverRequired: ctx.requireSecondApprover,
      reason: cleanReason,
      gateReason: scan?.gateReason ?? null,
      findingsSnapshot: blocking,
      criticalCount: scan?.criticalCount ?? 0,
      highCount: scan?.highCount ?? 0,
      unscannedCount: unscanned.length,
      unscannedFiles: unscanned,
      statusReposted: false,
    })
    .returning();

  // Flip the GitHub check. Best-effort by design — postSecurityStatus swallows
  // non-GitHub repos, missing tokens and API errors — so record what actually
  // happened rather than assuming success.
  let statusReposted = false;
  try {
    const repo = await getRunRepository(run);
    if (repo?.url && run.commitHash) {
      const creds = await getConfigs(actor.userId, ["GITHUB_TOKEN"]);
      if (creds.GITHUB_TOKEN && /github\.com/.test(repo.url)) {
        await postSecurityStatus(
          repo.url,
          run.commitHash,
          "approved",
          `Security gate overridden by an admin: ${cleanReason}`.slice(0, 140),
          creds.GITHUB_TOKEN,
        );
        statusReposted = true;
      }
    }
  } catch (err) {
    // Never fail the override on a status-post problem: the governance record
    // is the primary artifact and it is already committed.
    logger.warn({ runId, err }, "Aegis override: re-posting the GitHub status failed");
  }

  if (statusReposted) {
    await db
      .update(aegisOverridesTable)
      .set({ statusReposted: true })
      .where(eq(aegisOverridesTable.id, override.id));
  }

  await db
    .update(runsTable)
    .set({ securityGate: "approved" })
    .where(and(eq(runsTable.id, runId), eq(runsTable.securityGate, "blocked")));

  return { override: { ...override, statusReposted }, statusReposted, sameActor: sameActor === true };
}

/** Overrides recorded against a run, newest first. Drives the run-detail banner. */
export async function listOverridesForRun(runId: number): Promise<AegisOverride[]> {
  return db
    .select()
    .from(aegisOverridesTable)
    .where(eq(aegisOverridesTable.runId, runId))
    .orderBy(aegisOverridesTable.createdAt);
}
