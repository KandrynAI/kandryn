/**
 * The impact narrative's grounded core: the fact bundle, the deterministic
 * assessment, and the gate every model answer has to pass.
 *
 * Pure and db-free (the confidenceScore.ts / confidence.ts split). What makes
 * that worth doing here is the validation: this is the one place in Sequence
 * Guard where a model's words are shown to a user and then frozen verbatim
 * into an immutable decision record. If the model invents a file, an item or a
 * consequence, that invention is what an auditor reads back months later. So
 * every risk must cite facts from the bundle, and anything citing something
 * that is not there is dropped rather than trusted.
 *
 * Nothing in a fact is ever file CONTENTS or a credential — paths, keys,
 * statuses and counts only.
 */

import { z } from "zod/v4";
import type {
  FindingType,
  ImpactAnalysis,
  SequenceFact,
  SequenceFinding,
} from "../../../../shared/types/sequence.js";

/** A blocker as the narrative needs to describe it. */
export interface BlockerFact {
  key: string;
  title: string;
  trackerStatus: string;
  prState: "merged" | "open" | "closed" | "unknown" | "none";
  gateBlocked: boolean;
}

export interface FactBundleInput {
  defaultBranch: string;
  itemKey: string;
  itemTitle: string;
  /** Raw acceptance criteria. Untrusted text — flagged as such in the bundle. */
  acceptanceCriteria: string | null;
  scheduledAt: string | null;
  blockers: BlockerFact[];
  /** Items this one blocks, and where they stand. */
  dependents: Array<{ key: string; status: string }>;
  /** Overlapping file paths and the items already touching them. */
  overlaps: Array<{ file: string; heldBy: string[] }>;
  /** Other open Kandryn pull requests touching the same directories. */
  openPrCountInSharedDirs: number;
}

const MAX_AC_LINES = 8;
const AC_LINE_CAP = 200;

/**
 * Turn the loaded state into numbered facts (F1, F2, …) the narrative must
 * cite. Deterministic and ordered, so the same state yields the same ids and a
 * cached impact stays meaningful.
 */
export function buildFactBundle(input: FactBundleInput): SequenceFact[] {
  const facts: SequenceFact[] = [];
  const add = (text: string, untrusted = false) =>
    facts.push({ id: `F${facts.length + 1}`, text, ...(untrusted ? { untrusted: true } : {}) } as SequenceFact);

  add(
    `Kandryn generates code against the repository's default branch, "${input.defaultBranch}". Anything not merged there is invisible to this run.`,
  );
  add(`The item being run is ${input.itemKey}.`);
  add(`${input.itemKey} is titled: ${input.itemTitle}`, true);

  for (const b of input.blockers) {
    const pr =
      b.prState === "none"
        ? "no Kandryn pull request"
        : b.prState === "unknown"
          ? "a Kandryn pull request whose state could not be read"
          : `a Kandryn pull request that is ${b.prState}`;
    const gate = b.gateBlocked ? ", and its security gate is blocked" : "";
    add(`${b.key} must finish before ${input.itemKey}. Its tracker status is "${b.trackerStatus}" and it has ${pr}${gate}.`);
  }

  for (const d of input.dependents) {
    add(`${d.key} waits on ${input.itemKey}; its tracker status is "${d.status}".`);
  }

  for (const o of input.overlaps) {
    add(`The file ${o.file} is already being changed by ${o.heldBy.join(", ")}.`);
  }

  if (input.openPrCountInSharedDirs > 0) {
    add(
      `${input.openPrCountInSharedDirs} other Kandryn pull request${input.openPrCountInSharedDirs === 1 ? "" : "s"} touch${input.openPrCountInSharedDirs === 1 ? "es" : ""} the same directories.`,
    );
  }

  if (input.scheduledAt) {
    add(`This run is scheduled for ${input.scheduledAt} rather than starting now.`);
  }

  // Acceptance criteria last, and flagged: it is text a tracker user wrote,
  // which means it can contain anything at all, including something shaped
  // like an instruction.
  for (const line of acceptanceLines(input.acceptanceCriteria)) {
    add(`Acceptance criterion of ${input.itemKey}: ${line}`, true);
  }

  return facts;
}

