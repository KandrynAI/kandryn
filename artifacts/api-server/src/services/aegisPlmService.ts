import { and, eq } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import { createPlmWorkItem, type PlmProvider } from "./plmWrite.js";
import { logger } from "../lib/logger.js";
import type { AegisFinding } from "../../../../shared/types/aegisResult.js";

export interface AegisTicketInput {
  finding: AegisFinding;
  parentExternalId: string; // the original work item's PLM key (e.g. "PAY-214")
  parentTitle: string;
  plmProvider: PlmProvider;
  plmProjectKey: string | null;
  userId: string;
  projectId: number;
  repositoryId: number | null;
  parentTaskId?: number | null; // internal id of the original work item
}

export interface AegisTicketResult {
  ticketUrl: string;
  ticketKey: string;
  internalTaskId: number;
}

function findingTaskFields(finding: AegisFinding) {
  const title = `[SECURITY] ${finding.severity.toUpperCase()}: ${finding.title}`.slice(0, 200);
  const description = `${finding.detail}\n\nRemediation: ${finding.remediation}`;
  const acceptanceCriteria = [
    `Fix: ${finding.remediation}`,
    `OWASP: ${finding.owasp}`,
    `Severity: ${finding.severity}`,
    finding.lineRef ? `Location: ${finding.lineRef}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { title, description, acceptanceCriteria };
}

/**
 * Ensure a Blue Mantis task exists for a PLM-filed finding (mirrored as a
 * `bug`, keyed on project_id + external_id so a later PLM sync upserts rather
 * than duplicates). Returns the internal task id. Select-first — no unique
 * constraint on (project_id, external_id) to rely on.
 */
export async function ensureFindingTask(input: {
  userId: string;
  projectId: number;
  repositoryId: number | null;
  parentTaskId?: number | null;
  finding: AegisFinding;
  ticketKey: string;
  ticketUrl: string;
  plmProvider: PlmProvider;
}): Promise<number> {
  const [existing] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.userId, input.userId),
        eq(tasksTable.projectId, input.projectId),
        eq(tasksTable.externalId, input.ticketKey),
      ),
    );
  if (existing) return existing.id;

  const { title, description, acceptanceCriteria } = findingTaskFields(input.finding);
  const [task] = await db
    .insert(tasksTable)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      repositoryId: input.repositoryId,
      externalId: input.ticketKey,
      source: input.plmProvider,
      type: "bug",
      itemType: "bug",
      title,
      description,
      acceptanceCriteria,
      priority: input.finding.severity === "critical" || input.finding.severity === "high" ? "high" : "medium",
      status: "open",
      parentId: input.parentTaskId ?? null,
      plmUrl: input.ticketUrl,
      plmStatus: "open",
    })
    .returning();
  return task.id;
}

/**
 * Create a PLM child work item for an Aegis finding (linked to the original work
 * item), then mirror it as a Blue Mantis task so a remediation run can be
 * created against it. Never throws: logs and returns null on any failure.
 */
export async function createAegisPlmTicket(
  input: AegisTicketInput,
): Promise<AegisTicketResult | null> {
  const { title, description } = findingTaskFields(input.finding);

  try {
    const result = await createPlmWorkItem(
      input.userId,
      { plmProvider: input.plmProvider, plmProjectKey: input.plmProjectKey },
      { itemType: "bug", title, description, parentExternalId: input.parentExternalId || null },
    );
    const internalTaskId = await ensureFindingTask({
      userId: input.userId,
      projectId: input.projectId,
      repositoryId: input.repositoryId,
      parentTaskId: input.parentTaskId,
      finding: input.finding,
      ticketKey: result.externalId,
      ticketUrl: result.plmUrl,
      plmProvider: input.plmProvider,
    });
    return { ticketUrl: result.plmUrl, ticketKey: result.externalId, internalTaskId };
  } catch (err) {
    logger.warn({ err, findingId: input.finding.id }, "Aegis PLM ticket creation failed");
    return null;
  }
}

/** Refinement prompt for a remediation run — fix ONLY the security finding. */
export function buildRemediationPrompt(finding: AegisFinding): string {
  return [
    "This is a security remediation task.",
    "",
    `Original finding: ${finding.title}`,
    `OWASP category: ${finding.owasp}`,
    `Severity: ${finding.severity.toUpperCase()}`,
    finding.lineRef ? `Location: ${finding.lineRef}` : "",
    "",
    `Issue: ${finding.detail}`,
    "",
    `Required fix: ${finding.remediation}`,
    "",
    "Focus ONLY on fixing this specific security issue.",
    "Do not change anything else in the file.",
    "Apply surgical changes strictly — every changed line must",
    "directly address the security finding above.",
  ].join("\n");
}
