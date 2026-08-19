import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod/v4";
import { buildPrompt, buildPlanPrompt } from "../stack/prompts.js";
import { describeStack } from "./stackPromptBuilder.js";
import { logger } from "../lib/logger.js";
import { statsFor, countLines, renderChangeSet } from "./suggestionFilesUtil.js";
import { applyHunks, applyErrorMessage } from "./patchService.js";
import { computeFileDiff } from "./diffService.js";
import type { DevCopilotTask } from "../../../../shared/types/task.js";
import type { CodeSuggestion, SuggestionFile } from "../../../../shared/types/codeSuggestion.js";
import type { ChangePlan } from "../../../../shared/types/changePlan.js";
import type { CoherenceResult } from "../../../../shared/types/coherence.js";
import type { StackProfile } from "../stack/detector.js";

/**
 * Reads a source file (content + blob SHA) so the orchestrator can apply edit
 * hunks at generation time. Injected by the caller (backed by GitService); when
 * absent, `edit`/`delete` targets cannot be resolved and the suggestion is
 * marked invalid.
 */
export type FileReader = (path: string) => Promise<{ content: string; sha: string } | null>;

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  java: "java",
  cs: "csharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  cpp: "cpp",
  c: "c",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  sql: "sql",
  sh: "bash",
  bash: "bash",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? ext ?? "plaintext";
}

// ---------------------------------------------------------------------------
// JSON extraction — strips markdown code fences if present
// ---------------------------------------------------------------------------

function extractJson<T>(raw: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();
  return JSON.parse(stripped) as T;
}

// ---------------------------------------------------------------------------
// Suggestion schema from models
// ---------------------------------------------------------------------------

// Operation-based edits (Phase 1). Generation emits one file, but the shape is
// N-file so Phase 2 is additive.
// `deviationReason` (Phase 2 PR2) is set by the model on a file it adds beyond
// the plan; null/absent for a planned file.
const FileOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), path: z.string().min(1), content: z.string(), deviationReason: z.string().optional() }),
  z.object({
    op: z.literal("edit"),
    path: z.string().min(1),
    hunks: z
      .array(z.object({ search: z.string().min(1), replace: z.string() }))
      .min(1),
    deviationReason: z.string().optional(),
  }),
  z.object({ op: z.literal("delete"), path: z.string().min(1), deviationReason: z.string().optional() }),
]);

const ModelOutputSchema = z.object({
  explanation: z.string().default(""),
  files: z.array(FileOpSchema).min(1),
});

type FileOp = z.infer<typeof FileOpSchema>;
type ModelOutput = z.infer<typeof ModelOutputSchema>;

// ---------------------------------------------------------------------------
// Credentials type
// ---------------------------------------------------------------------------

