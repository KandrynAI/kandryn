import { test } from "node:test";
import assert from "node:assert/strict";
import { runAegisScan, type PerFileScan, type AegisScanFile } from "./aegisService.js";

const file = (filePath: string): AegisScanFile => ({ filePath, code: "x" });
const clean = (filePath: string): PerFileScan => ({ filePath, summary: "", findings: [] });
const withHigh = (filePath: string): PerFileScan => ({
  filePath,
  summary: "",
  findings: [{ severity: "high", owasp: "A03:Injection", filePath, title: "t", detail: "d", remediation: "r" }],
});
const base = { itemTitle: "t", itemType: "task", acceptanceCriteria: [] as string[] };

test("all files scanned clean → approved, full coverage", async () => {
  const scan = await runAegisScan({ ...base, files: [file("A.cs"), file("B.cs")] }, {}, { scanFile: async (f) => clean(f.filePath) });
  assert.equal(scan.gateDecision, "approved");
  assert.equal(scan.filesScanned, 2);
  assert.equal(scan.filesTotal, 2);
  assert.deepEqual(scan.unscannedFiles, []);
  assert.equal(scan.criticalCount + scan.highCount, 0);
});

test("a file that fails to scan blocks the gate (fail closed), with no findings", async () => {
  const scan = await runAegisScan(
    { ...base, files: [file("A.cs"), file("B.cs"), file("C.cs")] },
    {},
    { scanFile: async (f) => (f.filePath === "B.cs" ? Promise.reject(new Error("boom")) : clean(f.filePath)) },
  );
  assert.equal(scan.gateDecision, "blocked");
  assert.deepEqual(scan.unscannedFiles, ["B.cs"]);
  assert.equal(scan.filesScanned, 2);
  assert.match(scan.gateReason, /Could not scan 1 of 3/);
  assert.equal(scan.criticalCount, 0); // blocked despite zero findings — unscanned ≠ clean
});

test("a high finding blocks even when every file scanned", async () => {
  const scan = await runAegisScan(
    { ...base, files: [file("A.cs"), file("B.cs")] },
    {},
    { scanFile: async (f) => (f.filePath === "A.cs" ? withHigh(f.filePath) : clean(f.filePath)) },
  );
  assert.equal(scan.gateDecision, "blocked");
  assert.equal(scan.highCount, 1);
  assert.deepEqual(scan.unscannedFiles, []);
  // The finding keeps the file it was scanned in and gets a sequential id.
  assert.equal(scan.findings[0].filePath, "A.cs");
  assert.match(scan.findings[0].id, /^aegis-\d{3}$/);
});

test("total scan failure blocks with every file unscanned", async () => {
  const scan = await runAegisScan(
    { ...base, files: [file("A.cs"), file("B.cs")] },
    {},
    { scanFile: async () => Promise.reject(new Error("api down")) },
  );
  assert.equal(scan.gateDecision, "blocked");
  assert.equal(scan.filesScanned, 0);
  assert.deepEqual([...scan.unscannedFiles].sort(), ["A.cs", "B.cs"]);
});

test("empty change set → approved, nothing to scan", async () => {
  const scan = await runAegisScan({ ...base, files: [] }, {}, { scanFile: async (f) => clean(f.filePath) });
  assert.equal(scan.gateDecision, "approved");
  assert.equal(scan.filesTotal, 0);
  assert.equal(scan.filesScanned, 0);
});

test("AEGIS_FORCE_FAIL_PATH forces a fail-closed block on the matched file", async () => {
  // Deterministic fault injection: even with a scanner that would succeed for
  // every file, the matched path is forced to fail and blocks the gate — the
  // reproducible on-record equivalent of run #19's natural .csproj failure.
  const prev = process.env.AEGIS_FORCE_FAIL_PATH;
  process.env.AEGIS_FORCE_FAIL_PATH = "PnC.Api.csproj";
  try {
    const scan = await runAegisScan(
      { ...base, files: [file("src/PnC.Api/Controllers/Policies.cs"), file("src/PnC.Api/Services/PolicyService.cs"), file("src/PnC.Api/PnC.Api.csproj")] },
      {},
      { scanFile: async (f) => clean(f.filePath) }, // scanner succeeds for all — the hook overrides
    );
    assert.equal(scan.gateDecision, "blocked");
    assert.equal(scan.filesTotal, 3);
    assert.equal(scan.filesScanned, 2);
    assert.deepEqual(scan.unscannedFiles, ["src/PnC.Api/PnC.Api.csproj"]);
    assert.match(scan.gateReason, /Could not scan 1 of 3/);
  } finally {
    if (prev === undefined) delete process.env.AEGIS_FORCE_FAIL_PATH;
    else process.env.AEGIS_FORCE_FAIL_PATH = prev;
  }
});

test("AEGIS_FORCE_FAIL_PATH unset → no effect (default off)", async () => {
  const prev = process.env.AEGIS_FORCE_FAIL_PATH;
  delete process.env.AEGIS_FORCE_FAIL_PATH;
  try {
    const scan = await runAegisScan({ ...base, files: [file("A.cs"), file("PnC.Api.csproj")] }, {}, { scanFile: async (f) => clean(f.filePath) });
    assert.equal(scan.gateDecision, "approved");
    assert.equal(scan.filesScanned, 2);
    assert.deepEqual(scan.unscannedFiles, []);
  } finally {
    if (prev !== undefined) process.env.AEGIS_FORCE_FAIL_PATH = prev;
  }
});

test("findings from multiple files are unioned and re-numbered", async () => {
  const scan = await runAegisScan(
    { ...base, files: [file("A.cs"), file("B.cs")] },
    {},
    { scanFile: async (f) => withHigh(f.filePath) },
  );
  assert.equal(scan.findings.length, 2);
  assert.deepEqual(scan.findings.map((x) => x.filePath).sort(), ["A.cs", "B.cs"]);
  assert.deepEqual(scan.findings.map((x) => x.id), ["aegis-001", "aegis-002"]);
  assert.equal(scan.highCount, 2);
});
