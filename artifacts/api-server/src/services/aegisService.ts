import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import type {
  AegisScanResult,
  AegisFinding,
  SecuritySeverity,
  OwaspCategory,
} from "../../../../shared/types/aegisResult.js";

/** One changed file to scan independently. */
export interface AegisScanFile {
  filePath: string;
  code: string;
  language?: string;
}

export interface AegisInput {
  itemTitle: string;
  itemType: string;
  acceptanceCriteria: string[];
  /** The committed change set — every file is scanned in its own request. */
  files: AegisScanFile[];
  stackDesc?: string;
}

// A stop gate must give every changed file independent attention: a per-file
// scan makes "no findings" mean "examined and clean", never "crowded out of one
// big prompt". It is also the defensible control statement — every changed file
// received an independent security scan.
const PER_FILE_TIMEOUT_MS = 90_000;

/**
 * How many per-file scans are in flight at once.
 *
 * A committed diff is a handful of files, so this never used to matter. It does
 * now: the same function backs the baseline scan's fallback path, and firing
 * five hundred requests at once earns a wall of 429s. Because the gate fails
 * closed, those rate-limited files land in `unscannedFiles` and block — a
 * self-inflicted block with no security meaning behind it.
 */
const SCAN_CONCURRENCY = 8;

/**
 * Promise.allSettled semantics with a ceiling on concurrency. Results stay in
 * input order, which the caller relies on to map each result back to its file.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

const PER_FILE_PROMPT = (item: { itemTitle: string; stackDesc?: string }, file: AegisScanFile): string => `
You are Aegis, a senior application security engineer.
Your role is to scan ONE committed file for security vulnerabilities.

Work item: ${item.itemTitle}
File: ${file.filePath}
Stack: ${item.stackDesc ?? "unknown"}

Committed code:
\`\`\`${file.language ?? ""}
${file.code.slice(0, 8000)}
\`\`\`

Perform a thorough security review of THIS FILE ONLY. Check for:
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
  "summary": "1-2 sentences on this file's security posture.",
  "findings": [
    {
      "severity": "critical|high|medium|low|info",
      "owasp": "A03:Injection",
      "title": "Max 8 words describing the issue",
      "detail": "2-3 sentences. Reference specific code.",
      "lineRef": "L42",
      "remediation": "1-2 sentences. Concrete fix.",
      "cveRef": "CVE-XXXX-XXXX (only if genuinely applicable)"
    }
  ]
}

Rules:
- If no vulnerabilities: return an empty findings array.
- lineRef is a line number within THIS file (e.g. "L42"); omit if unknown.
- cveRef: omit the field entirely if not applicable (do not guess CVEs).
- Return valid JSON only. No trailing commas.
`;

/**
 * The baseline variant of the per-file prompt.
 *
 * The runtime prompt frames the file as "ONE committed file" under a named work
 * item, because that is what it is. A baseline scan has neither: nothing was
 * committed and there is no work item, so the same wording would ask the model
 * to reason about a change that does not exist. The security checklist and the
 * output contract are identical — only the framing differs — so findings from
 * the two paths remain directly comparable.
 */
export function baselineFilePrompt(file: AegisScanFile, stackDesc?: string): string {
  return PER_FILE_PROMPT({ itemTitle: BASELINE_ITEM_TITLE, stackDesc }, file).replace(
    "Your role is to scan ONE committed file for security vulnerabilities.",
    "Your role is to scan ONE file of an existing codebase for security vulnerabilities.",
  ).replace("Committed code:", "Source:");
}

