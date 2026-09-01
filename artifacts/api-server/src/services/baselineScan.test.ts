import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverFiles, estimateScan, findingFingerprint, sortFindings, MAX_FILES } from "./baselineScanCore.js";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";

const graph = (files: { sourceFile: string; fileType: string }[]): GraphifyGraph => ({
  nodes: files.map((f, i) => ({
    id: `${f.sourceFile}::n${i}`,
    label: `n${i}`,
    fileType: f.fileType,
    sourceFile: f.sourceFile,
    sourceLocation: `${f.sourceFile}:1`,
  })),
  edges: [],
  metadata: { files: files.length, nodes: files.length, edges: 0 },
});

// --- File discovery --------------------------------------------------------

test("a built graph supplies the file list, and only its code nodes", () => {
  const g = graph([
    { sourceFile: "src/pay.ts", fileType: "code" },
    { sourceFile: "README.md", fileType: "doc" },
    { sourceFile: "tsconfig.json", fileType: "config" },
    { sourceFile: "src/pay.ts", fileType: "code" }, // same file, second symbol
  ]);
  const { paths, source } = discoverFiles(g, ["should", "be", "ignored"]);
  assert.deepEqual(paths, ["src/pay.ts"]);
  assert.equal(source, "graph");
});

test("no graph falls back to the tree, filtered by extension", () => {
  const { paths, source } = discoverFiles(null, ["src/a.ts", "README.md", "logo.png", "src/b.py"]);
  assert.deepEqual(paths, ["src/a.ts", "src/b.py"]);
  assert.equal(source, "tree");
});

test("vendored and generated trees are excluded from both sources", () => {
  const fromTree = discoverFiles(null, ["src/a.ts", "node_modules/x/i.js", "dist/b.js", "vendor/c.rb"]);
  assert.deepEqual(fromTree.paths, ["src/a.ts"]);
  // A graph can carry them too — graphify indexes what it is pointed at.
  const fromGraph = discoverFiles(
    graph([
      { sourceFile: "src/a.ts", fileType: "code" },
      { sourceFile: "node_modules/x/i.js", fileType: "code" },
    ]),
    [],
  );
  assert.deepEqual(fromGraph.paths, ["src/a.ts"]);
});

test("an empty graph falls through to the tree rather than scanning nothing", () => {
  const { paths, source } = discoverFiles(graph([]), ["src/a.ts"]);
  assert.deepEqual(paths, ["src/a.ts"]);
  assert.equal(source, "tree");
});

// --- Estimate --------------------------------------------------------------

test("the estimate scales linearly with file count", () => {
  // Compared at counts where the 2-decimal rounding is noise. At n=1 the
  // rounding IS the number ($0.0171 quoted as $0.02), so a ratio there says
  // nothing about the model.
  const hundred = estimateScan(100).estimatedCostUsd;
  const thousand = estimateScan(1000).estimatedCostUsd;
  assert.ok(Math.abs(thousand / hundred - 10) < 0.05, `${hundred} -> ${thousand}`);
});

test("the estimate is quoted at batch prices, not standard", () => {
  // The investigation measured ~$0.034/file at standard rates on a ~483-file
  // repo (~$17). Batch is half, so a 500-file repo must land near $8-9 — if
  // this ever reads ~$17 again, the batch discount has silently dropped out.
  const perFile = estimateScan(500).estimatedCostUsd / 500;
  assert.ok(perFile > 0.012 && perFile < 0.022, `$${perFile.toFixed(4)} per file`);
});

test("the file cap is a refusal, not a warning", () => {
  assert.equal(estimateScan(MAX_FILES).overCap, false);
  assert.equal(estimateScan(MAX_FILES + 1).overCap, true);
});

test("the time estimate never quotes less than five minutes", () => {
  assert.equal(estimateScan(1).estimatedMinutes, 5);
  assert.ok(estimateScan(6000).estimatedMinutes > 5);
});

// --- Fingerprint -----------------------------------------------------------

test("a fingerprint ignores line numbers", () => {
  // The same finding, reported at a different line after an edit above it.
  // Line numbers are not an input, so this is the same fingerprint by
  // construction — which is what makes an acknowledgement survive a re-scan.
  const a = findingFingerprint("src/pay.ts", "Hardcoded API key", "A02:Cryptographic Failures");
  const b = findingFingerprint("src/pay.ts", "Hardcoded API key", "A02:Cryptographic Failures");
  assert.equal(a, b);
});

test("a fingerprint survives the model rewording the title", () => {
  const a = findingFingerprint("src/pay.ts", "Hardcoded API key", "A02");
  const b = findingFingerprint("src/pay.ts", "hardcoded  API-key!", "A02");
  assert.equal(a, b);
});

