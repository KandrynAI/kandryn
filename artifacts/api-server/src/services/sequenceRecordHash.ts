/**
 * The integrity hash over an override decision.
 *
 * Pure and db-free so it is testable, and because the one way this can quietly
 * fail is a hash that does not reproduce: if the canonical form is not stable,
 * every later verification reports tampering that never happened, and the
 * signal becomes noise everybody learns to ignore.
 *
 * Two things make it stable. Keys are sorted at every depth, because
 * JavaScript preserves insertion order and Postgres jsonb does not — a value
 * round-tripped through the database comes back deep-equal but differently
 * ordered, so hashing the stored form would not match hashing the form that
 * was written. And the columns a foreign key can later null are excluded,
 * since deleting a run must not invalidate the record of the decision.
 */

import { createHash } from "node:crypto";
import type { ImpactAnalysis, SequenceFinding, SequenceVerdict } from "../../../../shared/types/sequence.js";

/** JSON with every object's keys sorted, at every depth. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortDeep(src[key]);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * The content of an override that the hash covers. Deliberately excludes id,
 * created_at, and the four nullable foreign keys (run_id, work_item_id,
 * project_id, check_id): all six are assigned or cleared by the database, and
 * a cascade that nulls one must leave the hash still verifying.
 */
export interface HashableOverride {
  userId: string;
  teamId: number | null;
  userRole: string;
  workItemKey: string;
  workItemTitle: string;
  verdictAtDecision: SequenceVerdict;
  findingsAcknowledged: SequenceFinding[];
  impactShown: ImpactAnalysis;
  impactSource: "ai" | "deterministic";
  impactModel: string | null;
  reasonCategory: string;
  reasonText: string | null;
  acknowledgedImpact: boolean;
  policySnapshot: Record<string, unknown>;
  scheduledAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export function computeRecordHash(record: HashableOverride): string {
  return createHash("sha256").update(canonicalJson(record)).digest("hex");
}