export interface AICreds {
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

function mockExt(stack: StackProfile): string {
  return stack.language === "python" ? "py" : stack.language === "csharp" ? "cs" : stack.language === "java" ? "java" : "ts";
}

function mockAntiGravity(stack: StackProfile): ModelOutput {
  const lang = stack.language === "typescript" ? "TypeScript" : stack.language;
  return {
    explanation: `AntiGravity AI mock suggestion for ${lang} stack.`,
    files: [
      {
        op: "create",
        path: `src/suggestions/antiGravity.${mockExt(stack)}`,
        content: `// AntiGravity suggestion\n// Stack: ${stack.frontend}/${stack.backend}\nexport function antiGravitySuggestion(): void {\n  console.log('AntiGravity: ${lang} implementation');\n}`,
      },
    ],
  };
}

function mockCopilot(stack: StackProfile): ModelOutput {
  const lang = stack.language === "typescript" ? "TypeScript" : stack.language;
  return {
    explanation: `GitHub Copilot mock suggestion for ${lang} stack.`,
    files: [
      {
        op: "create",
        path: `src/suggestions/copilot.${mockExt(stack)}`,
        content: `// GitHub Copilot suggestion\n// Stack: ${stack.frontend}/${stack.backend}\nexport function copilotSuggestion(): void {\n  console.log('Copilot: ${lang} implementation');\n}`,
      },
    ],
  };
}

/**
 * Turn a model's file operations into a resolved change set (Phase 1): create
 * files carry full content; edits are applied against the current source (fetched
 * via the reader) and store the resolved content + source blob SHA; deletes carry
 * the source SHA for staleness. A suggestion is invalid if any file fails to
 * apply — invalid suggestions never reach Synthesia.
 */
async function resolveFileOps(
  ops: FileOp[],
  reader?: FileReader,
  planPaths?: Set<string>,
): Promise<{ files: SuggestionFile[]; valid: boolean }> {
  const files: SuggestionFile[] = [];
  let valid = true;
  let seq = 0;

  for (const op of ops) {
    // A file is a deviation when the model flagged it, or (with a plan) when its
    // path is not among the planned files. Null for a planned file.
    const deviationReason =
      op.deviationReason ?? (planPaths && !planPaths.has(op.path) ? "Added outside the plan." : null);

    if (op.op === "create") {
      const d = computeFileDiff("", op.content);
      files.push({
        seq: seq++,
        op: "create",
        filePath: op.path,
        content: op.content,
        hunks: null,
        sourceBlobSha: null,
        diff: d.hunks,
        resolved: true,
        applyStatus: "applied",
        applyError: null,
        deviationReason,
        linesAdded: d.linesAdded,
        linesRemoved: d.linesRemoved,
      });
      continue;
    }

    const src = reader ? await reader(op.path) : null;

    if (op.op === "delete") {
      files.push({
        seq: seq++,
        op: "delete",
        filePath: op.path,
        content: "",
        hunks: null,
        sourceBlobSha: src?.sha ?? null,
        diff: null,
        resolved: true,
        applyStatus: "applied",
        applyError: null,
        deviationReason,
        linesAdded: 0,
        linesRemoved: src ? countLines(src.content) : 0,
      });
      continue;
    }

    // edit
    if (!src) {
      valid = false;
      files.push({
        seq: seq++,
        op: "edit",
        filePath: op.path,
        content: "",
        hunks: op.hunks,
        sourceBlobSha: null,
        diff: null,
        resolved: false,
        applyStatus: "failed",
        applyError: `File not found in the repository: ${op.path}. An edit must target an existing file.`,
        deviationReason,
        linesAdded: 0,
        linesRemoved: 0,
      });
      continue;
    }

    const res = applyHunks(src.content, op.hunks);
    if (res.ok) {
      const d = computeFileDiff(src.content, res.content);
      files.push({
        seq: seq++,
        op: "edit",
        filePath: op.path,
        content: res.content,
        hunks: op.hunks,
        sourceBlobSha: src.sha,
        diff: d.hunks,
        resolved: true,
        applyStatus: "applied",
        applyError: null,
        deviationReason,
        linesAdded: d.linesAdded,
        linesRemoved: d.linesRemoved,
      });
    } else {
      valid = false;
      files.push({
        seq: seq++,
        op: "edit",
        filePath: op.path,
        content: "",
        hunks: op.hunks,
        sourceBlobSha: src.sha,
        diff: null,
        resolved: false,
        applyStatus: "failed",
        applyError: applyErrorMessage(res, op.path),
        deviationReason,
        linesAdded: 0,
        linesRemoved: 0,
      });
    }
  }

  return { files, valid };
}

// ---------------------------------------------------------------------------
// AIOrchestrator
// ---------------------------------------------------------------------------

export class AIOrchestrator {
  private readonly anthropicApiKey: string | undefined;
  private readonly openaiApiKey: string | undefined;

  constructor(creds?: AICreds) {
    this.anthropicApiKey = creds?.anthropicApiKey;
    this.openaiApiKey = creds?.openaiApiKey;
  }

