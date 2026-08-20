import { test } from "node:test";
import assert from "node:assert/strict";
import { assignRecommendation, coherenceDimension, weightedScore10, type ScoreBreakdownOut } from "./aiService.js";
import type { CodeSuggestion } from "../../../../shared/types/codeSuggestion.js";
import type { CoherenceResult, CoherenceStatus } from "../../../../shared/types/coherence.js";

// Phase 3 — the coherence exclusion rule and score folding. Pure-function unit
// tests (no AI/DB/git); they lock the rules the run pipeline relies on.

function coherence(status: CoherenceStatus, score: number): CoherenceResult {
  const finding = { check: "caller_callee" as const, severity: "error" as const, filePath: "a.cs", message: "x" };
  return { findings: status === "failed" ? [finding] : [], skipped: [], score, status };
}

function sug(agent: CodeSuggestion["agent"], score: number, status?: CoherenceStatus): CodeSuggestion {
  return {
    agent,
    files: [],
    valid: true,
    stats: { filesChanged: 0, added: 0, removed: 0 },
    explanation: "",
    language: "csharp",
    score,
    coherence: status ? coherence(status, status === "failed" ? 0.5 : 1) : null,
  };
}

const rec = (s: CodeSuggestion) => s.recommendation;

test("single-suggestion failed run is never Recommended (auto-commit blocked)", () => {
  // The auto-commit guard commits only the Recommended suggestion; proving a
  // lone failed suggestion is not Recommended proves it is never auto-committed.
  const list = [sug("claude", 7, "failed")];
  assignRecommendation(list);
  assert.equal(rec(list[0]), "Alternative");
  assert.equal(list.some((s) => s.recommendation === "Recommended"), false);
});

test("single-suggestion passed run is Recommended", () => {
  const list = [sug("claude", 7, "passed")];
  assignRecommendation(list);
  assert.equal(rec(list[0]), "Recommended");
});

test("single-suggestion run with no coherence result is Recommended (neutral)", () => {
  const list = [sug("claude", 7)];
  assignRecommendation(list);
  assert.equal(rec(list[0]), "Recommended");
});

test("higher-scored failed suggestion yields to a passing peer", () => {
  // List arrives sorted by score desc; the top one failed coherence.
  const list = [sug("claude", 9, "failed"), sug("openai", 6, "passed")];
  assignRecommendation(list);
  assert.equal(rec(list[0]), "Alternative");
  assert.equal(rec(list[1]), "Recommended");
});

test("both suggestions failed → none Recommended, both surfaced as Alternative", () => {
  const list = [sug("claude", 9, "failed"), sug("openai", 6, "failed")];
  assignRecommendation(list);
  assert.equal(list.filter((s) => s.recommendation === "Recommended").length, 0);
  assert.deepEqual(list.map(rec), ["Alternative", "Alternative"]);
});

test("both passed → highest-scored (index 0) is Recommended", () => {
  const list = [sug("claude", 9, "passed"), sug("openai", 6, "warnings")];
  assignRecommendation(list);
  assert.equal(rec(list[0]), "Recommended");
  assert.equal(rec(list[1]), "Alternative");
});

test("warnings status does not exclude from Recommended", () => {
  const list = [sug("claude", 8, "warnings")];
  assignRecommendation(list);
  assert.equal(rec(list[0]), "Recommended");
});

// ---- coherenceDimension mapping ----

test("coherenceDimension scales 0–1 to 0–100 and maps status → verdict", () => {
  assert.deepEqual(
    { ...coherenceDimension(coherence("passed", 1)) },
    { score: 100, weight: 15, verdict: "strong", reason: "No cross-file coherence issues detected." },
  );
  assert.equal(coherenceDimension(coherence("warnings", 0.9)).verdict, "adequate");
  assert.equal(coherenceDimension(coherence("failed", 0.5)).verdict, "weak");
  assert.equal(coherenceDimension(coherence("failed", 0.5)).score, 50);
});

// ---- weightedScore10 folding ----

function dim(score: number): ScoreBreakdownOut["correctness"] {
  return { score, weight: 0, verdict: "adequate", reason: "" };
}
function breakdown(coherenceScore?: number): ScoreBreakdownOut {
  return {
    correctness: dim(100),
    readability: dim(100),
    minimalDiff: dim(100),
    conventions: dim(100),
    acCoverage: dim(100),
    coherence: coherenceScore === undefined ? undefined : { ...dim(coherenceScore), weight: 15 },
    overallNarrative: "",
    recommendation: "Alternative",
    confidence: 50,
    confidenceReason: "",
  };
}

test("weightedScore10 defaults coherence to neutral 100 when absent", () => {
  assert.equal(weightedScore10(breakdown()), 10);
});

test("weightedScore10 folds a failed coherence score into the overall", () => {
  // All model dims 100, coherence 0 → 85 → rounds to 9/10.
  assert.equal(weightedScore10(breakdown(0)), 9);
});
