import type { StackProfile } from "./detector.js";
import { buildStackAwarePrompt } from "../services/stackPromptBuilder.js";

type Task = {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
};

export function buildPrompt(
  task: Task,
  codeContext: string,
  stack: StackProfile,
): string {
  // Stack-aware instruction block (language/framework/db/tests/package-manager
  // conventions + "don't introduce a new stack" guardrail). Comes FIRST so the
  // model anchors on the stack before reading the work item and code context.
  const stackSection = buildStackAwarePrompt(stack);

  return `You are an expert software engineer specializing in ${stack.language}.

${stackSection}## Task
**Title:** ${task.title}
${task.description ? `**Description:** ${task.description}` : ""}
${task.acceptanceCriteria ? `**Acceptance Criteria:**\n${task.acceptanceCriteria}` : ""}

## Code Context
\`\`\`
${codeContext}
\`\`\`

## Stack Profile
\`\`\`json
${JSON.stringify(stack, null, 2)}
\`\`\`

## Output Format
Return a JSON object with this exact structure:
\`\`\`json
{
  "code": "<the generated code>",
  "explanation": "<brief explanation of what was generated and why>",
  "filePath": "<suggested file path for this code>"
}
\`\`\`

Respond ONLY with the JSON object, no additional text.`;
}
