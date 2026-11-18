import crypto from "node:crypto";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";

/**
 * The parts of a baseline scan that are pure functions of their input: which
 * files to scan, what it will cost, how a finding is identified across scans,
 * and what order findings are read in.
 *
 * Split out of baselineScanService so they can be unit-tested without a
 * database — the same split graphUsability.ts makes for the graph predicates.
 * The service re-exports everything here, so callers import from one place.
 */

/** Refuse rather than estimate above this. A scan that size is a conversation, not a click. */
export const MAX_FILES = 5_000;
/** Matches the runtime scanner's per-file slice. */
export const MAX_FILE_CHARS = 8_000;
// Batch pricing is half of standard. claude-fable-5 is $10/$50 per Mtok, so
// $5/$25 here. Per file: ~430 tokens of instructions plus the code slice, and
// an output that is a short JSON object for a clean file and a few hundred
// tokens when there are findings.
const INPUT_USD_PER_TOKEN = 5 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 25 / 1_000_000;

/**
 * Batch rates per model, in USD per token.
 *
 * ONE place, because an estimate and an actual charge priced from two
 * different tables would disagree for reasons nobody could find. The default
 * model's rates are the ones the estimate above is built from; the fallback's
 * are half, which is what the shipped pre-flight dialog already tells
 * customers ("falls back to a model costing half as much").
 *
 * These are assumptions and the only assumptions here: the TOKEN COUNTS are
 * facts reported by the provider. That is why both are stored separately on
 * the scan. When a published price moves, this table is what changes, and the
 * recorded tokens still let an old scan be re-priced.
 */
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: INPUT_USD_PER_TOKEN, output: OUTPUT_USD_PER_TOKEN },
  "claude-opus-5": { input: INPUT_USD_PER_TOKEN / 2, output: OUTPUT_USD_PER_TOKEN / 2 },
};
const PROMPT_OVERHEAD_TOKENS = 430;
const CHARS_PER_TOKEN = 3.5;
const EXPECTED_OUTPUT_TOKENS = 300;

/** Extensions worth scanning. Everything else is noise a security model cannot use. */
const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|kts|scala|cs|php|swift|m|mm|c|h|cpp|hpp|cc|sql|sh|bash|ps1|tf|yaml|yml)$/i;
/** Vendored or generated trees: findings there are not the team's to fix. */
export const EXCLUDED_PATH = /(^|\/)(node_modules|vendor|dist|build|out|\.next|coverage|__snapshots__|migrations)\//i;

/**
 * Normalise a folder scope, or reject it.
 *
 * Returns the prefix with no leading or trailing slash, `null` for "the whole
 * repository", or `false` for a value that must be refused.
 *
 * Refusals are deliberate rather than defensive cleanup. A prefix is compared
 * against paths from the git tree, so an absolute path or a `..` segment can
 * only come from a client that has misunderstood or is probing: silently
 * rewriting it would scope the scan to something the customer did not ask for,
 * and the file list is what the findings are attributed to.
 */
export function normalisePathPrefix(raw: unknown): string | null | false {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "/" || trimmed === ".") return null;
  if (trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) return false;
  if (trimmed.includes("\\")) return false;
  const parts = trimmed.replace(/\/+$/, "").split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  if (trimmed.length > 400) return false;
  return parts.join("/");
}

/**
 * Whether a repository path lies inside a folder scope.
 *
 * Boundary-aware on purpose: a plain `startsWith` would put `src/apps/x.ts`
 * inside the scope `src/app`, which is a different folder. The prefix must be
 * followed by a separator.
 */
