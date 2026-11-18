import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETUP_CHOICE,
  REPO_SETUP_CHOICES,
  readSetupChoice,
  wantsBaselineScan,
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
  // this covers: during a rollout, `index_scan_review` will exist in the
  // database before this code knows the word. Falling back to `none` would
  // turn a customer's request for more work into silently doing nothing.
  assert.equal(readSetupChoice("index_scan_review"), DEFAULT_SETUP_CHOICE);
  assert.equal(readSetupChoice(""), DEFAULT_SETUP_CHOICE);
  assert.equal(readSetupChoice(42), DEFAULT_SETUP_CHOICE);
  assert.equal(readSetupChoice({}), DEFAULT_SETUP_CHOICE);
});

test("`none` really means nothing, and is only reachable by asking for it", () => {
  assert.equal(wantsIndex("none"), false);
  assert.equal(wantsBaselineScan("none"), false);
  assert.notEqual(DEFAULT_SETUP_CHOICE, "none");
});

test("only index_scan asks for a scan, and it asks for the index too", () => {
  assert.deepEqual(
    REPO_SETUP_CHOICES.filter(wantsBaselineScan),
    ["index_scan"],
    "a second scanning choice would need the dispatcher's pending-setup step to know about it",
  );
  assert.equal(wantsIndex("index_scan"), true);
  assert.equal(wantsIndex("index"), true);
  assert.equal(wantsBaselineScan("index"), false);
});

test("the offered choices are exactly the three the UI and the column agree on", () => {
  // A fourth value added here without the dispatcher learning to act on it is
  // an option that silently does nothing, which is the failure this pins.
  assert.deepEqual([...REPO_SETUP_CHOICES], ["none", "index", "index_scan"]);
});
