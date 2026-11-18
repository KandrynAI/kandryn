import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actualCostUsd,
  discoverFiles,
  estimateScan,
  findingFingerprint,
  normalisePathPrefix,
  sortFindings,
  withinPrefix,
  MAX_FILES,
  PRICED_MODELS,
} from "./baselineScanCore.js";
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

// --- folder scoping (0049) ---------------------------------------------------

test("a folder scope is normalised to a bare prefix", () => {
  assert.equal(normalisePathPrefix("src/api"), "src/api");
  assert.equal(normalisePathPrefix("src/api/"), "src/api");
  assert.equal(normalisePathPrefix("  src/api  "), "src/api");
  assert.equal(normalisePathPrefix("src/api///"), "src/api");
});

test("an empty scope means the whole repository", () => {
  for (const raw of [null, undefined, "", "   ", "/", "."]) {
    assert.equal(normalisePathPrefix(raw), null, JSON.stringify(raw));
  }
});

test("a scope that could escape the repository is refused, never cleaned up", () => {
  // Rewriting these would scope the scan to something the customer did not
  // ask for, and the file list is what every finding is attributed to.
  for (const raw of ["/etc", "../secrets", "src/../../etc", "C:\\win", "a\\b", "src//api", 42, {}]) {
    assert.equal(normalisePathPrefix(raw), false, JSON.stringify(raw));
  }
});

test("a scope boundary is a separator, not a string prefix", () => {
  // src/app must not swallow src/apps.
  assert.equal(withinPrefix("src/app/x.ts", "src/app"), true);
  assert.equal(withinPrefix("src/app", "src/app"), true);
  assert.equal(withinPrefix("src/apps/x.ts", "src/app"), false);
  assert.equal(withinPrefix("srcx/app.ts", "src"), false);
  assert.equal(withinPrefix("anything", null), true);
});

test("discovery honours the scope on the tree path", () => {
  const tree = ["src/api/a.ts", "src/web/b.ts", "src/apis/c.ts", "docs/d.md"];
  const { paths, source } = discoverFiles(null, tree, "src/api");
  assert.deepEqual(paths, ["src/api/a.ts"]);
  assert.equal(source, "tree");
});

test("discovery honours the scope on the graph path", () => {
  const g = graph([
    { sourceFile: "src/api/a.ts", fileType: "code" },
    { sourceFile: "src/web/b.ts", fileType: "code" },
  ]);
  assert.deepEqual(discoverFiles(g, [], "src/api").paths, ["src/api/a.ts"]);
});

test("a scope matching nothing in the graph does not silently widen to the tree", () => {
  // Falling back would quote a count for the whole repository against a folder
  // the customer narrowed to. Empty is the honest answer; the route 422s.
  const g = graph([{ sourceFile: "src/web/b.ts", fileType: "code" }]);
  const out = discoverFiles(g, ["src/api/a.ts", "src/web/b.ts"], "src/api");
  assert.deepEqual(out.paths, []);
  assert.equal(out.source, "graph");
});

test("with no scope the graph still falls back to the tree when it is empty", () => {
  // The pre-existing behaviour, which the guard above must not have broken.
  const g = graph([{ sourceFile: "README.md", fileType: "doc" }]);
  const out = discoverFiles(g, ["src/a.ts"], null);
  assert.deepEqual(out.paths, ["src/a.ts"]);
  assert.equal(out.source, "tree");
});

// --- actual spend (0050) -----------------------------------------------------

test("the actual cost is the reported tokens at the model's batch rate", () => {
  // 1M input at $5/Mtok plus 100k output at $25/Mtok.
  assert.equal(actualCostUsd("claude-fable-5", 1_000_000, 100_000), 7.5);
});

test("the fallback model is priced at half, which is what the dialog promises", () => {
  const full = actualCostUsd("claude-fable-5", 1_000_000, 100_000)!;
  const half = actualCostUsd("claude-opus-5", 1_000_000, 100_000)!;
  assert.equal(half, full / 2);
});

test("an unpriced model records no cost rather than a free scan", () => {
  // A scan that cost real money and reads as $0.00 is worse than one that
  // reads as not priced. The tokens are stored either way.
  assert.equal(actualCostUsd("some-future-model", 1_000_000, 100_000), null);
  assert.equal(actualCostUsd(null, 1_000_000, 100_000), null);
  assert.equal(actualCostUsd(undefined, 1_000_000, 100_000), null);
});

test("a cheap scan is not rounded away to zero", () => {
  // A folder scan can genuinely cost a few cents; two decimal places would
  // record that as free.
  const cost = actualCostUsd("claude-fable-5", 2_000, 300)!;
  assert.ok(cost > 0, `expected a non-zero cost, got ${cost}`);
  assert.equal(cost, Math.round(cost * 10_000) / 10_000);
});

test("zero tokens is zero cost, not null", () => {
  // Distinguishable from an unpriced model: this scan really did read nothing.
  assert.equal(actualCostUsd("claude-fable-5", 0, 0), 0);
});

test("the estimate and the actual agree on the default model's rate", () => {
  // The whole point of one rate table. If these drift, an estimate and a
  // charge disagree for a reason nobody can find.
  const files = 600;
  const est = estimateScan(files);
  // Reconstruct the estimate's own token assumptions and price them as an
  // actual charge; the two must match to the cent.
  const inputTokens = files * (430 + (8_000 * 0.65) / 3.5);
  const outputTokens = files * 300;
  const asActual = actualCostUsd("claude-fable-5", inputTokens, outputTokens)!;
  assert.equal(Math.round(asActual * 100) / 100, est.estimatedCostUsd);
});

test("every model the scan can run on has a rate", () => {
  assert.deepEqual([...PRICED_MODELS].sort(), ["claude-fable-5", "claude-opus-5"]);
});
