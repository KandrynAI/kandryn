import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateReview,
  parseReviewFile,
  reviewFilePrompt,
  reviewFingerprint,
  sortReviewFindings,
  ReviewParseError,
  MAX_FILE_CHARS,
} from "./reviewScanCore.js";
import {
  REVIEW_CATEGORIES,
  readReviewCategory,
  readReviewSeverity,
} from "../../../../shared/types/reviewScan.js";

// --- the taxonomy -----------------------------------------------------------

test("an unknown category reads as `other`, never as a guess", () => {
  assert.equal(readReviewCategory("correctness"), "correctness");
  assert.equal(readReviewCategory("security"), "other");
  assert.equal(readReviewCategory(""), "other");
  assert.equal(readReviewCategory(null), "other");
  assert.equal(readReviewCategory(42), "other");
});

test("an unknown severity reads as `low`, not `high`", () => {
  // A model that did not follow the contract must not have its output promoted
  // to the top of a reviewer's queue.
  assert.equal(readReviewSeverity("high"), "high");
  assert.equal(readReviewSeverity("critical"), "low");
  assert.equal(readReviewSeverity(undefined), "low");
});

test("there is no `critical` severity", () => {
  // A review finding is not a vulnerability. Sharing Aegis's top level would
  // let a duplicated helper and an injection flaw sit under one word.
  assert.equal(readReviewSeverity("critical"), "low");
});

// --- the prompt -------------------------------------------------------------

test("the prompt rules out the noise that buries real findings", () => {
  const p = reviewFilePrompt({ filePath: "src/a.ts", code: "x" });
  for (const phrase of ["formatting", "naming", "import order", "linter"]) {
    assert.ok(p.includes(phrase), `the prompt should rule out ${phrase}`);
  }
});

test("the prompt rules out security findings, which another scan already reports", () => {
  // Duplicate findings in two tables with two severity scales are worse than
  // none, because nobody can tell which queue is authoritative.
  const p = reviewFilePrompt({ filePath: "src/a.ts", code: "x" });
  assert.ok(/security vulnerabilit/i.test(p));
  assert.ok(/separate security scan/i.test(p));
});

test("the prompt says the file is seen alone, and what not to claim because of it", () => {
  // The most expensive false positive here is a confident claim about a caller
  // the reviewer never saw.
  const p = reviewFilePrompt({ filePath: "src/a.ts", code: "x" });
  assert.ok(/SEEING THIS FILE ALONE/.test(p));
  assert.ok(/do not report a function as unused/.test(p));
  assert.ok(/empty array/.test(p), "a clean file must be an expected outcome");
});

test("the prompt carries the stack only when there is one", () => {
  assert.ok(reviewFilePrompt({ filePath: "a.ts", code: "x" }, "typescript / react").includes("typescript / react"));
  assert.ok(!reviewFilePrompt({ filePath: "a.ts", code: "x" }).includes("The project's stack"));
});

test("the prompt bounds the source it carries", () => {
  const code = "a".repeat(MAX_FILE_CHARS * 2);
  const p = reviewFilePrompt({ filePath: "a.ts", code });
  assert.ok(p.length < code.length, "the whole file must not reach the prompt");
  assert.ok(!p.includes("a".repeat(MAX_FILE_CHARS + 1)));
});

// --- the parser -------------------------------------------------------------

const reply = (findings: unknown) => JSON.stringify({ findings });

test("a clean file parses to no findings", () => {
  assert.deepEqual(parseReviewFile(reply([])), []);
});

test("a reply in a code fence still parses", () => {
  const raw = "```json\n" + reply([{ title: "Off by one", severity: "high", category: "correctness" }]) + "\n```";
  assert.equal(parseReviewFile(raw).length, 1);
});

test("a reply that is not the contract throws, because the file is unreviewed", () => {
  // Not "clean". The coverage figure has to be able to say the file was not
  // read, which is a different claim from "nothing was found".
  assert.throws(() => parseReviewFile("not json"), ReviewParseError);
  assert.throws(() => parseReviewFile(JSON.stringify({ results: [] })), ReviewParseError);
  assert.throws(() => parseReviewFile(JSON.stringify({ findings: "none" })), ReviewParseError);
});

