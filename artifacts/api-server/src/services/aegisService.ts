import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import type {
  AegisScanResult,
  AegisFinding,
  SecuritySeverity,
  OwaspCategory,
} from "../../../../shared/types/aegisResult.js";

export interface AegisInput {
  itemTitle: string;
  itemType: string;
  acceptanceCriteria: string[];
  filePath: string;
  code: string;
  language?: string;
  stackDesc?: string;
}

const FindingSchema = z.object({
  id: z.string().optional(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  owasp: z.string().default("Other"),
  title: z.string().min(1),
  detail: z.string().default(""),
  lineRef: z.string().optional(),
  remediation: z.string().default(""),
  cveRef: z.string().optional(),
});
const ScanSchema = z.object({
  summary: z.string().default(""),
  findings: z.array(FindingSchema).default([]),
  gateReason: z.string().default(""),
});

function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```$/im, "")
    .trim();
  return JSON.parse(cleaned);
}

const AEGIS_PROMPT = (input: AegisInput): string => `
You are Aegis, a senior application security engineer.
Your role is to scan committed code changes for security vulnerabilities.

Work item: ${input.itemTitle}
File: ${input.filePath}
Stack: ${input.stackDesc ?? "unknown"}

Committed code:
\`\`\`${input.language ?? ""}
${input.code.slice(0, 8000)}
\`\`\`

Perform a thorough security review. Check for:
- Injection vulnerabilities (SQL, NoSQL, command, LDAP, XPath)
- Authentication and authorisation flaws
- Hardcoded secrets, API keys, or credentials
- Insecure data exposure or logging of sensitive values
- Cryptographic weaknesses (weak algorithms, improper key handling)
- Input validation failures
- Dependency on vulnerable patterns
- SSRF, XXE, or deserialization issues
- Missing rate limiting on sensitive endpoints
- OWASP Top 10 (2021) categories

Be specific — reference actual variable names, function names, and
line-level observations from the code above.

Severity definitions:
  CRITICAL: exploitable immediately, critical data exposure or RCE
  HIGH:     significant risk, likely to be exploited
  MEDIUM:   moderate risk, requires specific conditions
  LOW:      minor risk, defence-in-depth improvement
  INFO:     observation, not a vulnerability

Return ONLY a JSON object. No preamble. No markdown.

{
  "summary": "2-3 sentences. Overall security posture of this change.",
  "findings": [
    {
      "id": "aegis-001",
      "severity": "critical|high|medium|low|info",
      "owasp": "A03:Injection",
      "title": "Max 8 words describing the issue",
      "detail": "2-3 sentences. Reference specific code.",
      "lineRef": "src/file.ts:L42",
      "remediation": "1-2 sentences. Concrete fix.",
      "cveRef": "CVE-XXXX-XXXX (only if genuinely applicable)"
    }
  ],
  "gateDecision": "approved|blocked",
  "gateReason": "One sentence. Blocked if any critical or high findings exist."
}

Rules:
- If no vulnerabilities found: return empty findings array and approved gate
- gateDecision MUST be "blocked" if severity is critical or high
- gateDecision is "approved" if all findings are medium, low, or info
- cveRef: omit the field entirely if not applicable (do not guess CVEs)
- Return valid JSON only. No trailing commas.
`;

/**
 * Run the Aegis security scan. Uses the user's Anthropic key (per-user creds,
 * like the rest of the pipeline) and the claude-fable-5 model. Throws on an
 * unparseable/invalid response so the route can mark the scan failed. The gate
 * decision is enforced in code regardless of the model's own gateDecision.
 */
export async function runAegisScan(
  input: AegisInput,
  creds: { anthropicApiKey?: string },
): Promise<AegisScanResult> {
  const client = new Anthropic({ apiKey: creds.anthropicApiKey });

  const response = await client.messages.create({
    // claude-fable-5 (Mythos-class) — passed as a string literal; the SDK
    // accepts arbitrary model ids.
    model: "claude-fable-5",
    max_tokens: 2000,
    messages: [{ role: "user", content: AEGIS_PROMPT(input) }],
  });

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();

  let parsed: z.infer<typeof ScanSchema>;
  try {
    parsed = ScanSchema.parse(extractJson(raw));
  } catch (err) {
    logger.warn({ err }, "Aegis returned unparseable/invalid JSON");
    throw new Error(`Aegis returned unparseable JSON: ${raw.slice(0, 200)}`);
  }

  // Assign sequential IDs if the model omitted them.
  const findings: AegisFinding[] = parsed.findings.map((f, i) => ({
    id: f.id ?? `aegis-${String(i + 1).padStart(3, "0")}`,
    severity: f.severity as SecuritySeverity,
    owasp: f.owasp as OwaspCategory,
    title: f.title,
    detail: f.detail,
    lineRef: f.lineRef,
    remediation: f.remediation,
    cveRef: f.cveRef,
  }));

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;

  // Enforce the gate rule in code regardless of what the model returned.
  const gateDecision: "approved" | "blocked" =
    criticalCount > 0 || highCount > 0 ? "blocked" : "approved";

  return {
    summary: parsed.summary,
    findings,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    gateDecision,
    gateReason: parsed.gateReason,
    scannedFile: input.filePath,
    generatedAt: new Date().toISOString(),
  };
}
