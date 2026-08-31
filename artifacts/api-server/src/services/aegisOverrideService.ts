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

  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) throw new RunError("Run not found", 404);

  // Only a genuinely blocked gate can be overridden. Overriding an approved or
  // unscanned run would put a meaningless record in the audit trail.
  if (run.securityGate !== "blocked") {
    throw new RunError(
      run.securityGate == null
        ? "This run has no Aegis scan to override. Run the security scan first."
        : `This run's security gate is '${run.securityGate}', not blocked. There is nothing to override.`,
      409,
    );
  }

  const [proj] = run.projectId
    ? await db
        .select({
          teamId: projectsTable.teamId,
          requireSecondApprover: projectsTable.requireSecondApprover,
        })
        .from(projectsTable)
        .where(eq(projectsTable.id, run.projectId))
    : [];
  const requireSecond = proj?.requireSecondApprover ?? false;

  // runs.run_by_user_id is null on runs predating 0032; fall back to the owner
  // so a self-override is still detected where it can be.
  const triggeredBy = run.runByUserId ?? run.userId ?? null;
  const sameActor = triggeredBy != null ? triggeredBy === actor.userId : null;

  // The segregation-of-duties rule, gated on the project's own toggle.
  if (requireSecond) {
    if (sameActor === true) {
      throw new RunError(
        "You triggered this run, so you cannot clear its security gate. This project requires a second approver.",
        403,
      );
    }
    if (sameActor === null) {
      // Unlike approvePlan's allow-with-log, deny: a security override is
      // higher-stakes, and "we couldn't tell who triggered it" is not a basis
      // for waiving the rule the project explicitly opted into.
      throw new RunError(
        "This run predates trigger attribution, so segregation of duties cannot be verified. It cannot be overridden while this project requires a second approver.",
        403,
      );
    }
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
      teamId: proj?.teamId ?? actor.teamId ?? null,
      overriddenBy: actor.userId,
      triggeredBy,
      sameActor,
      secondApproverRequired: requireSecond,
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