  async generateSuggestions(
    task: DevCopilotTask,
    codeContext: string,
    stack: StackProfile,
    fileReader?: FileReader,
    planInput?: { plan: ChangePlan; context: string },
  ): Promise<CodeSuggestion[]> {
    const taskFields = {
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria.join("\n"),
    };
    // With a ready plan both agents implement the SAME plan (§2.1) — they compete
    // on implementation quality, not file selection. Without one, fall back to the
    // Phase 1 single-file prompt.
    const prompt = planInput
      ? buildPlanPrompt(taskFields, planInput.plan, planInput.context, stack)
      : buildPrompt(taskFields, codeContext, stack);
    const planPaths = planInput ? new Set(planInput.plan.files.map((f) => f.path)) : undefined;

    // Real agents. The AntiGravity/Copilot mocks return canned code, so they
    // are gated behind ENABLE_DEMO_AGENTS (default OFF) — persisted runs must
    // not let users commit canned suggestions (decision §10.3).
    const jobs: Array<[Promise<ModelOutput>, CodeSuggestion["agent"]]> = [
      [this.callClaude(prompt), "claude"],
      [this.callOpenAI(prompt), "openai"],
    ];
    if (process.env.ENABLE_DEMO_AGENTS === "true") {
      jobs.push([Promise.resolve(mockAntiGravity(stack)), "antigravity"]);
      jobs.push([Promise.resolve(mockCopilot(stack)), "copilot"]);
    }

    const results = await Promise.allSettled(jobs.map(([p]) => p));
    const suggestions: CodeSuggestion[] = [];

    const mapped: Array<[(typeof results)[number], CodeSuggestion["agent"]]> = results.map(
      (result, i) => [result, jobs[i][1]],
    );

    for (const [result, agent] of mapped) {
      if (result.status === "fulfilled") {
        const output = result.value;
        // Resolve the model's operations into a change set: create files carry
        // content; edits are applied against current source. With a plan, files
        // outside it are flagged as deviations (§2.4).
        const { files, valid } = await resolveFileOps(output.files, fileReader, planPaths);
        const primaryPath = files[0]?.filePath ?? "";
        suggestions.push({
          agent,
          files,
          valid,
          stats: statsFor(files),
          explanation: output.explanation,
          language: detectLanguage(primaryPath),
        });
      } else {
        logger.warn({ agent, err: result.reason }, `${agent} suggestion failed`);
      }
    }

    return suggestions;
  }

