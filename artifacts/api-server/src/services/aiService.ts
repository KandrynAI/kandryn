import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod/v4";
import { buildPrompt } from "../stack/prompts.js";
import { describeStack } from "./stackPromptBuilder.js";
import { logger } from "../lib/logger.js";
import type { DevCopilotTask } from "../../../../shared/types/task.js";
import type { CodeSuggestion } from "../../../../shared/types/codeSuggestion.js";
import type { StackProfile } from "../stack/detector.js";

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

interface ModelOutput {
  code: string;
  explanation: string;
  filePath: string;
}

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

function mockAntiGravity(stack: StackProfile): ModelOutput {
  const lang = stack.language === "typescript" ? "TypeScript" : stack.language;
  return {
    code: `// AntiGravity suggestion\n// Stack: ${stack.frontend}/${stack.backend}\nexport function antiGravitySuggestion(): void {\n  console.log('AntiGravity: ${lang} implementation');\n}`,
    explanation: `AntiGravity AI mock suggestion for ${lang} stack.`,
    filePath: `src/suggestions/antiGravity.${stack.language === "python" ? "py" : stack.language === "csharp" ? "cs" : stack.language === "java" ? "java" : "ts"}`,
  };
}

function mockCopilot(stack: StackProfile): ModelOutput {
  const lang = stack.language === "typescript" ? "TypeScript" : stack.language;
  return {
    code: `// GitHub Copilot suggestion\n// Stack: ${stack.frontend}/${stack.backend}\nexport function copilotSuggestion(): void {\n  console.log('Copilot: ${lang} implementation');\n}`,
    explanation: `GitHub Copilot mock suggestion for ${lang} stack.`,
    filePath: `src/suggestions/copilot.${stack.language === "python" ? "py" : stack.language === "csharp" ? "cs" : stack.language === "java" ? "java" : "ts"}`,
  };
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
  ): Promise<CodeSuggestion[]> {
    const prompt = buildPrompt(
      {
        title: task.title,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria.join("\n"),
      },
      codeContext,
      stack,
    );

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
        suggestions.push({
          agent,
          code: output.code,
          explanation: output.explanation,
          filePath: output.filePath,
          language: detectLanguage(output.filePath),
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
    return extractJson<ModelOutput>(block.text);
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
            'You are an expert software engineer. Always respond with valid JSON matching the schema: { "code": string, "explanation": string, "filePath": string }',
        },
        { role: "user", content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    return extractJson<ModelOutput>(text);
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
  overallNarrative: z.string().default(""),
  recommendation: z.enum(["Recommended", "Alternative"]).default("Alternative"),
  confidence: z.number().default(50),
  confidenceReason: z.string().default(""),
});
const ScorePairSchema = z.object({
  suggestionA: ScoreBreakdownSchema,
  suggestionB: ScoreBreakdownSchema,
});
type ScoreBreakdownOut = z.infer<typeof ScoreBreakdownSchema>;

/** Weighted average of the five 0–100 dimensions → an integer 0–10 overall. */
function weightedScore10(b: ScoreBreakdownOut): number {
  const raw =
    b.correctness.score * 0.35 +
    b.readability.score * 0.2 +
    b.minimalDiff.score * 0.15 +
    b.conventions.score * 0.15 +
    b.acCoverage.score * 0.15;
  return Math.round(Math.max(0, Math.min(100, raw)) / 10);
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
          return {
            ...s,
            score: weightedScore10(b),
            recommendation: b.recommendation,
            scoreBreakdown: b,
            scoreNarrative: b.overallNarrative,
          };
        });

        result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        result.forEach((s, i) => {
          const rec = i === 0 ? "Recommended" : "Alternative";
          s.recommendation = rec;
          if (s.scoreBreakdown) s.scoreBreakdown.recommendation = rec;
        });
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
    if (result.length > 0) result[0].recommendation = "Recommended";
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

Suggestion A (Raptia):
File: ${a.filePath}

\`\`\`${a.language}
${a.code.slice(0, 6000)}
\`\`\`

Suggestion B (Fovea):
File: ${b.filePath}

\`\`\`${b.language}
${b.code.slice(0, 6000)}
\`\`\`

Score each suggestion on five dimensions. For each dimension give:
- score: 0–100
- weight: the percentage weight this dimension carries (weights must sum to 100)
- verdict: "strong" (>=80), "adequate" (50–79), or "weak" (<50)
- reason: one specific sentence referencing actual code details

Dimensions and weights:
- correctness (35%): Does the code correctly solve the stated problem? Reference specific logic, conditions, or return values.
- readability (20%): Is the code clear and maintainable? Reference naming, structure, or complexity.
- minimalDiff (15%): Does it change only what is necessary? Reference scope of change.
- conventions (15%): Does it follow the conventions of a ${describeStack(stack) || "generic"} codebase? Check framework-specific patterns (${stack.backend || "general"} conventions, naming, structure) for the detected stack.
- acCoverage (15%): How completely does it address the acceptance criteria? Reference which criteria are and are not covered.

Then write:
- overallNarrative: 2-3 sentences explaining the ranking decision in plain English, referencing actual code details.
- recommendation: "Recommended" for the higher-scoring suggestion, "Alternative" for the other.
- confidence: 0–100. 90+ = clearly better, 70-89 = probably better, 50-69 = marginal, <50 = too close to call.
- confidenceReason: one sentence explaining the confidence level.

Return ONLY a JSON object, no markdown fences, with this exact structure:
{
  "suggestionA": {
    "correctness": { "score": N, "weight": 35, "verdict": "...", "reason": "..." },
    "readability": { "score": N, "weight": 20, "verdict": "...", "reason": "..." },
    "minimalDiff": { "score": N, "weight": 15, "verdict": "...", "reason": "..." },
    "conventions": { "score": N, "weight": 15, "verdict": "...", "reason": "..." },
    "acCoverage":  { "score": N, "weight": 15, "verdict": "...", "reason": "..." },
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

export interface TestGenInput {
  title: string;
  acceptanceCriteria: string[];
  suggestionCode: string;
  suggestionExplanation: string;
  framework: string;
}

function buildTestPrompt(input: TestGenInput, stack: StackProfile | null, strict: boolean): string {
  const fw = input.framework || stack?.testFramework || "the project's test framework";
  const lang = stack?.language ?? "the implementation language";
  return `You are a senior QA engineer writing test cases for a code change.

Work item: ${input.title}
Acceptance criteria:
${input.acceptanceCriteria.length ? input.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(none provided)"}

## Implemented change
${input.suggestionExplanation}

\`\`\`
${input.suggestionCode.slice(0, 6000)}
\`\`\`

## Task
Generate DETAILED test cases. For each acceptance criterion, write at minimum one
happy-path case and one edge/failure case. Then write one runnable automated test
file using ${fw} in ${lang}, matching the project's conventions, at a sensible
filePath next to the code under test.

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
### Suggestion ${i + 1} (${s.agent})
**File:** ${s.filePath}
**Language:** ${s.language}
**Explanation:** ${s.explanation}
\`\`\`${s.language}
${s.code}
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

