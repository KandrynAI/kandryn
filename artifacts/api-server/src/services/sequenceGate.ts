import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  sequenceChecksTable,
  sequenceOverridesTable,
  runsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import * as audit from "./auditService.js";
import { sendRunHeld } from "./emailService.js";
import { logger } from "../lib/logger.js";
import { computeCheck, persistCheck, type SequenceActor, type ComputedCheck } from "./sequenceService.js";
import { buildImpact } from "./sequenceImpactService.js";
import { deterministicImpact } from "./sequenceImpact.js";
import { computeRecordHash, type HashableOverride } from "./sequenceRecordHash.js";
import { verdictFrom, computeFingerprint } from "./sequenceGraph.js";
import {
  MIN_OVERRIDE_REASON_LENGTH,
  OVERRIDE_NOT_PERMITTED,
  SEQUENCE_CHECK_REQUIRED,
  SEQUENCE_STALE,
  type ImpactAnalysis,
  type OverrideReasonCategory,
  type SequenceCheck,
} from "../../../../shared/types/sequence.js";

/**
 * The run-order gate on a run request.
 *
 * One module because the rules must not drift between the places that enforce
 * them: the interactive run endpoint and the cron dispatcher ask the same
 * question and have to get the same answer. The server recomputes the check
 * here every time and ignores whatever verdict the client sent — the dialog is
 * a convenience, not the control.
 */

/** What the client sends to confirm it is overriding deliberately. */
export interface SequenceBlock {
  checkId: number;
  decision: "override";
  reasonCategory: OverrideReasonCategory;
  reasonText?: string;
  acknowledgedFindingIds: string[];
  acknowledgedImpact: boolean;
}

export type GateResult =
  /** Nothing in the way; start the run as normal and write no extra rows. */
  | { outcome: "proceed" }
  /** Refuse, with a fresh check for the dialog to render. */
  | { outcome: "reject"; status: number; code: string; message: string; check: SequenceCheck }
  /** Authorised. The caller inserts `override` in the same transaction as the run. */
  | { outcome: "override"; check: SequenceCheck; override: OverrideDraft; impact: ImpactAnalysis };

/** Every column of the decision row except the ones the database assigns. */
export interface OverrideDraft extends HashableOverride {
  recordHash: string;
}

export async function evaluateGate(args: {
  workItemId: number;
  actor: SequenceActor;
  sequence?: SequenceBlock;
  /** Set when the run being authorised is scheduled rather than immediate. */
  scheduledAt?: Date | null;
  ipAddress?: string;
  userAgent?: string;
}): Promise<GateResult> {
  const { workItemId, actor, sequence, scheduledAt, ipAddress, userAgent } = args;

  // 1. Recompute. The client's verdict is never trusted.
  const computed = await computeCheck(workItemId, actor);
  const verdict = verdictFrom(computed.findings);

  // 2. Clear: proceed exactly as before, leaving no snapshot behind.
  if (verdict === "clear") return { outcome: "proceed" };

  const reject = async (status: number, code: string, message: string): Promise<GateResult> => ({
    outcome: "reject",
    status,
    code,
    message,
    // Persisted so the dialog has a checkId to request the impact with.
    check: await persistCheck(computed, actor),
  });

  // 3. Not clear and the client did not acknowledge anything.
  if (!sequence || sequence.decision !== "override") {
    return reject(409, SEQUENCE_CHECK_REQUIRED, "This work item may need other work first.");
  }

  // 4. Policy forbids this caller from overriding at all.
  if (!computed.canOverride) {
    return reject(
      403,
      OVERRIDE_NOT_PERMITTED,
      "Your team policy requires an admin to override the run order.",
    );
  }

  // 5. Is the client answering the situation that exists right now? Three ways
  //    it might not be: the stored check expired, the world moved since it was
  //    taken, or the acknowledgement does not cover every current finding.
  const stale = await isStale(sequence, computed, actor);
  if (stale) return reject(409, SEQUENCE_STALE, stale);

  // 6. A warning needs a reason in the user's own words. Cautions do not.
  const hasWarning = computed.findings.some((f) => f.severity === "warning");
  const reasonText = sequence.reasonText?.trim() || null;
  if (hasWarning && (!reasonText || reasonText.length < MIN_OVERRIDE_REASON_LENGTH)) {
    return {
      outcome: "reject",
      status: 400,
      code: "REASON_REQUIRED",
      message: `Describe why you are running this out of order, in at least ${MIN_OVERRIDE_REASON_LENGTH} characters.`,
      check: await persistCheck(computed, actor),
    };
  }

  // 7. The impact must have been acknowledged, explicitly.
  if (sequence.acknowledgedImpact !== true) {
    return {
      outcome: "reject",
      status: 400,
      code: "IMPACT_NOT_ACKNOWLEDGED",
      message: "Confirm you have read the impact before running this out of order.",
      check: await persistCheck(computed, actor),
    };
  }

  // 8. The impact the user actually saw. Cached on their check; falls back to
  //    the deterministic assessment if it was never opened or cannot be built,
  //    so the record always holds something rather than nothing.
  const itemKey = computed.item.externalId ?? `#${computed.item.id}`;
  let impact: ImpactAnalysis;
  try {
    impact = await buildImpact(sequence.checkId, actor);
  } catch {
    impact = deterministicImpact(computed.findings, itemKey);
  }

  const check = await persistCheck(computed, actor);

  const hashable: HashableOverride = {
    userId: actor.userId,
    teamId: computed.project.teamId,
    // The role held at decision time. A later demotion must not rewrite the
    // authority the decision was made under.
    userRole: actor.teamRole ?? (computed.project.teamId == null ? "owner" : "member"),
    workItemKey: itemKey,
    workItemTitle: computed.item.title,
    verdictAtDecision: verdict,
    findingsAcknowledged: computed.findings,
    impactShown: impact,
    impactSource: impact.source,
    impactModel: impact.model ?? null,
    reasonCategory: sequence.reasonCategory,
    reasonText,
    acknowledgedImpact: true,
    policySnapshot: { policy: computed.policy, canOverride: computed.canOverride },
    scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  };

  return {
    outcome: "override",
    check,
    impact,
    override: { ...hashable, recordHash: computeRecordHash(hashable) },
  };
}