/** Stands in for the work-item title the runtime prompt names; there is none here. */
const BASELINE_ITEM_TITLE = "Baseline security review of an existing codebase";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`scan timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** The leading path token of a lineRef, if it carries one (for reliability logging). */
function lineRefPath(lineRef: string | undefined): string | null {
  if (!lineRef) return null;
  const head = lineRef.split(":")[0]?.trim() ?? "";
  return head.includes("/") || /\.[a-z0-9]+$/i.test(head) ? head : null;
}

export interface PerFileScan {
  filePath: string;
  summary: string;
  findings: Array<Omit<AegisFinding, "id">>;
}

/** Scan a single file. Throws (→ counted as unscanned) on error/timeout/parse-fail. */
async function scanOneFile(
  client: Anthropic,
  item: { itemTitle: string; stackDesc?: string },
  file: AegisScanFile,
): Promise<PerFileScan> {
  const response = await withTimeout(
    client.messages.create({
      model: "claude-fable-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: PER_FILE_PROMPT(item, file) }],
    }),
    PER_FILE_TIMEOUT_MS,
  );

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();

  return parseFileScan(raw, file.filePath);
}

/**
 * Turn one model response into a scan of one file. Throws on a parse failure,
 * which the live path counts as unscanned and the batch path records as a
 * skipped file. Shared by both so a batched scan and a live scan can never
 * interpret the same JSON differently.
 */
export function parseFileScan(raw: string, filePath: string): PerFileScan {
  const parsed = ScanSchema.parse(extractJson(raw));

  // filePath is assigned from the scanned file — never model-tagged — so a
  // finding can never be attached to a neighbouring file. lineRef is only
  // checked to log how reliably the model references its own file.
  let mismatches = 0;
  const findings = parsed.findings.map((f) => {
    const refPath = lineRefPath(f.lineRef);
    if (refPath && refPath !== filePath && !filePath.endsWith(refPath)) mismatches++;
    return {
      severity: f.severity as SecuritySeverity,
      owasp: f.owasp as OwaspCategory,
      filePath,
      title: f.title,
      detail: f.detail,
      lineRef: f.lineRef,
      remediation: f.remediation,
      cveRef: f.cveRef,
    };
  });
  if (mismatches > 0) {
    logger.warn({ filePath, mismatches, total: findings.length }, "Aegis lineRef path disagreed with the scanned file");
  }
  return { filePath, summary: parsed.summary, findings };
}

/**
 * Run Aegis over a committed change set. Each changed file is scanned in its own
 * request, in parallel. The gate FAILS CLOSED: any file that errors, times out,
 * or is otherwise not scanned forces a BLOCK — an unscanned file is not a clean
 * file. Never throws; a total failure returns a blocked result with every file
 * listed as unscanned.
 */
export async function runAegisScan(
  input: AegisInput,
  creds: { anthropicApiKey?: string },
  // The per-file scanner is injectable so the fail-closed gate can be unit-tested
  // without the model. Defaults to the real claude-fable-5 scan.
  deps?: { scanFile?: (file: AegisScanFile) => Promise<PerFileScan> },
): Promise<AegisScanResult> {
  const client = new Anthropic({ apiKey: creds.anthropicApiKey });
  const item = { itemTitle: input.itemTitle, stackDesc: input.stackDesc };
  const scanFile = deps?.scanFile ?? ((f: AegisScanFile) => scanOneFile(client, item, f));
  const filesTotal = input.files.length;

  // Deterministic fault injection for exercising the fail-closed gate on a real
  // run (default OFF — unset in production). When AEGIS_FORCE_FAIL_PATH is set,
  // any file whose path contains that substring is forced to fail its scan, so
  // it lands in unscannedFiles and blocks the gate exactly as a genuine
  // error/timeout/parse failure would.
  const forceFailPath = process.env.AEGIS_FORCE_FAIL_PATH?.trim();
  const runScan = (f: AegisScanFile): Promise<PerFileScan> =>
    forceFailPath && f.filePath.includes(forceFailPath)
      ? Promise.reject(new Error(`AEGIS_FORCE_FAIL_PATH matched "${f.filePath}" — forced scan failure (test hook).`))
      : scanFile(f);

  const results = await mapWithConcurrency(input.files, SCAN_CONCURRENCY, runScan);

  const scannedFiles: string[] = [];
  const unscannedFiles: string[] = [];
  const summaries: string[] = [];
  const rawFindings: Array<Omit<AegisFinding, "id">> = [];
  results.forEach((r, i) => {
    const path = input.files[i].filePath;
    if (r.status === "fulfilled") {
      scannedFiles.push(path);
      if (r.value.summary) summaries.push(`${path}: ${r.value.summary}`);
      rawFindings.push(...r.value.findings);
    } else {
      unscannedFiles.push(path);
      logger.warn({ filePath: path, err: r.reason }, "Aegis per-file scan failed — file left unscanned (gate will block)");
    }
  });

  // Stable, sequential ids across the union of findings.
  const findings: AegisFinding[] = rawFindings.map((f, i) => ({ id: `aegis-${String(i + 1).padStart(3, "0")}`, ...f }));

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;

  // FAIL CLOSED: unscanned files block regardless of findings.
  const blockedByCoverage = unscannedFiles.length > 0;
  const blockedByFindings = criticalCount > 0 || highCount > 0;
  const gateDecision: "approved" | "blocked" = blockedByCoverage || blockedByFindings ? "blocked" : "approved";

  const gateReason = blockedByCoverage
    ? `Could not scan ${unscannedFiles.length} of ${filesTotal} file(s): ${unscannedFiles.join(", ")}. Gate blocked (fail-closed).`
    : blockedByFindings
      ? `${criticalCount} critical, ${highCount} high finding(s) across ${scannedFiles.length} file(s).`
      : `${findings.length} finding(s) across ${scannedFiles.length} file(s), none critical/high.`;

  return {
    summary: summaries.join("\n") || "No security-relevant findings.",
    findings,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    gateDecision,
    gateReason,
    scannedFiles,
    unscannedFiles,
    filesTotal,
    filesScanned: scannedFiles.length,
    generatedAt: new Date().toISOString(),
  };
}
