import { test } from "node:test";
import assert from "node:assert/strict";
import { BadRequestError } from "@anthropic-ai/sdk";
import {
  AEGIS_MODEL,
  AEGIS_ZDR_MODEL,
  AegisModelUnavailableError,
  AegisRefusalError,
  isRetentionError,
  runAegisScan,
  type PerFileScan,
  type AegisScanFile,
} from "./aegisService.js";

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

// ---------------------------------------------------------------------------
// Retention fallback (ZDR organisations)
//
// AEGIS_MODEL is a Covered Model: an Anthropic organisation on zero data
// retention is refused with a 400 on every request to it. Without a fallback,
// security scanning is unavailable to precisely the regulated customers who
// need it — and, because the gate fails closed, it fails as a *blocked gate*
// rather than as the configuration error it is.
// ---------------------------------------------------------------------------

/** The shape the SDK raises for the Covered-Model refusal. */
const retention = (): Error =>
  new BadRequestError(
    400,
    undefined,
    "400 In order to access this model, your organization or workspace must have data retention enabled.",
    new Headers(),
  );

test("every file retention-blocked → falls back and scans on the ZDR model", async () => {
  const seen: string[] = [];
  const scan = await runAegisScan({ ...base, files: [file("A.cs"), file("B.cs")] }, {}, {
    scanFile: async (f, model) => {
      seen.push(model);
      if (model === AEGIS_MODEL) throw retention();
      return clean(f.filePath);
    },
  });
  assert.equal(scan.gateDecision, "approved");
  assert.equal(scan.filesScanned, 2);
  assert.equal(scan.model, AEGIS_ZDR_MODEL);
  assert.match(scan.modelFallbackReason ?? "", /data retention/i);
  // Both models were attempted: the default first, the fallback for the retry.
  assert.ok(seen.includes(AEGIS_MODEL) && seen.includes(AEGIS_ZDR_MODEL));
});

test("normal path records the default model and no fallback reason", async () => {
  const scan = await runAegisScan({ ...base, files: [file("A.cs")] }, {}, { scanFile: async (f) => clean(f.filePath) });
  assert.equal(scan.model, AEGIS_MODEL);
  assert.equal(scan.modelFallbackReason, null);
});

test("a PARTIAL retention failure does not trigger the fallback — it stays a fail-closed block", async () => {
  // Retention is organisation-wide, so a mixed result is a real scan failure
  // wearing a retention error's clothes. Falling back there would quietly
  // re-scan files that had already been examined on a different model.
  let fallbackUsed = false;
  const scan = await runAegisScan({ ...base, files: [file("A.cs"), file("B.cs")] }, {}, {
    scanFile: async (f, model) => {
      if (model === AEGIS_ZDR_MODEL) fallbackUsed = true;
      if (f.filePath === "A.cs") throw retention();
      return clean(f.filePath);
    },
  });
  assert.equal(fallbackUsed, false);
  assert.equal(scan.model, AEGIS_MODEL);
  assert.equal(scan.gateDecision, "blocked");
  assert.deepEqual(scan.unscannedFiles, ["A.cs"]);
});

test("both models retention-blocked → throws rather than reporting a blocked gate", async () => {
  // The distinction this whole change exists for: nothing was examined, so
  // there is no security judgement to record. A blocked gate here would post a
  // red check to the pull request for a configuration problem.
  await assert.rejects(
    () => runAegisScan({ ...base, files: [file("A.cs")] }, {}, { scanFile: async () => Promise.reject(retention()) }),
    (err: unknown) => err instanceof AegisModelUnavailableError,
  );
});

test("an empty change set never triggers the fallback", async () => {
  // vacuous `every` on an empty result set would otherwise read as
  // "all files were retention-blocked" and fire a pointless second pass.
  let calls = 0;
  const scan = await runAegisScan({ ...base, files: [] }, {}, {
    scanFile: async (f) => {
      calls++;
      return clean(f.filePath);
    },
  });
  assert.equal(calls, 0);
  assert.equal(scan.model, AEGIS_MODEL);
  assert.equal(scan.gateDecision, "approved");
});

test("a model refusal blocks closed and says so in the gate reason", async () => {
  const scan = await runAegisScan({ ...base, files: [file("A.cs"), file("B.cs")] }, {}, {
    scanFile: async (f) =>
      f.filePath === "A.cs" ? Promise.reject(new AegisRefusalError("A.cs", "cyber")) : clean(f.filePath),
  });
  assert.equal(scan.gateDecision, "blocked");
  assert.deepEqual(scan.unscannedFiles, ["A.cs"]);
  assert.match(scan.gateReason, /declined to analyse 1 of them: A\.cs/);
});

test("gate reason omits the refusal clause when nothing was refused", async () => {
  const scan = await runAegisScan({ ...base, files: [file("A.cs")] }, {}, {
    scanFile: async () => Promise.reject(new Error("timeout")),
  });
  assert.equal(scan.gateDecision, "blocked");
  assert.doesNotMatch(scan.gateReason, /declined to analyse/);
});

test("isRetentionError only matches the retention 400, not other 400s", async () => {
  assert.equal(isRetentionError(retention()), true);
  assert.equal(isRetentionError(new BadRequestError(400, undefined, "400 max_tokens too large", new Headers())), false);
  assert.equal(isRetentionError(new Error("data retention")), false); // not an API error
});