  private async callClaude(prompt: string): Promise<ModelOutput> {
    const client = new Anthropic({ apiKey: this.anthropicApiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Claude returned non-text block");
    return ModelOutputSchema.parse(extractJson<unknown>(block.text));
  }

  private async callOpenAI(prompt: string): Promise<ModelOutput> {
    const client = new OpenAI({ apiKey: this.openaiApiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert software engineer. Respond with a single valid JSON object " +
            'matching: { "explanation": string, "files": FileOp[] } where each FileOp is ' +
            'one of { "op": "create", "path": string, "content": string }, ' +
            '{ "op": "edit", "path": string, "hunks": [{ "search": string, "replace": string }] }, ' +
            'or { "op": "delete", "path": string }. Follow the operation and hunk rules in the user message exactly.',
        },
        { role: "user", content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    return ModelOutputSchema.parse(extractJson<unknown>(text));
  }
}

// ---------------------------------------------------------------------------
// SynthesisEngine
// ---------------------------------------------------------------------------

interface ScoredEntry {
  score: number;
  recommendation: string;
}

export interface SynthesisContext {
  title: string;
  acceptanceCriteria: string[];
}

const ScoreDimensionSchema = z.object({
  score: z.number(),
  weight: z.number(),
  verdict: z.enum(["strong", "adequate", "weak"]),
  reason: z.string().default(""),
});
const ScoreBreakdownSchema = z.object({
  correctness: ScoreDimensionSchema,
  readability: ScoreDimensionSchema,
  minimalDiff: ScoreDimensionSchema,
  conventions: ScoreDimensionSchema,
  acCoverage: ScoreDimensionSchema,
  // Static cross-file coherence (Phase 3). Not model-scored — injected
  // server-side from the mechanical checker. Optional so model output parses.
  coherence: ScoreDimensionSchema.optional(),
  // Behaviour signals (weight 0 — informational, do not affect the overall
  // score). Optional so a model omission or an older run still parses.
  ambiguityHandling: ScoreDimensionSchema.optional(),
  surgicalPrecision: ScoreDimensionSchema.optional(),
  overallNarrative: z.string().default(""),
  recommendation: z.enum(["Recommended", "Alternative"]).default("Alternative"),
  confidence: z.number().default(50),
  confidenceReason: z.string().default(""),
});
const ScorePairSchema = z.object({
  suggestionA: ScoreBreakdownSchema,
  suggestionB: ScoreBreakdownSchema,
});
export type ScoreBreakdownOut = z.infer<typeof ScoreBreakdownSchema>;

/**
 * Weighted average of the 0–100 dimensions → an integer 0–10 overall.
 * Coherence (Phase 3) is mechanical and carries 15%; when a suggestion has no
 * coherence result (single-file / non-C# / older run) it defaults to a neutral
 * 100 so the check neither penalises nor rewards a change it cannot evaluate.
 */
export function weightedScore10(b: ScoreBreakdownOut): number {
  const raw =
    b.correctness.score * 0.3 +
    (b.coherence?.score ?? 100) * 0.15 +
    b.conventions.score * 0.15 +
    b.acCoverage.score * 0.15 +
    b.readability.score * 0.15 +
    b.minimalDiff.score * 0.1;
  return Math.round(Math.max(0, Math.min(100, raw)) / 10);
}

/**
 * Turn the mechanical coherence result into a score dimension so it feeds the
 * weighted overall score. Score is the checker's 0–1 value scaled to 0–100.
 */
export function coherenceDimension(result: CoherenceResult): NonNullable<ScoreBreakdownOut["coherence"]> {
  const score = Math.round(Math.max(0, Math.min(1, result.score)) * 100);
  const verdict = result.status === "failed" ? "weak" : result.status === "warnings" ? "adequate" : "strong";
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  const reason =
    result.findings.length === 0
      ? "No cross-file coherence issues detected."
      : `${errors} error(s), ${warnings} warning(s) across the change set.`;
  return { score, weight: 15, verdict, reason };
}

/**
 * Assign Recommended to the highest-scoring suggestion that did NOT fail the
 * coherence check (Phase 3 exclusion rule). A coherence-failed suggestion is
 * never Recommended — even the sole suggestion in a run; if every suggestion
 * failed, none is recommended and all are surfaced as Alternatives. Expects the
 * list already sorted by score descending.
 */
export function assignRecommendation(sorted: CodeSuggestion[]): void {
  const winner = sorted.find((s) => s.coherence?.status !== "failed");
  for (const s of sorted) {
    const rec = s === winner ? "Recommended" : "Alternative";
    s.recommendation = rec;
    if (s.scoreBreakdown) s.scoreBreakdown.recommendation = rec;
  }
}

export class SynthesisEngine {
  private readonly anthropicApiKey: string | undefined;

  constructor(creds?: Pick<AICreds, "anthropicApiKey">) {
    this.anthropicApiKey = creds?.anthropicApiKey;
  }

  async synthesize(
    suggestions: CodeSuggestion[],
    stack: StackProfile,
    context?: SynthesisContext,
  ): Promise<CodeSuggestion[]> {
    if (suggestions.length === 0) return [];

    const client = new Anthropic({ apiKey: this.anthropicApiKey });

    // Rich per-dimension breakdown for the two-agent pair (A = first, B = second).
    if (suggestions.length >= 2) {
      try {
        const message = await client.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: buildScoreAnalysisPrompt(suggestions[0], suggestions[1], stack, context) }],
        });
        const block = message.content[0];
        if (block.type !== "text") throw new Error("Claude returned non-text block");
        const pair = ScorePairSchema.parse(extractJson(block.text));

        const breakdowns = [pair.suggestionA, pair.suggestionB];
        const result: CodeSuggestion[] = suggestions.map((s, i) => {
          const b = breakdowns[i];
          if (!b) return { ...s, score: 0, recommendation: "Alternative", scoreBreakdown: null, scoreNarrative: null };
          // Inject the mechanical coherence dimension so it feeds the weighted
          // score alongside the model-scored dimensions (Phase 3).
          if (s.coherence) b.coherence = coherenceDimension(s.coherence);
          return {
            ...s,
            score: weightedScore10(b),
            recommendation: b.recommendation,
            scoreBreakdown: b,
            scoreNarrative: b.overallNarrative,
          };
        });

        result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        assignRecommendation(result);
        return result;
      } catch (err) {
        logger.warn({ err }, "SynthesisEngine: breakdown scoring failed — falling back to simple scoring");
      }
    }

    // Fallback: simple 0–10 scoring (also used when there is a single suggestion).
    const synthesisPrompt = buildSynthesisPrompt(suggestions, stack);
    let scored: ScoredEntry[];
    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: synthesisPrompt }],
      });
      const block = message.content[0];
      if (block.type !== "text") throw new Error("Claude returned non-text block");
      scored = extractJson<ScoredEntry[]>(block.text);
    } catch (err) {
      logger.warn({ err }, "SynthesisEngine: Claude scoring failed — using default scores");
      scored = suggestions.map((_, i) => ({ score: suggestions.length - i, recommendation: "" }));
    }

    const result: CodeSuggestion[] = suggestions.map((s, i) => ({
      ...s,
      score: scored[i]?.score ?? 0,
      recommendation: scored[i]?.recommendation ?? "",
    }));
    result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    // Exclusion rule holds here too — a coherence-failed suggestion is never
    // Recommended, even when it is the only suggestion in the run (Phase 3).
    assignRecommendation(result);
    return result;
  }
}

