import Anthropic from "@anthropic-ai/sdk";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, changePlansTable, changePlanFilesTable } from "@workspace/db";
import type { ChangePlanRow, ChangePlanFileRow } from "@workspace/db";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";
import type { ChangePlan, ChangePlanOp, PlannedFile, PlanCandidateFile, RetrievalMode, PlanStatus } from "../../../../shared/types/changePlan.js";
import type { StackProfile } from "../stack/detector.js";
import { describeStack } from "./stackPromptBuilder.js";
import { queryGraph, isGraphServable } from "./graphifyService.js";
import { computePlanConfidence, confidenceReason, type ConfidenceSignals } from "./confidence.js";
import * as audit from "./auditService.js";
import { logger } from "../lib/logger.js";

const PLANNER_MODEL = "claude-sonnet-4-5";
const CANDIDATE_CAP = 25;
const FILE_CAP = 10; // §1.3 — never plan more than 10 files
const TREE_CAP = 600; // bound the directory listing sent to the planner
// Char budget for the per-file context assembled for generation (§2.2). ~48k
// chars ≈ 12k tokens — comfortably fits a typical multi-file change while
// bounding worst case well under either model's context window.
const PLAN_CONTEXT_CHAR_BUDGET = 48_000;

/** Reads a source file (content + blob SHA); injected, backed by GitService. */
type FileReader = (path: string) => Promise<{ content: string; sha: string } | null>;

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Dependency-order rank for a planned file (§1.5): types/DTOs → interfaces →
 * implementations → controllers → frontend. Display + generation order, not
 * commit order. Heuristic on path/filename; language-agnostic with a C#-aware
 * interface rule (`IFoo.cs`).
 */