/** Bullet-ish lines from an acceptance-criteria blob, capped in both
 *  directions so one enormous field cannot dominate the prompt. */
export function acceptanceLines(ac: string | null): string[] {
  if (!ac) return [];
  return ac
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•\d.)\]]+\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_AC_LINES)
    .map((l) => (l.length > AC_LINE_CAP ? `${l.slice(0, AC_LINE_CAP)}…` : l));
}

// ---------------------------------------------------------------------------
// Deterministic assessment
// ---------------------------------------------------------------------------

const SEVERITY_OF: Record<FindingType, "low" | "medium" | "high"> = {
  unmet_blocker: "high",
  blocker_gate_blocked: "high",
  dependency_cycle: "high",
  file_overlap: "medium",
  blocker_pr_unmerged: "medium",
  children_incomplete: "medium",
  inferred_prerequisite: "low",
  out_of_rank: "low",
};

function templateFor(f: SequenceFinding, itemKey: string): { title: string; explanation: string; mitigation: string } {
  const keys = f.evidence.itemKeys ?? [];
  const files = f.evidence.files ?? [];
  switch (f.type) {
    case "unmet_blocker":
      return {
        title: `${keys.join(", ")} has not landed`,
        explanation: `This run is generated from the default branch. Changes for ${keys.join(", ")} are not there yet, so the suggestion cannot build on them. It may duplicate that work or conflict with it when both merge.`,
        mitigation: `Run ${keys[0] ?? "the blocker"} first, or merge its work, then run ${itemKey}.`,
      };
    case "blocker_pr_unmerged":
      return {
        title: `${keys.join(", ")} has an open pull request`,
        explanation: `The work exists but has not merged, so it is not on the branch this run reads. Two changes built on different starting points tend to conflict.`,
        mitigation: `Merge the open pull request, then run ${itemKey}.`,
      };
    case "blocker_gate_blocked":
      return {
        title: `${keys.join(", ")} is held by a security gate`,
        explanation: `Its change cannot merge until the gate clears. If the fix changes the code ${itemKey} builds on, this run's suggestion may need regenerating.`,
        mitigation: `Clear or override the security gate on ${keys[0] ?? "the blocker"} first.`,
      };
    case "children_incomplete":
      return {
        title: "Child items are still open",
        explanation: `Running the parent while ${keys.join(", ")} remain open risks producing the same code twice, once here and once under the child.`,
        mitigation: "Run the child items, or narrow this item's scope to what the children do not cover.",
      };
    case "file_overlap":
      return {
        title: "Two changes touch the same files",
        explanation: `${files.join(", ")} already appear in another in-flight change. Whichever merges second will need its conflicts resolved by hand.`,
        mitigation: "Land one change first, or split the work so the two do not share files.",
      };
    case "dependency_cycle":
      return {
        title: "These items block each other",
        explanation: `${keys.join(" → ")} form a loop, so no order satisfies all of them. One of these links is wrong.`,
        mitigation: "Correct the dependency in the tracker, then re-sync.",
      };
    case "out_of_rank":
      return {
        title: "Higher-ranked work is still open",
        explanation: `${keys.join(", ")} sit above this item in the backlog and have not been done.`,
        mitigation: "Confirm this item really is the priority before running it.",
      };
    case "inferred_prerequisite":
      return {
        title: "A possible prerequisite was inferred",
        explanation: `${keys.join(", ")} may need to come first, based on how the items are worded. This was inferred, not read from the tracker.`,
        mitigation: "Check whether the dependency is real; dismiss it if not.",
      };
  }
}

