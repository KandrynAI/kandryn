import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoryLabel,
  severityColor,
  reviewStatusLine,
  isReviewInFlight,
  reviewCostLine,
  groupFindings,
  openCount,
  canAcknowledge,
  SEVERITY_ORDER,
} from "./reviewView.ts";
import type { CodeReviewFinding, CodeReviewScan } from "@/services/api";

const scan = (over: Partial<CodeReviewScan> = {}): CodeReviewScan => ({
  id: 1,
  repositoryId: 1,
  projectId: 1,
  status: "succeeded",
  filesTotal: 600,
  filesReviewed: 598,
  filesSkipped: 2,
  highCount: 1,
  mediumCount: 2,
  lowCount: 3,
  pathPrefix: null,
  model: "m",
  estimatedCostUsd: "12.00",
  actualCostUsd: "9.4100",
  inputTokens: 1,
  outputTokens: 1,
  startedAt: null,
  finishedAt: null,
  error: null,
  createdAt: "",
  ...over,
});

const finding = (over: Partial<CodeReviewFinding> = {}): CodeReviewFinding => ({
  id: 1,
  scanId: 1,
  severity: "medium",
  category: "correctness",
  filePath: "src/a.ts",
  title: "t",
  detail: "d",
  lineRef: "12",
  remediation: "r",
  status: "open",
  acknowledgedBy: null,
  acknowledgedAt: null,
  acknowledgeReason: null,
  ...over,
});

test("a stored category token never reaches the screen", () => {
  assert.equal(categoryLabel("error_handling"), "Error handling");
  assert.equal(categoryLabel("test_gap"), "Test gap");
  // An unknown token still reads as words, not as a token.
  assert.equal(categoryLabel("something_new"), "Other");
  assert.ok(!categoryLabel("error_handling").includes("_"));
});

test("the top severity is amber, never red", () => {
  // A review finding is not a vulnerability; red belongs to the security scan.
  assert.match(severityColor("high"), /amber/);
  for (const s of SEVERITY_ORDER) {
    assert.ok(!/red/.test(severityColor(s)), `${s} must not be red`);
  }
});

test("the status line is coverage, never a verdict", () => {
  const line = reviewStatusLine(scan());
  assert.match(line, /Reviewed 598 of 600 files/);
  assert.match(line, /2 skipped/);
  for (const word of ["passed", "failed", "clean", "approved"]) {
    assert.ok(!new RegExp(word, "i").test(line), `the line must not say ${word}`);
  }
});

test("a scoped review says which folder it looked at", () => {
  // Without it, two reviews of one repository are not comparable.
  assert.match(reviewStatusLine(scan({ pathPrefix: "src/api" })), /in src\/api/);
});

test("an unreviewed repository says so", () => {
  assert.match(reviewStatusLine(null), /has not been reviewed yet/);
});

test("a failed review shows the reason when there is one", () => {
  assert.match(reviewStatusLine(scan({ status: "failed", error: "no key" })), /did not complete: no key/);
  assert.match(reviewStatusLine(scan({ status: "failed", error: null })), /did not complete\./);
});

test("in-flight covers both working states", () => {
  assert.equal(isReviewInFlight(scan({ status: "queued" })), true);
  assert.equal(isReviewInFlight(scan({ status: "scanning" })), true);
  assert.equal(isReviewInFlight(scan({ status: "succeeded" })), false);
  assert.equal(isReviewInFlight(scan({ status: "failed" })), false);
  assert.equal(isReviewInFlight(null), false);
  assert.equal(isReviewInFlight(undefined), false);
});

test("the cost line shows spend against the estimate", () => {
  assert.equal(reviewCostLine(scan()), "$9.41 spent of $12.00 estimated");
  assert.equal(reviewCostLine(scan({ estimatedCostUsd: null })), "$9.41 spent");
  assert.equal(reviewCostLine(scan({ actualCostUsd: null })), null, "an unpriced review shows nothing, not $0.00");
});

test("findings group most severe first, and empty groups disappear", () => {
  const groups = groupFindings([
    finding({ id: 1, severity: "low" }),
    finding({ id: 2, severity: "high" }),
  ]);
  assert.deepEqual(groups.map((g) => g.severity), ["high", "low"]);
});

test("acknowledged findings sit last in their group, and are never hidden", () => {
  // A team that dismissed something should see it is still there and still
  // being carried forward.
  const groups = groupFindings([
    finding({ id: 1, status: "acknowledged", filePath: "a.ts" }),
    finding({ id: 2, status: "open", filePath: "z.ts" }),
  ]);
  assert.deepEqual(groups[0].findings.map((f) => f.id), [2, 1]);
  assert.equal(groups[0].findings.length, 2);
});

test("open findings are counted, acknowledged ones are not", () => {
  assert.equal(openCount([finding({ status: "open" }), finding({ id: 2, status: "acknowledged" })]), 1);
  assert.equal(openCount([]), 0);
});

test("a dismissal needs a reason, matching the server and the database check", () => {
  assert.equal(canAcknowledge(""), false);
  assert.equal(canAcknowledge("   "), false);
  assert.equal(canAcknowledge("known, tracked elsewhere"), true);
});
