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
Return a single JSON object with this exact structure:
\`\`\`json
{
  "explanation": "<brief explanation of what changed and why>",
  "files": [ <one or more file operations> ]
}
\`\`\`

Each file operation is exactly one of:
- **Create a new file** — full content:
  \`{ "op": "create", "path": "relative/path.ext", "content": "<entire file contents>" }\`
- **Change an existing file** — search/replace hunks (NEVER reproduce the whole file):
  \`{ "op": "edit", "path": "relative/path.ext", "hunks": [ { "search": "<exact existing text>", "replace": "<new text>" } ] }\`
- **Remove a file**:
  \`{ "op": "delete", "path": "relative/path.ext" }\`

### Hunk rules (edits) — follow exactly, or the change will be rejected
- To create a new file use \`create\` with the full content. To change an existing file use \`edit\` with hunks. **Never reproduce a whole existing file.**
- \`search\` must match the existing file **exactly, character for character, including indentation and line breaks**. Do not reformat, retab, or "clean up" the surrounding text.
- \`search\` must be **unique** in the file. Include enough surrounding context — the enclosing method signature, a preceding comment, a nearby distinctive line — that the block appears **exactly once**. A bare \`}\` or a lone \`return;\` matches many places and will be rejected.
- Keep hunks **minimal**: one hunk per logical change, not one hunk spanning a whole class.
- Hunks **may not overlap**.

### Worked example — filling in a method body
Existing file \`Services/ReportingService.cs\` contains:
\`\`\`csharp
public async Task<AgingReport> GetClaimsAgingAsync(int policyId)
{
    // TODO: implement aging buckets
    throw new NotImplementedException();
}
\`\`\`
A correct edit (note the \`search\` includes the signature line for uniqueness, matches indentation exactly, and does not reproduce the rest of the file):
\`\`\`json
{
  "explanation": "Implement the claims aging buckets.",
  "files": [
    {
      "op": "edit",
      "path": "Services/ReportingService.cs",
      "hunks": [
        {
          "search": "    // TODO: implement aging buckets\n    throw new NotImplementedException();",
          "replace": "    var buckets = new[] { (0, 30, \\"0-30 days\\"), (31, 60, \\"31-60 days\\") };\n    return await BuildReportAsync(policyId, buckets);"
        }
      ]
    }
  ]
}
\`\`\`

Respond ONLY with the JSON object, no additional text.`;
}
