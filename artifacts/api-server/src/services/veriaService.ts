import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import type { ReviewResult } from "../../../../shared/types/reviewResult.js";

export interface VeriaInput {
  itemTitle: string;
  itemType: string;
  acceptanceCriteria: string[];
  suggestionAgent: string;
  suggestionFilePath: string;
  suggestionCode: string;
}

const ReviewFindingSchema = z.object({
  type: z.enum(["strength", "gap", "risk"]),
  title: z.string().min(1).max(120),
  detail: z.string().default(""),
  acRef: z.string().optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
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

function buildVeriaPrompt(input: VeriaInput): string {
  const ac =
    input.acceptanceCriteria.length > 0
      ? input.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "No acceptance criteria provided — review the code quality generally.";
  return `You are Veria, a senior code reviewer for Blue Mantis. You review
committed code changes against the original acceptance criteria.

Work item: ${input.itemTitle}
Type: ${input.itemType}

Acceptance criteria:
${ac}

Committed code change:
File: ${input.suggestionFilePath}
Agent: ${input.suggestionAgent}
\`\`\`
${input.suggestionCode.slice(0, 8000)}
\`\`\`

Review this code against the acceptance criteria. Be specific — reference actual
function names, variable names, error types, and line-level observations from the
code above. Do not write generic praise or generic warnings.

Return ONLY a JSON object. No preamble, no markdown fences.

{
  "summary": "2-3 sentences. Overall assessment of whether this change delivers on the work item. Reference the code specifically.",
  "acCoverage": {
    "covered":  ["Quote each AC criterion that is fully addressed by the code"],
    "missed":   ["Quote each AC criterion not addressed at all"],
    "partial":  ["Quote each AC criterion partially addressed — append what is missing in parentheses"]
  },
  "findings": [
    { "type": "strength", "title": "6 words max", "detail": "1-2 sentences. Reference specific code.", "acRef": "Which AC item this supports (optional)" },
    { "type": "gap", "title": "6 words max", "detail": "What is missing and why it matters.", "acRef": "Which AC item this relates to (optional)", "severity": "low | medium | high" },
    { "type": "risk", "title": "6 words max", "detail": "What could fail in production or code review.", "severity": "low | medium | high" }
  ],
  "reviewerNote": "One sentence only: what the human reviewer should focus on most."
}

Rules:
- Include 2-3 strengths.
- Include 1-3 gaps or risks (omit if genuinely none found).
- acCoverage arrays may be empty if all criteria fall in one bucket.
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
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    messages: [{ role: "user", content: buildVeriaPrompt(input) }],
  });

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

  return { ...parsed, generatedAt: new Date().toISOString() };
}
