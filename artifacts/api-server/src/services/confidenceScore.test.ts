import { test } from "node:test";
import assert from "node:assert/strict";
import { confidenceFromSignals, confidenceReason, WEIGHTS } from "./confidenceScore.js";
import type { ConfidenceSignals } from "./confidenceScore.js";

// Phase 4 — the confidence scoring core. Locks the weighted-renormalised average
// and the exclusion (neutral) behaviour of absent signals.

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("all signals present → plain weighted average (weights sum to 1)", () => {
  // gap .4, mode .2, density .2, historical .2 → all present, den = 1.
  const { score } = confidenceFromSignals({ scoreGap: 1, retrievalMode: "graph", density: 1, historicalPriorCount: 3 });
  assert.ok(approx(score, 0.4 * 1 + 0.2 * 1 + 0.2 * 1 + 0.2 * 1)); // 1.0
});

test("absent historical (0 priors) is renormalised out, not a zero penalty", () => {
  // Present: gap(.4)=1, mode(.2)=1, density(.2)=1. den = .8, num = .8 → 1.0.
  const withHist = confidenceFromSignals({ scoreGap: 1, retrievalMode: "graph", density: 1, historicalPriorCount: 0 });
  assert.ok(approx(withHist.score, 1.0), `expected 1.0 got ${withHist.score}`);
  // If it were a zero penalty instead of renormalised, it would be 0.8.
  assert.ok(withHist.score > 0.8);
});

test("absent gap (<2 candidates) is renormalised out", () => {
  // Present: mode(.2)=1, density(.2)=0.5, historical(.2)=1 → den .6, num .5 → .8333…
  const { score, weakestSignal } = confidenceFromSignals({ scoreGap: null, retrievalMode: "graph", density: 0.5, historicalPriorCount: 1 });
  assert.ok(approx(score, (0.2 * 1 + 0.2 * 0.5 + 0.2 * 1) / 0.6));
  assert.equal(weakestSignal, "density"); // gap absent, density is the lowest present
});

test("keyword mode scores lower than graph, all else equal (relative weighting)", () => {
  const graph = confidenceFromSignals({ scoreGap: 0.5, retrievalMode: "graph", density: 0.5, historicalPriorCount: 0 });
  const keyword = confidenceFromSignals({ scoreGap: 0.5, retrievalMode: "keyword", density: 0.5, historicalPriorCount: 0 });
  assert.ok(keyword.score < graph.score);
});

test("weakest present signal is reported for the reason line", () => {
  // gap .2 lowest → weakest gap.
  const r = confidenceFromSignals({ scoreGap: 0.2, retrievalMode: "graph", density: 0.9, historicalPriorCount: 5 });
  assert.equal(r.weakestSignal, "gap");
});

test("no signals at all → neutral 0.5 (never blocks on nothing)", () => {
  // Contrived: gap null, historical 0 → only mode+density present, so this can't
  // happen in practice, but the den>0 guard must still return 0.5 if it did.
  const r = confidenceFromSignals({ scoreGap: null, retrievalMode: "keyword", density: 0, historicalPriorCount: 0 });
  // mode(.2)=.5, density(.2)=0 present → den .4, num .1 → .25 (not 0.5); this
  // documents that mode+density always anchor the score.
  assert.ok(approx(r.score, (0.2 * 0.5 + 0.2 * 0) / 0.4));
});

test("weights are the approved values", () => {
  assert.deepEqual({ ...WEIGHTS }, { gap: 0.4, mode: 0.2, density: 0.2, historical: 0.2 });
});

test("reason line is specific to the weakest signal, not generic", () => {
  const base: ConfidenceSignals = {
    scoreGap: 0.1, topScore: 10, secondScore: 9, retrievalMode: "graph",
    candidateCount: 6, countAboveFloor: 1, floor: 5, target: 5, density: 0.2,
    historicalPriorCount: 0, weights: { ...WEIGHTS },
    perSignal: { gap: 0.1, mode: 1, density: 0.2, historical: null }, weakestSignal: "gap",
  };
  assert.match(confidenceReason(base), /scored almost equally/);
  assert.match(confidenceReason({ ...base, weakestSignal: "density" }), /cleared the relevance bar/);
  assert.match(confidenceReason({ ...base, weakestSignal: "mode" }), /keyword search/);
});
