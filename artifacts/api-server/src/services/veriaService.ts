import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import type { ReviewResult } from "../../../../shared/types/reviewResult.js";

/** Veria failure with an HTTP status — lets the route surface a clean, specific
 *  message (e.g. an output-truncation retry hint) instead of a generic 502. */
export class VeriaError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = "VeriaError";
  }
}

/** One file in the committed change set Veria reviews. */
export interface VeriaFile {
  filePath: string;
  op: "create" | "edit" | "delete";
  code: string;
}

export interface VeriaInput {
  itemTitle: string;
  itemType: string;
  acceptanceCriteria: string[];
  suggestionAgent: string;
  /** The whole committed change set — Veria judges coherence across all files. */
  files: VeriaFile[];
}

const ReviewFindingSchema = z.object({
  type: z.enum(["strength", "gap", "risk"]),
  title: z.string().min(1).max(120),
  detail: z.string().default(""),
  acRef: z.string().optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  filePath: z.string().optional(),
});
const ReviewSchema = z.object({
  summary: z.string().min(1),
  acCoverage: z.object({
    covered: z.array(z.string()).default([]),
    missed: z.array(z.string()).default([]),
    partial: z.array(z.string()).default([]),
  }),
  findings: z.array(ReviewFindingSchema).default([]),
  reviewerNote: z.string().default(""),
});

function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```$/im, "")
    .trim();
  return JSON.parse(cleaned);
}

const MAX_CHARS_PER_FILE = 3500;

function renderFiles(files: VeriaFile[]): string {
  if (files.length === 0) return "(no files)";
  return files
    .map((f) => {
      if (f.op === "delete") return `--- delete ${f.filePath} ---\n(file deleted)`;
      return `--- ${f.op} ${f.filePath} ---\n${f.code.slice(0, MAX_CHARS_PER_FILE)}`;
    })
    .join("\n\n");
}

function buildVeriaPrompt(input: VeriaInput): string {
  const ac =
    input.acceptanceCriteria.length > 0
      ? input.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "No acceptance criteria provided — review the code quality generally.";
  const paths = input.files.map((f) => f.filePath).join(", ");
  return `You are Veria, a senior code reviewer for Blue Mantis. You review
committed code changes against the original acceptance criteria.

Work item: ${input.itemTitle}
Type: ${input.itemType}

Acceptance criteria:
${ac}

Committed change set (${input.files.length} file(s), by ${input.suggestionAgent}):
${renderFiles(input.files)}

Review this change set against the acceptance criteria. Judge the change AS A
WHOLE, not file by file. Be specific — reference actual function names, variable
names, error types, and line-level observations from the code above. Do not write
generic praise or generic warnings.

CROSS-FILE COHERENCE (the most important check for a multi-file change): decide
whether the files agree with each other. A method an interface declares must be
defined by its implementation and called correctly by its callers; DTO / record
shapes must match how they are constructed and consumed; method names, parameter
lists, routes, and types must line up across the files. If anything does not
line up — a call to a method that no file defines, a signature mismatch between
interface and implementation, a DTO field used but never declared — list it as a
'risk' finding titled 'Cross-file mismatch' naming the exact disagreement and the
files involved. If the files are coherent, say so as a 'strength'.

Additionally, check for these specific issues:

SCOPE CREEP: Does the committed code change anything beyond what the acceptance
criteria required? If yes, list it as a 'risk' finding with title 'Unrequested
change' and describe what was changed and why it is risky.

SILENT ASSUMPTIONS: Is there any part of the code that clearly implements a
specific interpretation of an ambiguous criterion without acknowledging the
ambiguity? If yes, list it as a 'gap' finding with title 'Silent assumption' and
describe what was assumed.

OVER-ENGINEERING: Does the change introduce abstractions, helpers, or patterns
that are not needed to satisfy the criteria? If yes, list as a 'gap' finding with
title 'Unnecessary complexity'.

These findings follow the same ReviewFinding structure: { type, title, detail, severity }.

Return ONLY a JSON object. No preamble, no markdown fences.

{
  "summary": "2-3 sentences. Overall assessment of whether this change delivers on the work item. Reference the code specifically.",
  "acCoverage": {
    "covered":  ["Quote each AC criterion that is fully addressed by the code"],
    "missed":   ["Quote each AC criterion not addressed at all"],
    "partial":  ["Quote each AC criterion partially addressed — append what is missing in parentheses"]
  },
  "findings": [
    { "type": "strength", "title": "6 words max", "detail": "1-2 sentences. Reference specific code.", "acRef": "Which AC item this supports (optional)", "filePath": "the file this concerns (optional)" },
    { "type": "gap", "title": "6 words max", "detail": "What is missing and why it matters.", "acRef": "Which AC item this relates to (optional)", "severity": "low | medium | high", "filePath": "the file this concerns (optional)" },
    { "type": "risk", "title": "6 words max", "detail": "What could fail in production or code review.", "severity": "low | medium | high", "filePath": "the file this concerns (optional)" }
  ],
  "reviewerNote": "One sentence only: what the human reviewer should focus on most."
}

