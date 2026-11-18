import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOMAIN_KINDS,
  DOMAIN_STATUSES,
  DOMAIN_ORIGINS,
  EVIDENCE_KINDS,
  DOMAIN_KIND_LABELS,
  DOMAIN_STATUS_LABELS,
  isAuthoritative,
  isExtractableStatus,
  readDomainKind,
  readDomainStatus,
  readDomainOrigin,
  readEvidenceKind,
} from "../../../../shared/types/domainRule.js";

// --- the one rule that matters ----------------------------------------------

test("only `confirmed` is authoritative", () => {
  // The whole feature. A statement reaches a generation prompt on the strength
  // of this function and nothing else.
  assert.deepEqual(DOMAIN_STATUSES.filter(isAuthoritative), ["confirmed"]);
});

test("`needs_review` is NOT authoritative, even though it was confirmed once", () => {
  // Its evidence has moved under it. Continuing to state it as fact is exactly
  // how a stale rule outlives the code it described.
  assert.equal(isAuthoritative("needs_review"), false);
});

test("`proposed` is never authoritative", () => {
  // Nobody has looked at it. This is the case the review gate exists for.
  assert.equal(isAuthoritative("proposed"), false);
});

test("an extraction may only write `proposed`", () => {
  // An extractor that could write `confirmed` would bypass the review gate
  // entirely, and the database CHECK would refuse it anyway because it has no
  // reviewer to name. The two must agree.
  assert.deepEqual(DOMAIN_STATUSES.filter(isExtractableStatus), ["proposed"]);
});

// --- reading stored values back ---------------------------------------------

test("every status round-trips", () => {
  for (const s of DOMAIN_STATUSES) assert.equal(readDomainStatus(s), s);
});

test("an unrecognised status reads as `proposed`, never as authoritative", () => {
  // The only safe direction. A column written by a newer deploy must not let
  // an older one inject something it cannot understand.
  for (const bad of ["approved", "CONFIRMED", "", null, undefined, 42, {}]) {
    const read = readDomainStatus(bad);
    assert.equal(read, "proposed", JSON.stringify(bad));
    assert.equal(isAuthoritative(read), false, `${JSON.stringify(bad)} must not be authoritative`);
  }
});

test("an unrecognised kind reads as `rule`, the most constrained kind", () => {
  for (const k of DOMAIN_KINDS) assert.equal(readDomainKind(k), k);
  assert.equal(readDomainKind("invariant"), "rule");
  assert.equal(readDomainKind(null), "rule");
});

test("an unrecognised origin reads as `inferred`: assume a model wrote it", () => {
  // Reading an unknown origin as `human` would credit a model's guess to a
  // person, which is the one direction that matters here.
  for (const o of DOMAIN_ORIGINS) assert.equal(readDomainOrigin(o), o);
  assert.equal(readDomainOrigin("extractor"), "inferred");
  assert.equal(readDomainOrigin(null), "inferred");
});

test("an unrecognised evidence kind reads as `person`, which claims no locator", () => {
  // The kinds with locators (code, tracker, document) all make a checkable
  // claim; falling back to one of those would assert a locator that is not
  // there, and the database CHECK would refuse the row.
  for (const e of EVIDENCE_KINDS) assert.equal(readEvidenceKind(e), e);
  assert.equal(readEvidenceKind("graph"), "person");
  assert.equal(readEvidenceKind(null), "person");
});

// --- the vocabulary itself --------------------------------------------------

test("every kind and status has a label, and no label is a stored token", () => {
  for (const k of DOMAIN_KINDS) {
    assert.ok(DOMAIN_KIND_LABELS[k], `${k} has no label`);
    assert.ok(!DOMAIN_KIND_LABELS[k].includes("_"));
  }
  for (const s of DOMAIN_STATUSES) {
    assert.ok(DOMAIN_STATUS_LABELS[s], `${s} has no label`);
    assert.ok(!DOMAIN_STATUS_LABELS[s].includes("_"), `${s} label is a token`);
  }
});

test("the four kinds are the ones the schema CHECK allows", () => {
  // A fifth kind added here without the migration is a write that 500s.
  assert.deepEqual([...DOMAIN_KINDS], ["rule", "term", "entity", "workflow"]);
});

test("the four statuses are the ones the schema CHECK allows", () => {
  assert.deepEqual([...DOMAIN_STATUSES], ["proposed", "confirmed", "rejected", "needs_review"]);
});

test("the four evidence kinds are the ones the locator CHECK covers", () => {
  // The CHECK enumerates all four; a fifth would fail every insert, because
  // the constraint is a disjunction over known kinds rather than a default.
  assert.deepEqual([...EVIDENCE_KINDS], ["code", "tracker", "document", "person"]);
});