function buildScoreAnalysisPrompt(
  a: CodeSuggestion,
  b: CodeSuggestion,
  stack: StackProfile,
  context?: SynthesisContext,
): string {
  const ac = context?.acceptanceCriteria?.length
    ? context.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "(none provided)";
  return `You are the Synthesis engine for Blue Mantis. You evaluate two code
suggestions for the same work item and explain your reasoning clearly.

Work item: ${context?.title ?? "(untitled)"}
Acceptance criteria:
${ac}

Repository stack: ${describeStack(stack) || "not detected"}

Suggestion A (Raptia) — ${a.files.length} file(s):
\`\`\`${a.language}
${renderChangeSet(a.files)}
\`\`\`

Suggestion B (Fovea) — ${b.files.length} file(s):
\`\`\`${b.language}
${renderChangeSet(b.files)}
\`\`\`

Score each suggestion on five dimensions. For each dimension give:
- score: 0–100
- weight: the percentage weight this dimension carries (use the exact weights below)
- verdict: "strong" (>=80), "adequate" (50–79), or "weak" (<50)
- reason: one specific sentence referencing actual code details

Dimensions and weights (a separate static coherence dimension carries the
remaining 15% and is scored mechanically, not by you):
- correctness (30%): Does the code correctly solve the stated problem? Reference specific logic, conditions, or return values.
- conventions (15%): Does it follow the conventions of a ${describeStack(stack) || "generic"} codebase? Check framework-specific patterns (${stack.backend || "general"} conventions, naming, structure) for the detected stack.
- acCoverage (15%): How completely does it address the acceptance criteria? Reference which criteria are and are not covered.
- readability (15%): Is the code clear and maintainable? Reference naming, structure, or complexity.
- minimalDiff (10%): Diff proportionality — is the change set proportionate to what the plan requires? Penalise files or edits beyond the plan's scope; do NOT penalise a change simply for spanning several files when the plan calls for them.

Also score two behaviour signals (weight 0 — informational only, they do NOT affect the overall ranking):
- ambiguityHandling (0%): Did the suggestion acknowledge any ambiguity in the acceptance criteria, or did it silently assume? Score 0-100: 100 = explicitly flagged ambiguity with reasoning; 70 = addressed all criteria without obvious ambiguity; 40 = silently picked one interpretation of an unclear criterion; 10 = ignored criteria that could not be addressed by this change. In the reason, name the ambiguity (or state there was none).
- surgicalPrecision (0%): Does the suggestion change only what the work item requires, or does it include unrequested additions? Score 0-100: 100 = every changed line maps to a criterion; 70 = minor unrequested additions (a comment, a type tightening); 40 = moderate scope creep (unrequested refactor or abstraction); 10 = significant unrequested changes unrelated to the work item. In the reason, name any unrequested change (or state there was none).

Then write:
- overallNarrative: 2-3 sentences explaining the ranking decision in plain English, referencing actual code details.
- recommendation: "Recommended" for the higher-scoring suggestion, "Alternative" for the other.
- confidence: 0–100. 90+ = clearly better, 70-89 = probably better, 50-69 = marginal, <50 = too close to call.
- confidenceReason: one sentence explaining the confidence level.

Return ONLY a JSON object, no markdown fences, with this exact structure:
{
  "suggestionA": {
    "correctness": { "score": N, "weight": 30, "verdict": "...", "reason": "..." },
    "conventions": { "score": N, "weight": 15, "verdict": "...", "reason": "..." },
    "acCoverage":  { "score": N, "weight": 15, "verdict": "...", "reason": "..." },
    "readability": { "score": N, "weight": 15, "verdict": "...", "reason": "..." },
    "minimalDiff": { "score": N, "weight": 10, "verdict": "...", "reason": "..." },
    "ambiguityHandling": { "score": N, "weight": 0, "verdict": "...", "reason": "..." },
    "surgicalPrecision": { "score": N, "weight": 0, "verdict": "...", "reason": "..." },
    "overallNarrative": "...",
    "recommendation": "Recommended" | "Alternative",
    "confidence": N,
    "confidenceReason": "..."
  },
  "suggestionB": { ...same shape... }
}`;
}