/**
 * Whether the acknowledgement answers the world as it stands. Returns the
 * reason it does not, or null.
 *
 * The fingerprint comparison is what catches a blocker completing — or a new
 * one appearing — while the dialog sat open. Acknowledging findings that are
 * no longer the findings is not consent to anything.
 */
async function isStale(
  sequence: SequenceBlock,
  computed: ComputedCheck,
  actor: SequenceActor,
): Promise<string | null> {
  const [stored] = await db
    .select()
    .from(sequenceChecksTable)
    .where(and(eq(sequenceChecksTable.id, sequence.checkId), eq(sequenceChecksTable.userId, actor.userId)));

  if (!stored) return "That run-order check no longer exists. Review the current one.";
  if (stored.workItemId !== computed.item.id) return "That run-order check belongs to a different work item.";
  if (stored.expiresAt.getTime() < Date.now()) {
    return "That run-order check has expired. Review the current one.";
  }

  const currentIds = computed.findings.map((f) => f.id);
  if (computeFingerprint(currentIds) !== stored.fingerprint) {
    return "Things changed while this was open. Review again.";
  }

  const acknowledged = new Set(sequence.acknowledgedFindingIds);
  if (currentIds.some((id) => !acknowledged.has(id))) {
    return "Not every finding was acknowledged. Review again.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Scheduled dispatch
// ---------------------------------------------------------------------------

/**
 * Re-check a scheduled run just before it starts, and hold it if the order
 * changed underneath it.
 *
 * A scheduled run is unattended, and the gap between scheduling and firing is
 * exactly where a new blocker appears. Acknowledging yesterday's findings is
 * not consent to today's, so anything newly warning that the scheduling user
 * never saw stops the run rather than starting it. Cautions do not hold: they
 * were advisory when the run was scheduled and they still are.
 *
 * Returns true when the run was held. Never throws — a failure here lets the
 * run proceed, because a dispatcher that crashes on its own safety check
 * stops every run in the batch, which is worse than missing one hold.
 */
export async function holdIfOrderChanged(runId: number): Promise<boolean> {
  try {
    const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
    if (!run) return false;

    const [project] = run.projectId
      ? await db.select().from(projectsTable).where(eq(projectsTable.id, run.projectId))
      : [];

    const computed = await computeCheck(run.workItemId, {
      userId: run.userId,
      teamId: project?.teamId ?? null,
      teamRole: null,
    });

    const warnings = computed.findings.filter((f) => f.severity === "warning");
    if (warnings.length === 0) return false;

    // What this run's own override, if it had one, already covered.
    const [override] = await db
      .select({ findings: sequenceOverridesTable.findingsAcknowledged })
      .from(sequenceOverridesTable)
      .where(eq(sequenceOverridesTable.runId, runId));
    const acknowledged = new Set((override?.findings ?? []).map((f) => f.id));

    const unacknowledged = warnings.filter((f) => !acknowledged.has(f.id));
    if (unacknowledged.length === 0) return false;

    await db.update(runsTable).set({ status: "held", finishedAt: new Date() }).where(eq(runsTable.id, runId));

    audit.log({
      userId: run.runByUserId ?? run.userId,
      teamId: project?.teamId ?? null,
      action: "sequence.run_held",
      entityType: "run",
      entityId: runId,
      metadata: {
        workItemId: run.workItemId,
        newFindingIds: unacknowledged.map((f) => f.id),
        newFindingTypes: unacknowledged.map((f) => f.type),
      },
    });

    const [workItem] = await db.select().from(tasksTable).where(eq(tasksTable.id, run.workItemId));
    const email = await primaryEmailFor(run.runByUserId ?? run.userId);
    if (email && workItem) {
      await sendRunHeld(email, {
        itemTitle: workItem.title,
        itemKey: workItem.externalId,
        runId,
        newFindings: unacknowledged.map((f) => f.summary),
      }).catch((err) => logger.warn({ runId, err }, "Run-held email failed"));
    }

    logger.info({ runId, newFindings: unacknowledged.length }, "Scheduled run held — run order changed");
    return true;
  } catch (err) {
    logger.error({ runId, err }, "Run-order re-check failed — letting the run proceed");
    return false;
  }
}

async function primaryEmailFor(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * Record how a run that was authorised by an override actually turned out.
 *
 * Fire-and-forget, and an audit entry rather than a column, because the
 * decision row is immutable by design: "did overriding cause trouble" has to
 * be answerable without ever rewriting what was decided. A no-op for runs
 * nobody overrode, which is almost all of them.
 */
export function recordOverrideOutcome(
  runId: number,
  outcome: "committed" | "failed" | "canceled",
  extra?: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const [override] = await db
        .select({ id: sequenceOverridesTable.id, userId: sequenceOverridesTable.userId, teamId: sequenceOverridesTable.teamId })
        .from(sequenceOverridesTable)
        .where(eq(sequenceOverridesTable.runId, runId));
      if (!override) return;

      audit.log({
        userId: override.userId,
        teamId: override.teamId,
        action: "sequence.override_outcome",
        entityType: "run",
        entityId: runId,
        metadata: { overrideId: override.id, outcome, ...extra },
      });
    } catch (err) {
      logger.warn({ runId, err }, "Recording the override outcome failed");
    }
  })();
}
