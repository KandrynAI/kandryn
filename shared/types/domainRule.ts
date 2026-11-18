/**
 * Domain context: what a project MEANS, as opposed to how it is built (0052).
 *
 * `stack_profile` is technical, the Graphify graph is structural, the UI style
 * profile is visual, and none of them carries business meaning. Run #32 is the
 * evidence this exists for: the agent had the code and the acceptance criteria
 * and still read "validate the policy exists" as "check that claims come
 * back".
 *
 * THE RISK THAT SHAPES EVERY TYPE BELOW
 *
 * An extracted rule is a model's inference. Stored as fact and injected into
 * every prompt, one wrong rule silently poisons every later run, and it does
 * so confidently and invisibly, which is worse than having no context at all.
 * So the status vocabulary is not bookkeeping: `proposed` means a human has
 * not looked, and only `confirmed` may ever reach a prompt.
 */

/**
 * What kind of thing this is.
 *
 * Four kinds rather than one, because they are injected and reviewed
 * differently: a term is a vocabulary mapping, an entity is a thing the system
 * has, a workflow is an ordering, and a rule is an invariant that can be
 * violated. A reviewer confirming an invariant is making a much stronger claim
 * than one confirming a synonym.
 */
export const DOMAIN_KINDS = ["rule", "term", "entity", "workflow"] as const;

export type DomainKind = (typeof DOMAIN_KINDS)[number];

/**
 * The review state of one statement.
 *
 * `proposed` is the only state an extraction may write. `needs_review` is for
 * a statement whose evidence has moved under it (a cited file changed), which
 * is a different thing from never having been looked at: it was confirmed
 * once, by someone, and that decision is recorded.
 */
export const DOMAIN_STATUSES = ["proposed", "confirmed", "rejected", "needs_review"] as const;

export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/** Who produced the statement: the extractor, or a person who typed it. */
export const DOMAIN_ORIGINS = ["inferred", "human"] as const;

export type DomainOrigin = (typeof DOMAIN_ORIGINS)[number];

/**
 * Where a statement's evidence points.
 *
 * `person` exists because a rule a customer stated in a conversation is a real
 * and common source, and recording it as `inferred` from nothing would be a
 * lie. It carries no locator beyond who said it.
 */
export const EVIDENCE_KINDS = ["code", "tracker", "document", "person"] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * THE ONE RULE THAT MATTERS: only a confirmed statement is authoritative.
 *
 * Used by the injection path, and the reason it is a function here rather than
 * a comparison at each call site: there is exactly one place to change if a
 * fifth status is ever added, and exactly one thing for a guard test to pin.
 *
 * `needs_review` deliberately returns false. It was confirmed once, but its
 * evidence has moved, and continuing to state it as fact is how a stale rule
 * outlives the code it described.
 */
export function isAuthoritative(status: DomainStatus): boolean {
  return status === "confirmed";
}

/**
 * Whether an extraction may write this status.
 *
 * An extractor that could write `confirmed` would bypass the review gate
 * entirely, which is the whole feature. The service enforces this and a
 * database CHECK enforces that a confirmed row names its reviewer, so the two
 * cannot disagree.
 */
export function isExtractableStatus(status: DomainStatus): boolean {
  return status === "proposed";
}

/** Read a kind back, tolerating anything a model or an older row produced. */
export function readDomainKind(value: unknown): DomainKind {
  return DOMAIN_KINDS.includes(value as DomainKind) ? (value as DomainKind) : "rule";
}

/**
 * Read a status back.
 *
 * Falls back to `proposed`, which is the only safe direction: an unrecognised
 * status must never read as authoritative, or a column written by a newer
 * deploy could inject something an older one cannot understand.
 */
export function readDomainStatus(value: unknown): DomainStatus {
  return DOMAIN_STATUSES.includes(value as DomainStatus) ? (value as DomainStatus) : "proposed";
}

/** Read an origin back. Falls back to `inferred`: assume a model wrote it. */
export function readDomainOrigin(value: unknown): DomainOrigin {
  return DOMAIN_ORIGINS.includes(value as DomainOrigin) ? (value as DomainOrigin) : "inferred";
}

export function readEvidenceKind(value: unknown): EvidenceKind {
  return EVIDENCE_KINDS.includes(value as EvidenceKind) ? (value as EvidenceKind) : "person";
}

/**
 * How a kind and a status read on screen. The UI never shows a stored token.
 */
export const DOMAIN_KIND_LABELS: Record<DomainKind, string> = {
  rule: "Rule",
  term: "Term",
  entity: "Entity",
  workflow: "Workflow",
};

export const DOMAIN_STATUS_LABELS: Record<DomainStatus, string> = {
  proposed: "Proposed",
  confirmed: "Confirmed",
  rejected: "Rejected",
  needs_review: "Needs review",
};

/** The statuses of an extraction job itself, not of what it produced. */
export const DOMAIN_EXTRACTION_STATUSES = ["queued", "extracting", "succeeded", "failed"] as const;

export type DomainExtractionStatus = (typeof DOMAIN_EXTRACTION_STATUSES)[number];