test("a fingerprint distinguishes file, issue and category", () => {
  const base = findingFingerprint("src/pay.ts", "Hardcoded API key", "A02");
  assert.notEqual(base, findingFingerprint("src/other.ts", "Hardcoded API key", "A02"));
  assert.notEqual(base, findingFingerprint("src/pay.ts", "SQL injection", "A02"));
  assert.notEqual(base, findingFingerprint("src/pay.ts", "Hardcoded API key", "A03"));
});

// --- Ordering --------------------------------------------------------------

test("findings are ordered most severe first", () => {
  const mk = (severity: string, filePath: string) => ({ severity, filePath });
  const sorted = sortFindings([mk("low", "a"), mk("critical", "b"), mk("medium", "c"), mk("high", "d")]);
  assert.deepEqual(sorted.map((f) => f.severity), ["critical", "high", "medium", "low"]);
});

// --- No gate vocabulary ----------------------------------------------------

test("nothing in the baseline surface reports a gate decision", async () => {
  // The reason this is a test and not a review note: runAegisScan ALWAYS
  // computes a fail-closed `gateDecision`, and on a baseline scan of a real
  // repository a few per-file timeouts are normal, so it would return
  // "blocked" almost every time. If that value ever reaches the database or a
  // response, the UI grows a red failure state for a scan that blocked
  // nothing. Coverage counts are what replace it.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = fileURLToPath(new URL(".", import.meta.url));

  const files = [
    join(here, "baselineScanService.ts"),
    join(here, "baselineScanCore.ts"),
    join(here, "..", "routes", "baseline.ts"),
  ];
  const GATE_WORDS = /\b(gateDecision|gateReason|securityGate|gate_decision)\b/;
  for (const f of files) {
    const src = readFileSync(f, "utf8")
      // Comments explain WHY the gate is absent; that prose is the point.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    assert.ok(
      !GATE_WORDS.test(src),
      `${f} references a gate decision. A baseline scan has no commit and blocks nothing — report coverage (filesScanned of filesTotal) instead.`,
    );
  }
});

// --- Read authorization ----------------------------------------------------

test("baseline scans are readable only by the owner or the owning team", async () => {
  // Regression: the read routes originally returned findings to any
  // authenticated caller, so anyone could walk /api/baseline-scans/1,2,3… and
  // read file paths, vulnerability classes and exploitation detail from every
  // other tenant's codebase. Same rule as GET /runs/:id — owner, or a member of
  // the team whose project owns the repository.
  const { canViewBaselineScans } = await import("./baselineScanCore.js");
  const target = (repoOwner: string, teamId: number | null) =>
    ({ repo: { userId: repoOwner }, project: teamId == null ? null : { teamId } }) as never;
  const actor = (userId: string, teamId: number | null, teamRole: string | null) => ({ userId, teamId, teamRole });

  // The repository's owner, always.
  assert.equal(canViewBaselineScans(actor("alice", null, null), target("alice", null)), true);
  // A member — not only an admin — of the owning team.
  assert.equal(canViewBaselineScans(actor("bob", 7, "member"), target("alice", 7)), true);
  // An admin of a DIFFERENT team is a stranger here.
  assert.equal(canViewBaselineScans(actor("mallory", 8, "admin"), target("alice", 7)), false);
  // Merely authenticated, with no team, is not enough.
  assert.equal(canViewBaselineScans(actor("mallory", null, null), target("alice", 7)), false);
  // A personal repository is visible to its owner alone.
  assert.equal(canViewBaselineScans(actor("mallory", 8, "admin"), target("alice", null)), false);
});

// --- Collection must not re-derive the file list ---------------------------

test("collection reads the frozen file list, never re-derives it", async () => {
  // Regression, and the reason 0036 exists. custom_id is `f<index>` into the
  // list built at submit; collection happens up to an hour later. Re-deriving
  // it from the repository at that point silently slides a different file into
  // each slot after any push — a real vulnerability reported against an
  // innocent file. Proven on Postgres: with ["src/a","src/b","src/c"] submitted
  // and "src/NEW" landing first, f2 resolved to src/b instead of src/c.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const src = readFileSync(
    join(fileURLToPath(new URL(".", import.meta.url)), "baselineScanService.ts"),
    "utf8",
  );
  const collect = src.slice(src.indexOf("export async function collectBaselineScan"));
  const body = collect.slice(0, collect.indexOf("\nasync function failScan"));

  assert.ok(
    !/discoverFiles\s*\(/.test(body),
    "collectBaselineScan re-derives the file list. It must read scan.filePaths, frozen at submit (0036).",
  );
  assert.ok(
    /scan\.filePaths/.test(body),
    "collectBaselineScan does not read the stored file list.",
  );
});