/**
 * The assessment that is always available.
 *
 * Built from templates, so it needs no key, no network and no model, and the
 * override flow can therefore never be blocked by any of them. The model
 * narrative in the service is an enrichment of this, not a replacement for it.
 */
export function deterministicImpact(findings: readonly SequenceFinding[], itemKey: string): ImpactAnalysis {
  const risks = findings.map((f) => {
    const t = templateFor(f, itemKey);
    return {
      title: t.title,
      severity: SEVERITY_OF[f.type],
      likelihood: (f.severity === "warning" ? "likely" : "possible") as "likely" | "possible",
      explanation: t.explanation,
      factRefs: [] as string[],
      mitigation: t.mitigation,
    };
  });

  const affectedItems = [...new Set(findings.flatMap((f) => f.evidence.itemKeys ?? []))].sort();
  const affectedFiles = [...new Set(findings.flatMap((f) => f.evidence.files ?? []))].sort();

  const blockers = findings
    .filter((f) => f.type === "unmet_blocker" || f.type === "blocker_pr_unmerged" || f.type === "blocker_gate_blocked")
    .flatMap((f) => f.evidence.itemKeys ?? []);

  return {
    summary:
      findings.length === 0
        ? `Nothing stands in the way of running ${itemKey}.`
        : `Running ${itemKey} now means generating against a branch that does not yet contain ${blockers.length > 0 ? blockers.join(", ") : "other in-flight work"}. ${risks.length} thing${risks.length === 1 ? "" : "s"} could go wrong as a result.`,
    risks,
    affectedItems,
    affectedFiles,
    alternative:
      blockers.length > 0
        ? `Run ${blockers[0]} first, or merge its open pull request, then run ${itemKey}.`
        : `Land the other in-flight change first, then run ${itemKey}.`,
    source: "deterministic",
  };
}

// ---------------------------------------------------------------------------
// Model output: schema and grounding gate
// ---------------------------------------------------------------------------

export const ImpactRiskSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(["low", "medium", "high"]),
  likelihood: z.enum(["unlikely", "possible", "likely"]),
  explanation: z.string().min(1).max(1200),
  factRefs: z.array(z.string().max(8)),
  mitigation: z.string().min(1).max(600),
});

export const ImpactAnalysisSchema = z.object({
  summary: z.string().min(1).max(1200),
  risks: z.array(ImpactRiskSchema).max(8),
  affectedItems: z.array(z.string().max(80)).max(40),
  affectedFiles: z.array(z.string().max(400)).max(60),
  alternative: z.string().min(1).max(600),
});

/**
 * Keep only what the facts support.
 *
 * A risk citing no facts, or citing one that is not in the bundle, is dropped:
 * an uncited claim is exactly the kind of confident invention this record must
 * not preserve. Items and files are intersected with what the bundle mentions
 * for the same reason. Returns null when nothing survives, which tells the
 * caller to use the deterministic assessment instead.
 */
export function validateModelImpact(
  raw: unknown,
  facts: readonly SequenceFact[],
  known: { items: readonly string[]; files: readonly string[] },
  model: string,
): ImpactAnalysis | null {
  const parsed = ImpactAnalysisSchema.safeParse(raw);
  if (!parsed.success) return null;

  const factIds = new Set(facts.map((f) => f.id));
  const risks = parsed.data.risks.filter(
    (r) => r.factRefs.length > 0 && r.factRefs.every((ref) => factIds.has(ref)),
  );
  if (risks.length === 0) return null;

  const itemSet = new Set(known.items);
  const fileSet = new Set(known.files);

  return {
    summary: parsed.data.summary,
    risks,
    affectedItems: parsed.data.affectedItems.filter((i) => itemSet.has(i)),
    affectedFiles: parsed.data.affectedFiles.filter((f) => fileSet.has(f)),
    alternative: parsed.data.alternative,
    source: "ai",
    model,
  };
}