// ---------------------------------------------------------------------------
// Synthesis prompt builder
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AI work-item breakdown (spec §3.2 POST /work-items/:id/breakdown)
// ---------------------------------------------------------------------------

/** Thrown when the model's breakdown JSON can't be validated (route → 422). */
export class AIFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIFormatError";
  }
}

const BreakdownChildSchema = z.object({
  itemType: z.enum(["story", "task", "bug"]),
  title: z.string().min(1).max(200),
  description: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]),
});
const BreakdownSchema = z.object({
  children: z.array(BreakdownChildSchema).min(1).max(15),
});
export type BreakdownChild = z.infer<typeof BreakdownChildSchema>;

export interface BreakdownInput {
  itemType: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

function buildBreakdownPrompt(item: BreakdownInput, stack: StackProfile | null, strict: boolean): string {
  const childType = item.itemType === "epic" ? "stories" : "tasks";
  const stackLine = stack
    ? `The codebase stack is ${stack.frontend}/${stack.backend} (${stack.language}). Keep the breakdown grounded in that stack.`
    : "";
  return `You are a senior engineering lead decomposing a ${item.itemType} into concrete, independently deliverable ${childType}.

## Parent ${item.itemType}
Title: ${item.title}
Description: ${item.description || "(none)"}
Acceptance criteria:
${item.acceptanceCriteria.length ? item.acceptanceCriteria.map((c) => `- ${c}`).join("\n") : "(none)"}

${stackLine}

## Task
Propose 3–8 child work items that together deliver the parent. Each child must be small enough for one engineer to complete, with a clear title and 1–4 acceptance criteria. Use itemType "story" for sizeable sub-features, "task" for implementation work, "bug" only for defects.

## Output format
Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "children": [
    { "itemType": "task", "title": "...", "description": "...", "acceptanceCriteria": ["...", "..."] }
  ]
}
${strict ? "\nIMPORTANT: Your previous response was not valid JSON matching this schema. Return ONLY the raw JSON object with the exact keys shown." : ""}`;
}

/**
 * Ask Claude to decompose a work item into child proposals. Validates with zod,
 * retries once with a stricter instruction, then throws AIFormatError.
 * Proposals are NOT persisted — the caller reviews/edits/approves first.
 */
export async function generateBreakdown(
  item: BreakdownInput,
  creds: Pick<AICreds, "anthropicApiKey">,
  stack: StackProfile | null = null,
): Promise<BreakdownChild[]> {
  const client = new Anthropic({ apiKey: creds.anthropicApiKey });

  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: buildBreakdownPrompt(item, stack, attempt > 0) }],
    });
    const block = message.content[0];
    if (block.type !== "text") throw new AIFormatError("Model returned a non-text block.");

    try {
      const parsed = BreakdownSchema.parse(extractJson(block.text));
      return parsed.children;
    } catch (err) {
      logger.warn({ attempt, err }, "Breakdown parse failed");
      if (attempt === 1) throw new AIFormatError("The AI breakdown could not be parsed. Please try again.");
    }
  }
  throw new AIFormatError("The AI breakdown could not be parsed. Please try again.");
}

