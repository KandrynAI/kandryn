import crypto from "node:crypto";
import {
  readReviewCategory,
  readReviewSeverity,
  type ReviewCategory,
  type ReviewSeverity,
} from "../../../../shared/types/reviewScan.js";

/**
 * The parts of a whole-repository code review that are pure functions of their
 * input: the per-file prompt, the parser for one reply, what it will cost, how
 * a finding is identified across reviews, and what order findings are read in.
 *
 * Split out of reviewScanService so they can be unit-tested without a database
 * or a model, the same split baselineScanCore makes.
 *
 * WHY THIS IS NOT THE SECURITY SCANNER WITH A DIFFERENT PROMPT
 *
 * It shares the batching and collection machinery, because that is about
 * surviving a 300-second function and nothing else. It does not share the
 * prompt, the taxonomy or the table. Aegis asks whether a file is exploitable
 * and answers on the OWASP taxonomy; this asks whether a file is correct, and
 * the two sets of findings are read by different people for different reasons.
 */

/** Refuse rather than estimate above this. Same ceiling as the security scan. */
export const MAX_FILES = 5_000;
/** Matches the security scanner's per-file slice, for the same reason: a bound. */
export const MAX_FILE_CHARS = 8_000;

// Batch pricing, half of standard, from the one table the security scan's
// estimate and actual charge already share. A review's prompt is longer than
// the security scan's (it states what is in scope and what is not, which the
// security prompt does not have to), and its replies are longer, because a
// correctness finding needs an explanation where a vulnerability class often
// does not.
const INPUT_USD_PER_TOKEN = 5 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 25 / 1_000_000;
const PROMPT_OVERHEAD_TOKENS = 620;
const CHARS_PER_TOKEN = 3.5;
const EXPECTED_OUTPUT_TOKENS = 420;

export interface ReviewEstimate {
  filesTotal: number;
  estimatedCostUsd: number;
  estimatedMinutes: number;
  source: "graph" | "tree";
  overCap: boolean;
  maxFiles: number;
  pathPrefix?: string | null;
}

/** Cost and time for `fileCount` files, at batch prices. */
export function estimateReview(fileCount: number): Omit<ReviewEstimate, "source"> {
  const inputTokens = fileCount * (PROMPT_OVERHEAD_TOKENS + (MAX_FILE_CHARS * 0.65) / CHARS_PER_TOKEN);
  const outputTokens = fileCount * EXPECTED_OUTPUT_TOKENS;
  const cost = inputTokens * INPUT_USD_PER_TOKEN + outputTokens * OUTPUT_USD_PER_TOKEN;
  return {
    filesTotal: fileCount,
    estimatedCostUsd: Math.round(cost * 100) / 100,
    estimatedMinutes: Math.max(5, Math.ceil(fileCount / 60)),
    overCap: fileCount > MAX_FILES,
    maxFiles: MAX_FILES,
  };
}

/**
 * Identity of a finding across reviews.
 *
 * Excludes the line number for the same reason the security scan's does: an
 * edit anywhere above a finding shifts it, and a finding a team has already
 * acknowledged must not come back as new because someone added an import. The
 * title is normalised because the model rewords the same issue between runs.
 */
