import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, computeRecordHash, type HashableOverride } from "./sequenceRecordHash.js";
import type { ImpactAnalysis, SequenceFinding } from "../../../../shared/types/sequence.js";

const finding = (id: string): SequenceFinding => ({
  id, type: "unmet_blocker", severity: "warning", summary: "s",
  source: "tracker", confidence: "high", evidence: { itemKeys: ["PAY-A"] },
});

const impact = (over: Partial<ImpactAnalysis> = {}): ImpactAnalysis => ({
  summary: "s", risks: [], affectedItems: [], affectedFiles: [], alternative: "a",
  source: "deterministic", ...over,
});

const base: HashableOverride = {
  userId: "u1", teamId: 1, userRole: "admin", workItemKey: "PAY-B", workItemTitle: "Claims",
  verdictAtDecision: "warning", findingsAcknowledged: [finding("a1")],
  impactShown: impact(), impactSource: "deterministic", impactModel: null,
  reasonCategory: "urgent_business_need", reasonText: "needed for the demo",
  acknowledgedImpact: true, policySnapshot: { policy: "warn" }, scheduledAt: null,
  ipAddress: "1.2.3.4", userAgent: "ua",
};

test("canonicalJson sorts keys at every depth", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
  assert.equal(canonicalJson([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]');
});

test("canonicalJson preserves array order, which is meaningful", () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("the hash survives a jsonb round trip, which reorders keys", () => {
  // The real failure this guards: Postgres returns jsonb with its own key
  // order, so hashing the stored form must match hashing what was written.
  const asWritten = { ...base, impactShown: impact({ summary: "s", alternative: "a" }) };
  // Same value, keys in the order Postgres happens to return them.
  const asReadBack = {
    ...base,
    impactShown: Object.fromEntries(
      Object.entries(impact({ summary: "s", alternative: "a" })).reverse(),
    ) as unknown as ImpactAnalysis,
  };
  assert.equal(computeRecordHash(asWritten), computeRecordHash(asReadBack));
});

test("the hash is stable across calls and key insertion order", () => {
  const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as HashableOverride;
  assert.equal(computeRecordHash(base), computeRecordHash(reordered));
});

test("the hash moves when any covered field changes", () => {
  const h = computeRecordHash(base);
  for (const patch of [
    { reasonText: "different" }, { userId: "u2" }, { userRole: "member" },
    { acknowledgedImpact: false }, { verdictAtDecision: "caution" },
    { impactShown: impact({ summary: "tampered" }) },
    { findingsAcknowledged: [finding("a2")] },
    { reasonCategory: "other" }, { teamId: 2 },
  ]) {
    assert.notEqual(computeRecordHash({ ...base, ...patch } as HashableOverride), h, JSON.stringify(patch));
  }
});

test("a sha256 hex digest", () => {
  assert.match(computeRecordHash(base), /^[0-9a-f]{64}$/);
});

test("null and undefined reason text hash differently from empty string", () => {
  const nullish = computeRecordHash({ ...base, reasonText: null });
  assert.notEqual(nullish, computeRecordHash({ ...base, reasonText: "" }));
});