Rules:
- Include 2-3 strengths.
- Include 1-3 gaps or risks (omit if genuinely none found).
- acCoverage arrays may be empty if all criteria fall in one bucket.
- filePath: when a finding is about one specific file, set it to that file's exact path (one of: ${paths}). For a finding that spans the whole change (e.g. cross-file coherence), omit filePath.
- Return only valid JSON. No trailing commas. No comments inside JSON.`;
}

/**
 * Run the Veria review agent. Uses the user's Anthropic key (per-user creds,
 * like the rest of the pipeline). Throws on an unparseable/invalid response so
 * the route can mark the review failed.
 */
export async function runVeriaReview(
  input: VeriaInput,
  creds: { anthropicApiKey?: string },
): Promise<ReviewResult> {
  const client = new Anthropic({ apiKey: creds.anthropicApiKey });

  const response = await client.messages.create({
    // 8192 (matching the generation agents) so a full structured review of a
    // large multi-file change fits — 1500 truncated the JSON mid-string.
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    messages: [{ role: "user", content: buildVeriaPrompt(input) }],
  });

  // Truncation guard: if the model ran out of output budget the JSON is cut off
  // mid-string, so fail with a clear, retryable message instead of an opaque
  // "Unterminated string in JSON" parse error.
  if (response.stop_reason === "max_tokens") {
    logger.warn(
      { itemTitle: input.itemTitle, files: input.files.length },
      "Veria review hit the output token limit — truncated",
    );
    throw new VeriaError(
      "Veria's review was too long to finish in one pass and was cut off. Please try again.",
      503,
    );
  }

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();

  let parsed: z.infer<typeof ReviewSchema>;
  try {
    parsed = ReviewSchema.parse(extractJson(raw));
  } catch (err) {
    logger.warn({ err }, "Veria returned unparseable/invalid JSON");
    throw new Error(`Veria returned unparseable JSON: ${raw.slice(0, 200)}`);
  }

  return {
    ...parsed,
    findings: validateFindingPaths(parsed.findings, input.files.map((f) => f.filePath)),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * A finding's filePath is model-tagged (unlike Aegis, which scans per file), so
 * validate it against the change set: a path not in the set is dropped and the
 * finding kept as change-spanning — never silently attached to a wrong file.
 */
export function validateFindingPaths<T extends { filePath?: string }>(findings: T[], paths: string[]): T[] {
  const set = new Set(paths);
  let dropped = 0;
  const out = findings.map((f) => {
    if (f.filePath && !set.has(f.filePath)) {
      dropped++;
      return { ...f, filePath: undefined };
    }
    return f;
  });
  if (dropped > 0) logger.warn({ dropped, total: findings.length }, "Veria finding filePath not in the change set — dropped");
  return out;
}

// ---------------------------------------------------------------------------
// Remediation draft (model-assisted). Turns a completed Veria review into a
// concise, imperative refinement prompt the developer can edit before re-running
// the work item. Only actionable signal (gaps, risks, unmet AC) feeds the draft;
// strengths are ignored.
// ---------------------------------------------------------------------------

function buildDraftPrompt(itemTitle: string, review: ReviewResult): string {
  const unmet = [
    ...review.acCoverage.missed.map((c) => `- MISSED: ${c}`),
    ...review.acCoverage.partial.map((c) => `- PARTIAL: ${c}`),
  ].join("\n");
  const issues = review.findings
    .filter((f) => f.type === "gap" || f.type === "risk")
    .map((f) => `- [${f.severity ?? f.type}] ${f.title}: ${f.detail}${f.filePath ? ` (${f.filePath})` : ""}`)
    .join("\n");
  return `You are preparing a fix brief for the code-generation agents (Raptia and Fovea) that will RE-RUN a work item whose previous attempt was reviewed and found wanting.

Work item: ${itemTitle}

Reviewer's summary: ${review.summary}

${unmet ? `Acceptance criteria not fully met:\n${unmet}\n` : ""}
${issues ? `Issues to fix (from the reviewer):\n${issues}\n` : ""}
Write a single, concise, imperative refinement instruction telling the agents exactly what to fix on the next attempt. Reference the specific files, methods, and types named above. Be direct; no preamble, no praise, no restating the summary. Return ONLY the instruction text — plain text, no markdown, no JSON — under ~150 words.`;
}

export async function buildVeriaRemediationDraft(
  input: { itemTitle: string; review: ReviewResult },
  creds: { anthropicApiKey?: string },
): Promise<string> {
  const client = new Anthropic({ apiKey: creds.anthropicApiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    messages: [{ role: "user", content: buildDraftPrompt(input.itemTitle, input.review) }],
  });
  const draft = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();
  if (!draft) throw new VeriaError("Could not draft a remediation prompt. Please try again.", 502);
  return draft;
}
