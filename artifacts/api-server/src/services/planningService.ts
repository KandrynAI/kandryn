import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { db, changePlansTable, changePlanFilesTable } from "@workspace/db";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";
import type { ChangePlan, PlannedFile, PlanCandidateFile, RetrievalMode, PlanStatus } from "../../../../shared/types/changePlan.js";
import type { StackProfile } from "../stack/detector.js";
import { describeStack } from "./stackPromptBuilder.js";
import { queryGraph, isGraphUsable } from "./graphifyService.js";
import { logger } from "../lib/logger.js";

const PLANNER_MODEL = "claude-sonnet-4-5";
const CANDIDATE_CAP = 25;
const FILE_CAP = 10; // §1.3 — never plan more than 10 files
const TREE_CAP = 600; // bound the directory listing sent to the planner

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
    .map((x) => ({ path: x.path, symbols: [], source: "keyword" as const }));
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
  }));
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
  workItem: { title: string; description?: string | null; acceptanceCriteria?: string[] };
  keywords: string[];
  stack: StackProfile;
  /** Full repo path list (git.fetchFilePaths) — always the primary planning input. */
  tree: string[];
  graph: GraphifyGraph | null;
  graphBuiltAt: Date | string | null;
  anthropicApiKey: string;
}

export interface PlanningSummary {
  planId: number | null;
  status: PlanStatus;
  fileCount: number;
  retrievalMode: RetrievalMode;
  retrievalMs: number;
  planningMs: number;
  inputTokens: number;
  outputTokens: number;
  graphAgeHours: number | null;
}

/**
 * Produce and persist a change plan for a run (revision 1). Never throws — a
 * failure is recorded as a `failed` plan and the run proceeds without one. The
 * graph is an enhancement on the tree-primary path: its absence is not an error.
 */
export async function runPlanning(input: PlanningInput): Promise<PlanningSummary> {
  const { runId, workItem, keywords, stack, tree, graph, graphBuiltAt, anthropicApiKey } = input;

  // Retrieval (tree-primary; graph enhances candidate quality when fresh).
  const tRetrieval = Date.now();
  const graphFresh = Boolean(graph?.nodes?.length) && isGraphUsable(graphBuiltAt);
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

    return {
      planId: planRow?.id ?? null,
      status: result.status,
      fileCount: result.plan?.files.length ?? 0,
      retrievalMode,
      retrievalMs,
      planningMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      graphAgeHours,
    };
  } catch (err) {
    logger.error({ runId, err }, "Persisting change plan failed");
    return {
      planId: null,
      status: result.status,
      fileCount: result.plan?.files.length ?? 0,
      retrievalMode,
      retrievalMs,
      planningMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      graphAgeHours,
    };
  }
}
