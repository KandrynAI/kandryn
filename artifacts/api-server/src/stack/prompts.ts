import type { StackProfile } from "./detector.js";
import type { ChangePlan } from "../../../../shared/types/changePlan.js";
import { buildStackAwarePrompt } from "../services/stackPromptBuilder.js";

type Task = {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
};

// Shared output contract for both the single-file (Phase 1) and plan-aware
// (Phase 2) prompts: the FileOp JSON shape + hunk rules + a worked example.
const FILE_OP_OUTPUT_RULES = `## Output Format
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
          "search": "    // TODO: implement aging buckets\\n    throw new NotImplementedException();",
          "replace": "    var buckets = new[] { (0, 30, \\"0-30 days\\"), (31, 60, \\"31-60 days\\") };\\n    return await BuildReportAsync(policyId, buckets);"
        }
      ]
    }
  ]
}
\`\`\`

Respond ONLY with the JSON object, no additional text.`;

function taskSection(task: Task): string {
  return `## Task
**Title:** ${task.title}
${task.description ? `**Description:** ${task.description}` : ""}
${task.acceptanceCriteria ? `**Acceptance Criteria:**\n${task.acceptanceCriteria}` : ""}`;
}

/** Single-file generation prompt (Phase 1) — used when there is no change plan. */
export function buildPrompt(task: Task, codeContext: string, stack: StackProfile): string {
  // Stack-aware instruction block (language/framework/db/tests/package-manager
  // conventions + "don't introduce a new stack" guardrail). Comes FIRST so the
  // model anchors on the stack before reading the work item and code context.
  const stackSection = buildStackAwarePrompt(stack);

  return `You are an expert software engineer specializing in ${stack.language}.

${stackSection}${taskSection(task)}

## Code Context
\`\`\`
${codeContext}
\`\`\`

## Stack Profile
\`\`\`json
${JSON.stringify(stack, null, 2)}
\`\`\`

${FILE_OP_OUTPUT_RULES}`;
}

/**
 * Plan-aware, multi-file generation prompt (Phase 2). Both agents receive the
 * SAME plan and compete on implementation quality. The plan lists which files to
 * touch; `planContext` carries the current content of the planned edit files and
 * a convention example per created file.
 */
export function buildPlanPrompt(task: Task, plan: ChangePlan, planContext: string, stack: StackProfile): string {
  const stackSection = buildStackAwarePrompt(stack);
  const planList = plan.files
    .map((f, i) => {
      const syms = f.symbols?.length ? ` (symbols: ${f.symbols.join(", ")})` : "";
      return `${i + 1}. [${f.op}] ${f.path} — ${f.rationale}${syms}`;
    })
    .join("\n");

  return `You are an expert software engineer specializing in ${stack.language}.

${stackSection}${taskSection(task)}

## Change plan — implement EVERY file below
${planList}
${plan.notes ? `\nPlanner notes: ${plan.notes}` : ""}

## Current contents of the planned files
The blocks below are the CURRENT source. For an \`edit\`, your \`search\` text must match this content exactly. A \`--- create <path> ---\` block, when present, is a nearby sibling shown only as a convention example — do not edit it.
\`\`\`
${planContext}
\`\`\`

## Stack Profile
\`\`\`json
${JSON.stringify(stack, null, 2)}
\`\`\`

## Rules for this multi-file change
- **Implement every file in the plan.** Do not skip a file because it seems minor.
- **Names must agree across files.** If the controller calls \`EndorseAsync\`, the interface declares \`EndorseAsync\` and the implementation defines it. Method names, parameter lists, type names, routes, and DTO shapes must line up across all files in the change.
- You may add a file that is **not** in the plan only if it is genuinely required for the change to compile or work — include a \`"deviationReason": "<why>"\` on that file. **Never remove or skip a planned file.**

${FILE_OP_OUTPUT_RULES}`;
}