test("a finding with no title is dropped, not kept untitled", () => {
  // It cannot be read, acted on, or fingerprinted stably.
  const out = parseReviewFile(reply([{ severity: "high", detail: "something" }, { title: "Real" }]));
  assert.deepEqual(out.map((f) => f.title), ["Real"]);
});

test("missing fields are coerced rather than dropping a real finding", () => {
  const [f] = parseReviewFile(reply([{ title: "Swallowed error" }]));
  assert.equal(f.severity, "low");
  assert.equal(f.category, "other");
  assert.equal(f.detail, "");
  assert.equal(f.remediation, "");
  assert.equal(f.lineRef, null);
});

test("long text is clipped, not rejected", () => {
  const [f] = parseReviewFile(reply([{ title: "T".repeat(500), detail: "D".repeat(5_000) }]));
  assert.ok(f.title.length <= 160);
  assert.ok(f.detail.length <= 1_200);
});

test("a flood of findings from one file is bounded", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ title: `f${i}` }));
  assert.equal(parseReviewFile(reply(many)).length, 12);
});

test("the parser never takes a file path from the reply", () => {
  // The caller assigns the path from the frozen list, so a model naming
  // another file cannot misattribute a finding. Same rule the security scan
  // follows after 0036.
  const [f] = parseReviewFile(reply([{ title: "X", filePath: "../../etc/passwd" }]));
  assert.ok(!("filePath" in f), "a parsed finding must carry no path of its own");
});

test("every category the parser can emit is a declared one", () => {
  for (const c of REVIEW_CATEGORIES) {
    const [f] = parseReviewFile(reply([{ title: "X", category: c }]));
    assert.equal(f.category, c);
  }
});

// --- fingerprint and ordering ----------------------------------------------

test("a fingerprint ignores the line number, so an edit above does not resurrect a finding", () => {
  const a = reviewFingerprint("src/a.ts", "Swallowed error", "error_handling");
  const b = reviewFingerprint("src/a.ts", "swallowed  ERROR!", "error_handling");
  assert.equal(a, b, "wording and case must not change identity");
  assert.notEqual(a, reviewFingerprint("src/b.ts", "Swallowed error", "error_handling"));
  assert.notEqual(a, reviewFingerprint("src/a.ts", "Swallowed error", "correctness"));
});

test("findings read most severe first, then by path", () => {
  const out = sortReviewFindings([
    { severity: "low", filePath: "a.ts" },
    { severity: "high", filePath: "z.ts" },
    { severity: "medium", filePath: "b.ts" },
    { severity: "high", filePath: "a.ts" },
  ]);
  assert.deepEqual(
    out.map((f) => `${f.severity}:${f.filePath}`),
    ["high:a.ts", "high:z.ts", "medium:b.ts", "low:a.ts"],
  );
});

// --- the estimate -----------------------------------------------------------

test("the estimate grows with the file count and floors the time", () => {
  const small = estimateReview(10);
  const large = estimateReview(1_000);
  assert.ok(large.estimatedCostUsd > small.estimatedCostUsd);
  assert.equal(small.estimatedMinutes, 5, "a floor, so nobody waits on a one-minute quote");
  assert.ok(large.estimatedMinutes > 5);
});

test("the estimate refuses above the file cap", () => {
  assert.equal(estimateReview(5_000).overCap, false);
  assert.equal(estimateReview(5_001).overCap, true);
});

test("a review is priced above a security scan of the same repository", async () => {
  // Its prompt is longer (it states what is out of scope, which the security
  // prompt does not have to) and its replies are longer, because a
  // correctness finding needs an explanation. If this ever inverts, one of the
  // two sets of assumptions is wrong.
  const { estimateScan } = await import("./baselineScanCore.js");
  assert.ok(estimateReview(1_000).estimatedCostUsd > estimateScan(1_000).estimatedCostUsd);
});
