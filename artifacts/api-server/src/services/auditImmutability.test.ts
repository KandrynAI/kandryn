import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// Governance item 5: the audit log is append-only at the application layer.
// These guardrail tests scan the API-server source and fail if any code path
// updates an audit_log row, or deletes one outside the retention job. They
// enforce the invariant statically (no DB needed) so a future change that adds a
// mutation path breaks CI rather than silently weakening the audit trail.

const here = dirname(fileURLToPath(import.meta.url)); // .../src/services
const apiSrc = join(here, ".."); // .../src
const RETENTION_FILE = "services/auditService.ts"; // the only sanctioned deleter

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const files = walk(apiSrc);
const rel = (f: string) => relative(apiSrc, f).replace(/\\/g, "/");

test("audit_log is never updated at the application layer", () => {
  const offenders = files.filter((f) => {
    const src = readFileSync(f, "utf8");
    return /\.update\(\s*auditLogTable/.test(src) || /\bupdate\s+audit_log\b/i.test(src);
  });
  assert.deepEqual(offenders.map(rel), [], "audit_log must be append-only — an UPDATE path exists");
});

test("audit_log is deleted only by the retention job", () => {
  const offenders = files.filter((f) => {
    const src = readFileSync(f, "utf8");
    const hasDelete = /\.delete\(\s*auditLogTable/.test(src) || /delete\s+from\s+audit_log/i.test(src);
    return hasDelete && rel(f) !== RETENTION_FILE;
  });
  assert.deepEqual(offenders.map(rel), [], `audit_log deletes are allowed only in ${RETENTION_FILE}`);
});