export function withinPrefix(path: string, prefix: string | null): boolean {
  if (prefix == null) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

export interface BaselineEstimate {
  filesTotal: number;
  estimatedCostUsd: number;
  estimatedMinutes: number;
  /** Where the file list came from: a built graph, or the raw git tree. */
  source: "graph" | "tree";
  /** True when filesTotal exceeds MAX_FILES; the caller must refuse. */
  overCap: boolean;
  maxFiles: number;
  /** The folder this estimate was limited to (0049). Null is the whole repository. */
  pathPrefix?: string | null;
}

/**
 * The files to scan, preferring Graphify's index.
 *
 * A built graph is strictly better than filtering the tree by extension: it is
 * the output of a real parser, so it already excludes docs, config and anything
 * unparseable. It is never required — indexing may be unconfigured or may have
 * failed, and a baseline scan must not depend on it.
 */
export function discoverFiles(
  graph: GraphifyGraph | null,
  treePaths: string[],
  pathPrefix: string | null = null,
): { paths: string[]; source: "graph" | "tree" } {
  if (graph?.nodes?.length) {
    const fromGraph = [
      ...new Set(graph.nodes.filter((n) => n.fileType === "code" && n.sourceFile).map((n) => n.sourceFile)),
    ].filter((p) => !EXCLUDED_PATH.test(p) && withinPrefix(p, pathPrefix));
    if (fromGraph.length > 0) return { paths: fromGraph.sort(), source: "graph" };
    // A prefix that matches nothing in the graph is NOT a reason to fall back
    // to the tree: that would silently widen a scope the customer narrowed,
    // and quote a file count for a folder they did not choose. An empty result
    // is the honest answer, and the caller refuses it with a 422.
    if (pathPrefix != null) return { paths: [], source: "graph" };
  }
  return {
    paths: treePaths
      .filter((p) => CODE_EXT.test(p) && !EXCLUDED_PATH.test(p) && withinPrefix(p, pathPrefix))
      .sort(),
    source: "tree",
  };
}

/** Cost and time for `fileCount` files, at batch prices. */
export function estimateScan(fileCount: number): Omit<BaselineEstimate, "source"> {
  // Assume an average file at roughly two thirds of the slice cap; a repository
  // of small files then costs less than quoted, which is the direction an
  // estimate shown before spend should err in.
  const inputTokens = fileCount * (PROMPT_OVERHEAD_TOKENS + (MAX_FILE_CHARS * 0.65) / CHARS_PER_TOKEN);
  const outputTokens = fileCount * EXPECTED_OUTPUT_TOKENS;
  const cost = inputTokens * INPUT_USD_PER_TOKEN + outputTokens * OUTPUT_USD_PER_TOKEN;
  return {
    filesTotal: fileCount,
    estimatedCostUsd: Math.round(cost * 100) / 100,
    // Batches usually finish well inside an hour. Quote a floor of 5 minutes so
    // nobody reads "1 minute" and sits waiting for it.
    estimatedMinutes: Math.max(5, Math.ceil(fileCount / 60)),
    overCap: fileCount > MAX_FILES,
    maxFiles: MAX_FILES,
  };
}

/**
 * Identity of a finding across scans.
 *
 * Line numbers are excluded deliberately: an edit anywhere above a finding
 * shifts it, and a finding the team has already acknowledged must not return as
 * new because someone added an import. The title is normalised because the
 * model rewords the same issue between runs.
 */
export function findingFingerprint(filePath: string, title: string, owasp: string): string {
  const normalised = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return crypto.createHash("sha256").update(`${filePath} ${normalised} ${owasp}`).digest("hex").slice(0, 32);
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** The only fields sorting depends on; keeps this module free of database types. */
export interface SortableFinding {
  severity: string;
  filePath: string;
}

/** Most severe first — the order a reviewer wants, not insertion order. */
export function sortFindings<T extends SortableFinding>(findings: T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      a.filePath.localeCompare(b.filePath),
  );
}

/**
 * Whether this actor may SEE a repository's scans at all — a separate question
 * from whether they may start one.
 *
 * Same rule as `GET /runs/:id`: the owner, or any member of the team whose
 * project owns the repository. Findings name file paths, vulnerability classes
 * and exploitation detail for a specific codebase, so "authenticated" is
 * nowhere near enough to read them.
 */
export interface ViewActor {
  userId: string;
  teamId: number | null;
}

/** The only parts of a scan target this decision reads. */
export interface ViewableTarget {
  repo: { userId: string };
  project: { teamId: number | null } | null;
}

export function canViewBaselineScans(actor: ViewActor, target: ViewableTarget): boolean {
  if (target.repo.userId === actor.userId) return true;
  const teamId = target.project?.teamId ?? null;
  return teamId != null && actor.teamId === teamId;
}

/**
 * What a finished scan actually cost, from the tokens the provider reported.
 *
 * Returns null for a model with no rate in the table rather than quoting zero:
 * a scan that cost real money and reads as $0.00 is worse than one that reads
 * as "not priced". The tokens are stored either way.
 */
export function actualCostUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const rate = model ? MODEL_RATES[model] : undefined;
  if (!rate) return null;
  const cost = inputTokens * rate.input + outputTokens * rate.output;
  // Four decimal places: a scan of a small folder can genuinely cost a few
  // cents, and rounding that to two would record it as free.
  return Math.round(cost * 10_000) / 10_000;
}

/** The models this scan can run on, exposed for the test that pins the table. */
export const PRICED_MODELS = Object.keys(MODEL_RATES);
