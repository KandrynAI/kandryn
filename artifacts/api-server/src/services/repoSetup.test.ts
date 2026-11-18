import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETUP_CHOICE,
  REPO_SETUP_CHOICES,
  readSetupChoice,
  needsDispatch,
  wantsBaselineScan,
  wantsCodeReview,
  wantsIndex,
} from "../../../../shared/types/repoSetup.js";

test("a stored choice round-trips", () => {
  for (const choice of REPO_SETUP_CHOICES) {
    assert.equal(readSetupChoice(choice), choice);
  }
});

test("a row that predates the column reads as the default, not as `none`", () => {
  // Every repository connected before 0048 was indexed, because that is what
  // connect always did. Reading null as `none` would retroactively claim those
  // customers asked for nothing.
  assert.equal(readSetupChoice(null), DEFAULT_SETUP_CHOICE);
  assert.equal(readSetupChoice(undefined), DEFAULT_SETUP_CHOICE);
  assert.equal(wantsIndex(readSetupChoice(null)), true);
});

test("an unrecognised value reads as the default, not as `none`", () => {
  // A column written by a newer deploy and read by an older one is the case
  // this covers: a value this code does not know the word for must not turn a
  // customer's request for more work into silently doing nothing.
  assert.equal(readSetupChoice("index_scan_review_and_more"), DEFAULT_SETUP_CHOICE);
  assert.equal(readSetupChoice(""), DEFAULT_SETUP_CHOICE);
  assert.equal(readSetupChoice(42), DEFAULT_SETUP_CHOICE);
  assert.equal(readSetupChoice({}), DEFAULT_SETUP_CHOICE);
});

test("`none` really means nothing, and is only reachable by asking for it", () => {
  assert.equal(wantsIndex("none"), false);
  assert.equal(wantsBaselineScan("none"), false);
  assert.notEqual(DEFAULT_SETUP_CHOICE, "none");
});

test("the choices that ask for a scan or a review are exactly the ones the dispatcher acts on", () => {
  // Every value here has to be handled by dispatchPendingSetups. A new one
  // added without that is an option that silently does nothing.
  assert.deepEqual(REPO_SETUP_CHOICES.filter(wantsBaselineScan), ["index_scan", "index_scan_review"]);
  assert.deepEqual(REPO_SETUP_CHOICES.filter(wantsCodeReview), ["index_scan_review"]);
  assert.deepEqual(REPO_SETUP_CHOICES.filter(needsDispatch), ["index_scan", "index_scan_review"]);
});

test("every choice but `none` asks for the index", () => {
  for (const choice of REPO_SETUP_CHOICES) {
    assert.equal(wantsIndex(choice), choice !== "none", choice);
  }
});

test("a review implies a scan, never the other way round", () => {
  // The review option is "everything, plus a code review", so a customer who
  // picks it must not silently lose the security scan.
  assert.equal(wantsBaselineScan("index_scan_review"), true);
  assert.equal(wantsCodeReview("index_scan"), false);
});

test("the offered choices are exactly the four the UI and the column agree on", () => {
  assert.deepEqual([...REPO_SETUP_CHOICES], ["none", "index", "index_scan", "index_scan_review"]);
});