export function reviewFingerprint(filePath: string, title: string, category: string): string {
  const normalised = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return crypto.createHash("sha256").update(`${filePath} ${normalised} ${category}`).digest("hex").slice(0, 32);
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export interface SortableReviewFinding {
  severity: string;
  filePath: string;
}

/** Most severe first, then by path: the order a reviewer wants. */
export function sortReviewFindings<T extends SortableReviewFinding>(findings: T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      a.filePath.localeCompare(b.filePath),
  );
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * Review one file of an existing codebase.
 *
 * Three things in here are load-bearing.
 *
 * It says what is OUT of scope, at length. A model asked to review a file with
 * no constraint returns formatting preferences and naming opinions, which bury
 * the two real defects and teach a reviewer to stop reading. Security is also
 * excluded: Aegis already scans every file and duplicate findings in two
 * tables with two severities are worse than none.
 *
 * It says the file is seen ALONE. This reviewer has one file and no callers, so
 * it cannot know whether an exported function is used correctly elsewhere.
 * Without being told, it guesses, and a confident finding about a caller it
 * never saw is the single most expensive kind of false positive here.
 *
 * It requires a line reference. A correctness claim a reviewer cannot locate
 * costs more to check than to ignore.
 */
export function reviewFilePrompt(
  file: { filePath: string; code: string },
  stackDesc?: string,
): string {
  const stackLine = stackDesc ? `\nThe project's stack: ${stackDesc}.\n` : "\n";
  return `You are reviewing ONE file from an existing codebase, as an experienced engineer would in a pull request.
${stackLine}
Report only defects a reviewer would raise. For each one you must be able to point at the line that is wrong.

IN SCOPE:
- correctness: the code does not do what it plainly intends, or has an off-by-one, a wrong operator, an unreachable branch, a mishandled edge case.
- error_handling: a failure is swallowed, ignored, or reported as success; an error path leaves state half-written.
- resource: something opened and not closed, unbounded growth, a timer or listener never cleared.
- concurrency: shared state mutated without ordering guarantees, an await that makes a check-then-act unsafe.
- api_contract: the signature or name promises something the body does not do, so a caller is misled.
- maintainability: substantial duplication or dead code. Only when it is substantial.
- test_gap: behaviour in this file that matters and plainly has no test, when the file itself is a test or sits beside one.

OUT OF SCOPE. Do not report any of these, even if you are confident:
- formatting, naming, import order, comment style, file length, or any preference a formatter or linter settles.
- security vulnerabilities. A separate security scan covers every file and reports those; repeating them here is noise.
- missing types on an untyped language, or suggestions to adopt a library or pattern.
- anything you would phrase as "consider", "might be nice", or "for consistency".

YOU ARE SEEING THIS FILE ALONE. You have no callers, no imports resolved, and no tests. So:
- do not claim anything about how this file is used elsewhere.
- do not report a function as unused, or a parameter as unnecessary.
- if a defect depends on what a caller does, say so in the detail instead of asserting it.
- a clean file is the normal outcome. Return an empty array rather than finding something to say.

Answer with JSON only, no prose, no code fence:
{"findings":[{"severity":"high|medium|low","category":"correctness|error_handling|resource|concurrency|api_contract|maintainability|test_gap|other","title":"<one line, under 90 characters>","detail":"<what is wrong and why it matters, 2 to 4 sentences>","lineRef":"<a line number or range in this file>","remediation":"<what to change, 1 to 2 sentences>"}]}

severity means: high, a reviewer would block the pull request; medium, they would ask for a change; low, they would mention it.

File: ${file.filePath}
Source:
${file.code.slice(0, MAX_FILE_CHARS)}`;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

export interface ParsedReviewFinding {
  severity: ReviewSeverity;
  category: ReviewCategory;
  title: string;
  detail: string;
  lineRef: string | null;
  remediation: string;
}

export class ReviewParseError extends Error {}

const MAX_TITLE = 160;
const MAX_DETAIL = 1_200;
const MAX_REMEDIATION = 600;
const MAX_FINDINGS_PER_FILE = 12;

/** Trim to a bound, keeping whole characters. Never throws. */
function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Turn one model reply into findings for one file.
 *
 * Throws on a reply that is not the contract, because a file whose reply
 * cannot be read is an UNREVIEWED file, not a clean one, and the coverage
 * figure has to be able to say so. Everything else is coerced rather than
 * rejected: a missing remediation is not a reason to drop a real finding.
 *
 * The file path is assigned by the caller from the frozen list and is never
 * taken from the reply, so a model naming another file cannot misattribute a
 * finding. Same rule the security scan follows.
 */
export function parseReviewFile(raw: string): ParsedReviewFinding[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ReviewParseError("The review reply was not valid JSON.");
  }
  const findings = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(findings)) {
    throw new ReviewParseError("The review reply had no findings array.");
  }
  const out: ParsedReviewFinding[] = [];
  for (const f of findings.slice(0, MAX_FINDINGS_PER_FILE)) {
    const row = f as Record<string, unknown>;
    const title = clip(row.title, MAX_TITLE);
    // A finding with no title cannot be read, acted on, or fingerprinted
    // stably. Dropping it loses nothing a reviewer could have used.
    if (!title) continue;
    out.push({
      severity: readReviewSeverity(row.severity),
      category: readReviewCategory(row.category),
      title,
      detail: clip(row.detail, MAX_DETAIL),
      lineRef: clip(row.lineRef, 40) || null,
      remediation: clip(row.remediation, MAX_REMEDIATION),
    });
  }
  return out;
}
