// All valid action strings — add new ones here as features are added
export const AUDIT_ACTIONS = [
  // Auth
  'user.signed_in',
  'user.signed_out',

  // Team management
  'team.created',
  'team.updated',
  'member.invited',
  'member.joined',
  'member.removed',
  'member.role_changed',
  'invite.canceled',

  // Credentials
  'credential.set',
  'credential.deleted',
  'team_credential.set',
  'team_credential.deleted',

  // Projects
  'project.created',
  'project.updated',
  'project.deleted',
  'project.synced',
  'repository.connected',
  'repository.deleted',

  // Run pipeline
  'run.triggered',
  'run.scheduled',
  'run.canceled',
  'run.failed',
  'run.committed',
  // A suggestion committed past a failed coherence gate via explicit override.
  'run.override_committed',
  // Confidence gate (Phase 4)
  'run.plan_approved',
  'run.plan_rejected',

  // Baseline security scan (0035) — an existing codebase, no gate, no commit.
  'baseline.scan_started',
  'baseline.scan_completed',
  'baseline.finding_acknowledged',
  'baseline.findings_pushed',

  // Change plan (Phase 2)
  'plan.generated',
  'plan.edited',
  'plan.file_removed',
  'plan.file_added',
  'plan.regenerated',
  'plan.failed',

  // Post-commit agents
  'veria.review_run',
  'aegis.scan_run',
  'aegis.finding_pushed',
  'aegis.remediation_started',
  // A blocked Aegis security gate cleared by an admin with a mandatory reason.
  'aegis.gate_overridden',
  'narratia.runbook_generated',
  'narratia.runbook_pushed',

  // Tests
  'tests.generated',
  'tests.committed',
  'tests.pushed_to_plm',
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

export interface AuditLogEntry {
  id: number;
  teamId: number | null;
  userId: string;
  action: AuditAction;
  entityType: string | null;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// What the API returns (with display-friendly fields)
export interface AuditLogRow extends AuditLogEntry {
  userEmail?: string; // populated from Clerk if available
  actionLabel: string; // human-readable: "Run committed"
  entityLabel?: string; // e.g. "PAY-214 · Idempotency keys"
}

// Plan-based retention in days
export const AUDIT_RETENTION_DAYS: Record<string, number> = {
  free: 30,
  pro: 90,
  max: 90,
  enterprise: 365,
};