// ---------------------------------------------------------------------------
// AI test generation (spec §6 / §3.4 POST /work-items/:id/tests/generate)
// ---------------------------------------------------------------------------

const TestCaseSchema = z.object({
  id: z.string().default(""),
  title: z.string().min(1).max(200),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  type: z.enum(["happy-path", "edge-case", "failure"]).default("happy-path"),
  given: z.string().default(""),
  when: z.string().default(""),
  then: z.string().default(""),
  assertion: z.string().default(""),
  tags: z.array(z.string()).default([]),
});
const TestScriptSchema = z.object({
  filePath: z.string().min(1).max(300),
  code: z.string().min(1),
  framework: z.string().default(""),
});
const TestGenSchema = z.object({
  testCases: z.array(TestCaseSchema).min(1).max(30),
  testScript: TestScriptSchema,
});
export type GeneratedTestCase = z.infer<typeof TestCaseSchema>;
export type GeneratedTestScript = z.infer<typeof TestScriptSchema>;
export type GeneratedTests = z.infer<typeof TestGenSchema>;

/** One file in the committed change set the tests exercise. */
export interface TestGenFile {
  filePath: string;
  op: "create" | "edit" | "delete";
  code: string;
}

export interface TestGenInput {
  title: string;
  acceptanceCriteria: string[];
  /** The whole committed change set — tests exercise the behaviour it implements. */
  files: TestGenFile[];
  suggestionExplanation: string;
  framework: string;
}

function renderTestFiles(files: TestGenFile[]): string {
  if (files.length === 0) return "(no files)";
  return files
    .map((f) => (f.op === "delete" ? `--- delete ${f.filePath} ---\n(file deleted)` : `--- ${f.op} ${f.filePath} ---\n${f.code.slice(0, 4000)}`))
    .join("\n\n");
}

function buildTestPrompt(input: TestGenInput, stack: StackProfile | null, strict: boolean): string {
  const fw = input.framework || stack?.testFramework || "the project's test framework";
  const lang = stack?.language ?? "the implementation language";
  return `You are a senior QA engineer writing test cases for a code change.

Work item: ${input.title}
Acceptance criteria:
${input.acceptanceCriteria.length ? input.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(none provided)"}

## Implemented change (${input.files.length} file(s))
${input.suggestionExplanation}

${renderTestFiles(input.files)}

## Task
Generate DETAILED test cases. For each acceptance criterion, write at minimum one
happy-path case and one edge/failure case. The change may span several files (e.g.
a controller, a service, an interface, and a DTO) — test the BEHAVIOUR they
implement together (the endpoint / service method), not each file in isolation;
a DTO or interface has nothing to test on its own. Then write one runnable
automated test file using ${fw} in ${lang}, matching the project's conventions,
at a sensible filePath next to the code under test (prefer the entry point — the
controller or service that ties the change together).

Rules:
- Each test case must be specific and executable — not generic.
- Reference actual values from the code (function names, error types, status codes,
  field names) — not abstract descriptions.
- Happy path: normal successful execution.
- Edge cases: boundary values, empty inputs, concurrent calls.
- Failure cases: invalid input, missing data, downstream errors.
- For each case, identify the exact assertion (what to assert and why).
- id runs "tc-001", "tc-002", … in order.
- priority is "high" | "medium" | "low"; type is "happy-path" | "edge-case" | "failure".
- tags reference which acceptance criterion a case covers, e.g. "acceptance-criteria-2",
  plus "regression" where relevant.

## Output format
Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "testCases": [
    {
      "id": "tc-001",
      "title": "Short descriptive title (max 8 words)",
      "priority": "high",
      "type": "happy-path",
      "given": "The specific precondition — name real setup steps",
      "when": "The exact action — name the function, endpoint, or event",
      "then": "The precise assertion — what value, status, or state to check",
      "assertion": "The exact code assertion, e.g. expect(result.status).toBe(201)",
      "tags": ["acceptance-criteria-1", "regression"]
    }
  ],
  "testScript": { "filePath": "...", "code": "...", "framework": "${fw}" }
}
${strict ? "\nIMPORTANT: Your previous response was not valid JSON matching this schema. Return ONLY the raw JSON object with the exact keys shown." : ""}`;
}

