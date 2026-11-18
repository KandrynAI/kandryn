import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SETUP_OPTIONS,
  SERVER_CHOICES,
  offeredChoices,
  initialChoice,
  needsEstimate,
  estimateLine,
  canConfirm,
} from "./repoSetup.ts";

const estimate = (over = false, files = 600) => ({
  filesTotal: files,
  estimatedCostUsd: 10.88,
  estimatedMinutes: 11,
  source: "tree" as const,
  overCap: over,
  maxFiles: 5000,
});

test("every option offered is a value the server accepts", () => {
  // The failure this pins is an option the UI shows and the server's zod enum
  // rejects, which reads to the customer as a broken form.
  for (const value of offeredChoices()) {
    assert.ok(SERVER_CHOICES.includes(value), `${value} is not a server choice`);
  }
});

test("every value the server accepts is offered somewhere", () => {
  // The other direction: a value reachable in the database that no screen can
  // produce or explain.
  for (const value of SERVER_CHOICES) {
    assert.ok(offeredChoices().includes(value), `${value} is not offered`);
  }
});

test("every option that spends money needs an estimate first, and only those", () => {
  // The invariant, rather than a hard-coded list: a new paid option added
  // without `spends: true` would skip the cost screen entirely.
  const spending = SETUP_OPTIONS.filter((o) => o.spends).map((o) => o.value);
  assert.deepEqual(spending, ["index_scan", "index_scan_review"]);
  for (const o of SETUP_OPTIONS) {
    assert.equal(needsEstimate(o.value), o.spends, o.value);
  }
});

test("the free options are the ones that call no model", () => {
  assert.equal(needsEstimate("index"), false);
  assert.equal(needsEstimate("none"), false);
});

test("no option text names a model or a vendor", () => {
  // Same rule the help guide is held to: the UI says what the work is, never
  // who does it.
  const banned = /anthropic|openai|claude|gpt|sonnet|opus|haiku|fable|gemini|copilot/i;
  for (const o of SETUP_OPTIONS) {
    assert.ok(!banned.test(o.label), `label names a vendor: ${o.label}`);
    assert.ok(!banned.test(o.detail), `detail names a vendor: ${o.detail}`);
  }
});

test("no option text uses an em dash", () => {
  for (const o of SETUP_OPTIONS) {
    assert.ok(!o.label.includes("—"), `label has an em dash: ${o.label}`);
    assert.ok(!o.detail.includes("—"), `detail has an em dash: ${o.detail}`);
  }
});

test("a form arrives on the project default, and never on `none` by accident", () => {
  assert.equal(initialChoice("index_scan"), "index_scan");
  assert.equal(initialChoice("none"), "none");
  assert.equal(initialChoice(null), "index");
  assert.equal(initialChoice("index_scan_review"), "index_scan_review");
  assert.equal(initialChoice("index_scan_review_plus"), "index", "an unknown value must not read as nothing");
});

test("a free choice confirms without an estimate", () => {
  assert.equal(canConfirm("index", null, false), true);
  assert.equal(canConfirm("none", null, false), true);
  assert.equal(canConfirm("index", null, true), true);
});

test("the spending choice cannot be confirmed before the cost is shown", () => {
  assert.equal(canConfirm("index_scan", null, false), false, "no estimate yet");
  assert.equal(canConfirm("index_scan", null, true), false, "still loading");
  assert.equal(canConfirm("index_scan", estimate(), false), true);
});

test("the spending choice cannot be confirmed above the file cap", () => {
  // The server refuses the scan at that size, so offering the button is a lie.
  assert.equal(canConfirm("index_scan", estimate(true, 9000), false), false);
});

test("the cost line is a ceiling, and the over-cap line says what to do instead", () => {
  const line = estimateLine(estimate());
  assert.match(line ?? "", /\$10\.88/);
  assert.match(line ?? "", /600 files/);
  assert.match(line ?? "", /ceiling, not a quote/);
  const over = estimateLine(estimate(true, 9000));
  assert.match(over ?? "", /9,000 files/);
  assert.match(over ?? "", /5,000-file limit/);
  assert.match(over ?? "", /folder at a time/);
  assert.equal(estimateLine(null), null);
});

test("one file is not described as 1 files", () => {
  assert.match(estimateLine(estimate(false, 1)) ?? "", /for 1 file\./);
});