export function planOrderRank(path: string): number {
  const p = path.toLowerCase();
  const fileOrig = path.split("/").pop() ?? path;
  const fileLower = fileOrig.toLowerCase();
  // 4 — frontend
  if (/\.(tsx|jsx|vue|svelte|css|scss)$/.test(fileLower) || /\/(components?|pages?|views?|ui)\//.test(p)) return 4;
  // 3 — controllers / routes / endpoints
  if (/controller|\/routes?\/|route\.|endpoint|\/api\//.test(p)) return 3;
  // 1 — interfaces (C# `IFoo.cs`; TS `*.interface.ts` / `*.d.ts`). Checked BEFORE
  //     services so an interface under a Services/ directory is not classed as an
  //     implementation — it must be generated before its implementor.
  if (/^I[A-Z]\w*\.cs$/.test(fileOrig) || /\.interface\.ts$/.test(fileLower) || /\.d\.ts$/.test(fileLower)) return 1;
  // 2 — implementations
  if (/service|repository|handler|provider|impl|usecase/.test(p)) return 2;
  // 0 — types / DTOs / models
  if (/dto|dtos|model|models|entity|entities|schema|types?|record|contract/.test(p)) return 0;
  return 2.5; // unknown: between service and controller
}

/** Stable sort planned files into dependency order. Does not mutate the input. */
export function orderPlannedFiles(files: PlannedFile[]): PlannedFile[] {
  return files
    .map((f, i) => ({ f, i, rank: planOrderRank(f.path) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.f);
}

/**
 * Validate a plan against the repository tree (§1.4): every `edit`/`delete` path
 * must exist, every `create` path must not, and the file list must be non-empty.
 * When the tree is unavailable (empty set) existence is not checked — the plan is
 * accepted rather than blocking the run on a best-effort signal.
 */
export function validatePlan(
  files: PlannedFile[],
  treeSet: Set<string>,
): { ok: true } | { ok: false; reason: string } {
  if (files.length === 0) return { ok: false, reason: "The plan contained no files." };
  if (treeSet.size === 0) return { ok: true };

  const problems: string[] = [];
  for (const f of files) {
    const exists = treeSet.has(f.path);
    if ((f.op === "edit" || f.op === "delete") && !exists) {
      problems.push(`"${f.path}" is marked ${f.op} but does not exist in the repository.`);
    } else if (f.op === "create" && exists) {
      problems.push(`"${f.path}" is marked create but already exists — use edit.`);
    }
  }
  return problems.length ? { ok: false, reason: problems.join(" ") } : { ok: true };
}

/** Keyword file-path ranking for the fallback path (no graph). Paths only. */
export function rankCandidatePaths(paths: string[], keywords: string[], cap = CANDIDATE_CAP): PlanCandidateFile[] {
  const kw = keywords.map((k) => k.toLowerCase()).filter(Boolean);
  if (kw.length === 0) return [];
  return paths
    .map((path) => {
      const lower = path.toLowerCase();
      const score = kw.reduce((n, k) => n + (lower.includes(k) ? 1 : 0), 0);
      return { path, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((x) => ({ path: x.path, symbols: [], source: "keyword" as const, score: x.score }));
}

/** Candidate files from the graph: ranked files + the symbol names per file. */
export function buildCandidatesFromGraph(graph: GraphifyGraph, keywords: string[], cap = CANDIDATE_CAP): PlanCandidateFile[] {
  const ranked = queryGraph(graph, keywords, cap);
  const symbolsByFile = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    if (!n.sourceFile) continue;
    if (!symbolsByFile.has(n.sourceFile)) symbolsByFile.set(n.sourceFile, new Set());
    symbolsByFile.get(n.sourceFile)!.add(n.label);
  }
  return ranked.slice(0, cap).map((r) => ({
    path: r.filePath,
    symbols: [...(symbolsByFile.get(r.filePath) ?? [])].slice(0, 40),
    source: "graph" as const,
    score: r.score,
  }));
}

/** A sibling file in the same directory with the same extension — a convention
 *  example for a `create`. Returns null when the directory has no peer. */
export function findSibling(tree: string[], createPath: string): string | null {
  const slash = createPath.lastIndexOf("/");
  const dir = slash >= 0 ? createPath.slice(0, slash + 1) : "";
  const dot = createPath.lastIndexOf(".");
  const ext = dot >= 0 ? createPath.slice(dot) : "";
  const peers = tree.filter(
    (p) => p !== createPath && p.startsWith(dir) && !p.slice(dir.length).includes("/") && (ext ? p.endsWith(ext) : true),
  );
  return peers.sort()[0] ?? null;
}

export interface AssembledContext {
  context: string;
  /** Paths whose content was truncated to fit the budget (§2.2). */
  truncated: string[];
}

/**
 * Assemble the per-file generation context for a plan (§2.2): full current
 * content for each `edit`/`delete`, and one nearby sibling as a convention
 * example for each `create`. Degrades to fit the budget — drop the examples
 * first, then truncate the largest edit files — and never silently drops a
 * planned file (an unreadable one becomes an empty block, still listed).
 */
export async function assemblePlanContext(
  plan: ChangePlan,
  reader: FileReader,
  tree: string[],
  budget = PLAN_CONTEXT_CHAR_BUDGET,
): Promise<AssembledContext> {
  interface Item {
    path: string;
    kind: "edit" | "example";
    header: string;
    body: string;
  }
  const items: Item[] = [];
  for (const f of plan.files) {
    if (f.op === "edit" || f.op === "delete") {
      const src = await reader(f.path).catch(() => null);
      items.push({ path: f.path, kind: "edit", header: `--- ${f.op} ${f.path} ---`, body: src?.content ?? "" });
    } else {
      const sibling = findSibling(tree, f.path);
      const src = sibling ? await reader(sibling).catch(() => null) : null;
      items.push({
        path: f.path,
        kind: "example",
        header: `--- create ${f.path}${sibling ? ` (convention example: ${sibling})` : ""} ---`,
        body: src?.content ?? "",
      });
    }
  }

  const size = (it: Item) => it.header.length + it.body.length + 2;
  let total = items.reduce((n, it) => n + size(it), 0);
  const truncated: string[] = [];

  // 1) Drop convention examples first.
  if (total > budget) {
    for (const it of items) {
      if (it.kind === "example" && it.body) {
        total -= it.body.length;
        it.body = "(convention example omitted for context budget — follow the repository's existing conventions)";
        total += it.body.length;
        if (total <= budget) break;
      }
    }
  }

  // 2) Truncate the largest edit files until under budget.
  while (total > budget) {
    const largest = items
      .filter((it) => it.kind === "edit" && it.body.length > 500)
      .sort((a, b) => b.body.length - a.body.length)[0];
    if (!largest) break;
    const keep = Math.max(500, largest.body.length - (total - budget) - 200);
    if (keep >= largest.body.length) break;
    const cut = `${largest.body.slice(0, keep)}\n// … (${largest.body.length - keep} chars truncated for context budget) …`;
    total += cut.length - largest.body.length;
    largest.body = cut;
    if (!truncated.includes(largest.path)) truncated.push(largest.path);
  }

  return { context: items.map((it) => `${it.header}\n${it.body}`).join("\n\n"), truncated };
}

/** Append a note to a plan recording that generation context was truncated (§2.2). */
export async function recordContextTruncation(planId: number, truncated: string[]): Promise<void> {
  if (truncated.length === 0) return;
  const [row] = await db.select({ notes: changePlansTable.notes }).from(changePlansTable).where(eq(changePlansTable.id, planId));
  const merged = [row?.notes, `Context truncated for: ${truncated.join(", ")}.`].filter(Boolean).join(" ");
  await db.update(changePlansTable).set({ notes: merged }).where(eq(changePlansTable.id, planId));
}

// ---------------------------------------------------------------------------
// Plan editing (Phase 2 PR3): load the current plan; write a new revision.
// ---------------------------------------------------------------------------

/** The current (non-superseded, highest-revision) plan row for a run, or null. */
export async function loadCurrentPlanRow(runId: number): Promise<ChangePlanRow | null> {
  const [row] = await db
    .select()
    .from(changePlansTable)
    .where(and(eq(changePlansTable.runId, runId), eq(changePlansTable.superseded, false)))
    .orderBy(desc(changePlansTable.revision))
    .limit(1);
  return row ?? null;
}

/** A plan's files, in dependency (seq) order. */
export async function loadPlanFiles(planId: number): Promise<ChangePlanFileRow[]> {
  return db.select().from(changePlanFilesTable).where(eq(changePlanFilesTable.planId, planId)).orderBy(changePlanFilesTable.seq);
}

export interface RunPlanFileDTO {
  id: number;
  seq: number;
  op: "create" | "edit" | "delete";
  filePath: string;
  rationale: string;
  symbols: string[] | null;
  addedByUser: boolean;
  addedSource: "autocomplete" | "manual" | null;
  inCandidates: boolean | null;
}
export interface RunPlanDTO {
  id: number;
  revision: number;
  status: PlanStatus;
  notes: string | null;
  retrievalMode: RetrievalMode | null;
  graphAgeHours: number | null;
  error: string | null;
  files: RunPlanFileDTO[];
  // Confidence gate (Phase 4). Null on plans predating it / non-ready plans.
  confidenceScore: number | null;
  confidenceSignals: ConfidenceSignals | null;
  /** One-line, signal-derived reason for the awaiting-review banner. */
  confidenceReason: string | null;
}

/** The current plan for a run, serialised for the client (null if none). */
export async function loadRunPlanDTO(runId: number): Promise<RunPlanDTO | null> {
  const row = await loadCurrentPlanRow(runId);
  if (!row) return null;
  const files = await loadPlanFiles(row.id);
  const signals = row.confidenceSignals ?? null;
  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    notes: row.notes,
    retrievalMode: row.retrievalMode,
    graphAgeHours: row.graphAgeHours,
    error: row.error,
    confidenceScore: row.confidenceScore != null ? Number(row.confidenceScore) : null,
    confidenceSignals: signals,
    confidenceReason: signals ? confidenceReason(signals) : null,
    files: files.map((f) => ({
      id: f.id,
      seq: f.seq,
      op: f.op,
      filePath: f.filePath,
      rationale: f.rationale,
      symbols: f.symbols,
      addedByUser: f.addedByUser,
      addedSource: f.addedSource,
      inCandidates: f.inCandidates,
    })),
  };
}

/** One file in a plan-revision request from the client (§3.2 Edit plan). */
export interface RevisionFileInput {
  op: ChangePlanOp;
  path: string;
  rationale: string;
  symbols?: string[];
  addedByUser?: boolean;
  addedSource?: "autocomplete" | "manual";
}

/**
 * Write a new plan revision from user edits (§3.2): supersede the prior plan and
 * insert revision + 1 (status 'edited'), carrying the retrieval provenance
 * forward so reporting stays continuous. Returns the new plan for regeneration.
 * Does NOT touch suggestions — the caller supersedes those.
 */
export async function createPlanRevision(
  prior: ChangePlanRow,
  files: RevisionFileInput[],
): Promise<{ planId: number; revision: number; plan: ChangePlan }> {
  const ordered = orderPlannedFiles(files.map((f) => ({ op: f.op, path: f.path, rationale: f.rationale, symbols: f.symbols })));
  const metaByPath = new Map(files.map((f) => [f.path, f]));

  await db.update(changePlansTable).set({ superseded: true }).where(eq(changePlansTable.id, prior.id));

  const [planRow] = await db
    .insert(changePlansTable)
    .values({
      runId: prior.runId,
      revision: prior.revision + 1,
      superseded: false,
      status: "edited",
      model: prior.model,
      candidateFiles: prior.candidateFiles,
      notes: null,
      retrievalMode: prior.retrievalMode,
      graphBuiltAt: prior.graphBuiltAt,
      graphAgeHours: prior.graphAgeHours,
      planningMs: null,
      retrievalMs: null,
      inputTokens: null,
      outputTokens: null,
      error: null,
    })
    .returning();

  const candidatePaths = new Set((prior.candidateFiles ?? []).map((c) => c.path));
  await db.insert(changePlanFilesTable).values(
    ordered.map((f, seq) => {
      const meta = metaByPath.get(f.path);
      return {
        planId: planRow.id,
        seq,
        op: f.op,
        filePath: f.path,
        rationale: f.rationale,
        symbols: f.symbols ?? null,
        addedByUser: meta?.addedByUser ?? false,
        addedSource: meta?.addedSource ?? null,
        inCandidates: candidatePaths.has(f.path),
      };
    }),
  );

  return { planId: planRow.id, revision: planRow.revision, plan: { files: ordered, notes: undefined } };
}

// ---------------------------------------------------------------------------
// Planner model call
// ---------------------------------------------------------------------------

const PlannedFileSchema = z.object({
  op: z.enum(["create", "edit", "delete"]),
  path: z.string().min(1),
  rationale: z.string().min(1),
  symbols: z.array(z.string()).optional(),
});
const ChangePlanSchema = z.object({
  files: z.array(PlannedFileSchema).min(1),
  notes: z.string().optional(),
});

interface PlannerContext {
  workItem: { title: string; description?: string | null; acceptanceCriteria?: string[] };
  stack: StackProfile;
  tree: string[];
  candidates: PlanCandidateFile[];
}

function buildPlannerPrompt(ctx: PlannerContext, feedback: string | null): string {
  const ac = ctx.workItem.acceptanceCriteria ?? [];
  const treeLines = ctx.tree.slice(0, TREE_CAP);
  const treeNote = ctx.tree.length > TREE_CAP ? `\n… (${ctx.tree.length - TREE_CAP} more paths omitted)` : "";
  const candidateBlock = ctx.candidates.length
    ? ctx.candidates
        .map((c) => `- ${c.path}${c.symbols.length ? ` — symbols: ${c.symbols.slice(0, 20).join(", ")}` : ""}`)
        .join("\n")
    : "No candidates were retrieved. Plan from the directory tree and stack below.";

  return `You are a senior engineer planning a multi-file code change. Produce a PLAN ONLY — which files to touch, the operation on each, and a one-line rationale per file. Write NO code.

## Work item
Title: ${ctx.workItem.title}
Description: ${ctx.workItem.description || "(none)"}
Acceptance criteria:
${ac.length ? ac.map((c) => `- ${c}`).join("\n") : "(none)"}

## Repository stack
${describeStack(ctx.stack)}
\`\`\`json
${JSON.stringify(ctx.stack)}
\`\`\`

## Directory (paths only — the authoritative list of what exists)
${treeLines.join("\n")}${treeNote}

## Candidate files (retrieval hints — may be incomplete; use the directory to go beyond them)
${candidateBlock}

## Rules
- Prefer editing existing files. Only "create" when no suitable file exists.
- If you change an interface, include its implementation(s), and vice versa — e.g. an interface and its implementing class must move together or nothing compiles.
- Follow the repository's existing organisation. If a domain's DTOs live in one grouped file, add to that file rather than creating a new one.
- Every "edit" or "delete" path MUST appear in the directory above. Every "create" path MUST NOT appear there.
- Cap at ${FILE_CAP} files. If the change genuinely needs more, return the ${FILE_CAP} most important and explain in "notes".
- "rationale" is one line for a developer reading the UI: "declare EndorseAsync", not "modify the interface as required by the acceptance criteria".
- "symbols" (optional) lists the methods/types to add or change on that file.

## Output
Respond with ONLY a JSON object, no prose, no markdown fences:
{ "files": [ { "op": "edit", "path": "relative/path.ext", "rationale": "one line", "symbols": ["Name"] } ], "notes": "optional" }${feedback ? `\n\nYour previous attempt was rejected: ${feedback}\nReturn ONLY corrected JSON.` : ""}`;
}

interface PlannerResult {
  plan: ChangePlan | null;
  status: "ready" | "failed";
  error: string | null;
  inputTokens: number;
  outputTokens: number;
}

function extractJson<T>(raw: string): T {
  const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  return JSON.parse(stripped) as T;
}

/** One planner call with validation; retries once with feedback, then fails. */
async function callPlanner(
  ctx: PlannerContext,
  treeSet: Set<string>,
  apiKey: string | undefined,
): Promise<PlannerResult> {
  const client = new Anthropic({ apiKey });
  let inputTokens = 0;
  let outputTokens = 0;
  let feedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let parsed: ChangePlan;
    try {
      const message = await client.messages.create({
        model: PLANNER_MODEL,
        max_tokens: 2048,
        messages: [{ role: "user", content: buildPlannerPrompt(ctx, feedback) }],
      });
      inputTokens += message.usage?.input_tokens ?? 0;
      outputTokens += message.usage?.output_tokens ?? 0;
      const block = message.content[0];
      if (block.type !== "text") throw new Error("non-text block");
      parsed = ChangePlanSchema.parse(extractJson<unknown>(block.text));
    } catch (err) {
      feedback = "The previous response was not valid JSON matching the schema.";
      logger.warn({ attempt, err }, "Planner parse failed");
      if (attempt === 1) return { plan: null, status: "failed", error: "The plan could not be parsed.", inputTokens, outputTokens };
      continue;
    }

    // Cap at FILE_CAP, ordering by dependency so the kept files are coherent.
    let files = orderPlannedFiles(parsed.files);
    let notes = parsed.notes;
    if (files.length > FILE_CAP) {
      files = files.slice(0, FILE_CAP);
      notes = [notes, `Truncated to ${FILE_CAP} files.`].filter(Boolean).join(" ");
    }

    const check = validatePlan(files, treeSet);
    if (check.ok) {
      return { plan: { files, notes }, status: "ready", error: null, inputTokens, outputTokens };
    }
    feedback = check.reason;
    logger.warn({ attempt, reason: check.reason }, "Planner validation failed");
    if (attempt === 1) return { plan: null, status: "failed", error: check.reason, inputTokens, outputTokens };
  }
  return { plan: null, status: "failed", error: "The plan could not be produced.", inputTokens, outputTokens };
}

// ---------------------------------------------------------------------------
// Orchestration + persistence
// ---------------------------------------------------------------------------

export interface PlanningInput {
  runId: number;
  /** Owning project — for the confidence gate's historical-acceptance query. */
  projectId: number;
  /** For the fire-and-forget audit entry (plan.generated / plan.failed). */
  userId: string;
  teamId: number | null;
  workItem: { title: string; description?: string | null; acceptanceCriteria?: string[] };
  keywords: string[];
  stack: StackProfile;
  /** Full repo path list (git.fetchFilePaths) — always the primary planning input. */
  tree: string[];
  graph: GraphifyGraph | null;
  /**
   * The repo's graph lifecycle status. Planning owns the servability decision:
   * it uses the graph for candidate retrieval ONLY when isGraphServable(status,
   * builtAt) — succeeded AND fresh. Passing the raw graph + status (rather than a
   * caller-pre-filtered graph) makes "a stale graph never poisons candidates" a
   * structural guarantee here, not a convention the caller must remember.
   */
  graphStatus: string | null;
  graphBuiltAt: Date | string | null;
  anthropicApiKey: string;
}

export interface PlanningSummary {
  planId: number | null;
  status: PlanStatus;
  fileCount: number;
  /** The ready plan (files + notes) for generation to implement. Null if failed. */
  plan: ChangePlan | null;
  retrievalMode: RetrievalMode;
  retrievalMs: number;
  planningMs: number;
  inputTokens: number;
  outputTokens: number;
  graphAgeHours: number | null;
  /** Confidence gate (Phase 4). Null when the plan is not `ready` (nothing to score). */
  confidenceScore: number | null;
  confidenceSignals: ConfidenceSignals | null;
}

/**
 * Produce and persist a change plan for a run (revision 1). Never throws — a
 * failure is recorded as a `failed` plan and the run proceeds without one. The
 * graph is an enhancement on the tree-primary path: its absence is not an error.
 */
export async function runPlanning(input: PlanningInput): Promise<PlanningSummary> {
  const { runId, projectId, userId, teamId, workItem, keywords, stack, tree, graph, graphStatus, graphBuiltAt, anthropicApiKey } = input;

  // Retrieval (tree-primary; graph enhances candidate quality only when SERVABLE
  // — succeeded AND fresh. Planning makes this decision itself so a stale graph
  // can never poison candidates, regardless of what the caller passed).
  const tRetrieval = Date.now();
  const graphFresh = Boolean(graph?.nodes?.length) && isGraphServable(graphStatus, graphBuiltAt);
  let candidates: PlanCandidateFile[];
  let retrievalMode: RetrievalMode;
  let planGraphBuiltAt: Date | null = null;
  let graphAgeHours: number | null = null;
  if (graphFresh && graph) {
    candidates = buildCandidatesFromGraph(graph, keywords);
    retrievalMode = "graph";
    planGraphBuiltAt = graphBuiltAt ? new Date(graphBuiltAt) : null;
    graphAgeHours = planGraphBuiltAt ? (Date.now() - planGraphBuiltAt.getTime()) / 3_600_000 : null;
  } else {
    candidates = rankCandidatePaths(tree, keywords);
    retrievalMode = "keyword";
  }
  const retrievalMs = Date.now() - tRetrieval;

  // Planner call.
  const tPlan = Date.now();
  const treeSet = new Set(tree);
  const result = await callPlanner({ workItem, stack, tree, candidates }, treeSet, anthropicApiKey).catch(
    (err): PlannerResult => {
      logger.error({ runId, err }, "Planner threw unexpectedly");
      return { plan: null, status: "failed", error: "Planning failed unexpectedly.", inputTokens: 0, outputTokens: 0 };
    },
  );
  const planningMs = Date.now() - tPlan;

  // Confidence gate (Phase 4). Only a `ready` plan is scored — nothing to gate
  // otherwise. Best-effort: a failure here leaves confidence null and the run
  // proceeds (fail-open), rather than parking on a scoring error.
  let confidenceScore: number | null = null;
  let confidenceSignals: ConfidenceSignals | null = null;
  if (result.status === "ready" && result.plan) {
    try {
      const conf = await computePlanConfidence({
        candidates,
        retrievalMode,
        planFilePaths: result.plan.files.map((f) => f.path),
        projectId,
      });
      confidenceScore = conf.score;
      confidenceSignals = conf.signals;
    } catch (err) {
      logger.warn({ runId, err }, "Confidence scoring failed — proceeding without a score");
    }
  }

  // Persist the plan (revision 1) + its files. Best-effort — a DB failure here
  // must not fail the run, so it is caught and logged.
  try {
    const [planRow] = await db
      .insert(changePlansTable)
      .values({
        runId,
        revision: 1,
        superseded: false,
        status: result.status,
        model: PLANNER_MODEL,
        candidateFiles: candidates,
        confidenceScore: confidenceScore != null ? String(confidenceScore) : null,
        confidenceSignals,
        notes: result.plan?.notes ?? null,
        retrievalMode,
        graphBuiltAt: planGraphBuiltAt,
        graphAgeHours,
        planningMs,
        retrievalMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        error: result.error,
      })
      .returning();

    if (result.plan && planRow) {
      const candidatePaths = new Set(candidates.map((c) => c.path));
      await db.insert(changePlanFilesTable).values(
        result.plan.files.map((f, seq) => ({
          planId: planRow.id,
          seq,
          op: f.op,
          filePath: f.path,
          rationale: f.rationale,
          symbols: f.symbols ?? null,
          addedByUser: false,
          addedSource: null,
          inCandidates: candidatePaths.has(f.path),
        })),
      );
    }

    // Fire-and-forget audit entry (§4.1) — cost/latency queryable later.
    if (result.status === "ready") {
      audit.log({
        userId,
        teamId,
        action: "plan.generated",
        entityType: "change_plan",
        entityId: planRow?.id,
        metadata: {
          runId,
          revision: 1,
          model: PLANNER_MODEL,
          fileCount: result.plan?.files.length ?? 0,
          candidateCount: candidates.length,
          retrievalMode,
          retrievalMs,
          planningMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      });
    } else {
      audit.log({
        userId,
        teamId,
        action: "plan.failed",
        entityType: "change_plan",
        entityId: planRow?.id,
        metadata: { runId, revision: 1, error: result.error, retrievalMode, retrievalMs },
      });
    }

    return {
      planId: planRow?.id ?? null,
      status: result.status,
      fileCount: result.plan?.files.length ?? 0,
      plan: result.plan,
      retrievalMode,
      retrievalMs,
      planningMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      graphAgeHours,
      confidenceScore,
      confidenceSignals,
    };
  } catch (err) {
    logger.error({ runId, err }, "Persisting change plan failed");
    return {
      planId: null,
      status: result.status,
      fileCount: result.plan?.files.length ?? 0,
      plan: result.plan,
      retrievalMode,
      retrievalMs,
      planningMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      graphAgeHours,
      confidenceScore,
      confidenceSignals,
    };
  }
}