/**
 * Generate Given/When/Then cases + a runnable test script for a committed
 * change. Validates with zod, retries once with a stricter instruction, then
 * throws AIFormatError (route → 422). Nothing is persisted here.
 */
export async function generateTests(
  input: TestGenInput,
  creds: Pick<AICreds, "anthropicApiKey">,
  stack: StackProfile | null = null,
): Promise<GeneratedTests> {
  const client = new Anthropic({ apiKey: creds.anthropicApiKey });

  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: buildTestPrompt(input, stack, attempt > 0) }],
    });
    const block = message.content[0];
    if (block.type !== "text") throw new AIFormatError("Model returned a non-text block.");
    try {
      const parsed = TestGenSchema.parse(extractJson(block.text));
      // Guarantee stable ids even if the model omitted or duplicated them.
      const seen = new Set<string>();
      parsed.testCases.forEach((tc, i) => {
        if (!tc.id || seen.has(tc.id)) tc.id = `tc-${String(i + 1).padStart(3, "0")}`;
        seen.add(tc.id);
      });
      return parsed;
    } catch (err) {
      logger.warn({ attempt, err }, "Test generation parse failed");
      if (attempt === 1) throw new AIFormatError("The generated tests could not be parsed. Please try again.");
    }
  }
  throw new AIFormatError("The generated tests could not be parsed. Please try again.");
}

function buildSynthesisPrompt(suggestions: CodeSuggestion[], stack: StackProfile): string {
  const suggestionDocs = suggestions
    .map(
      (s, i) => `
### Suggestion ${i + 1} (${s.agent}) — ${s.files.length} file(s)
**Language:** ${s.language}
**Explanation:** ${s.explanation}
\`\`\`${s.language}
${renderChangeSet(s.files)}
\`\`\``,
    )
    .join("\n");

  return `You are a senior code reviewer evaluating AI-generated code suggestions.

## Repository stack
${describeStack(stack) || "not detected"}

## Stack Profile
\`\`\`json
${JSON.stringify(stack, null, 2)}
\`\`\`

## Suggestions to Evaluate
${suggestionDocs}

## Scoring Criteria (each out of 10)
Score each suggestion on the following dimensions, then produce an overall score out of 10:

1. **Correctness** — Does the code correctly solve the likely task? No obvious bugs?
2. **Readability** — Is it clean, well-named, and easy to follow?
3. **Minimal Diff** — Does it avoid unnecessary changes? Is the change targeted?
4. **Convention Adherence** — Does it follow the conventions of the detected stack (${stack.frontend}/${stack.backend}/${stack.language})?

## Output Format
Return a JSON array with exactly ${suggestions.length} entries — one per suggestion in the same order:

\`\`\`json
[
  { "score": <number 0-10>, "recommendation": "<brief one-line review>" },
  ...
]
\`\`\`

Respond ONLY with the JSON array. No additional text.`;
}

