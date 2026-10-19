import { test } from "node:test";
import assert from "node:assert/strict";
import { overrideReady, MIN_OVERRIDE_REASON } from "./overrideReady.ts";

const base = { category: "urgent_business_need", reason: "", acknowledged: true, hasWarning: false };

test("a caution-only override needs a category and the checkbox, not a reason", () => {
  assert.equal(overrideReady(base), true);
});

test("no category blocks it", () => {
  assert.equal(overrideReady({ ...base, category: "" }), false);
});

test("the acknowledgement checkbox is mandatory in every case", () => {
  assert.equal(overrideReady({ ...base, acknowledged: false }), false);
  assert.equal(
    overrideReady({ ...base, hasWarning: true, reason: "a".repeat(40), acknowledged: false }),
    false,
  );
});

test("a warning requires a reason of at least the minimum length", () => {
  assert.equal(overrideReady({ ...base, hasWarning: true, reason: "" }), false);
  assert.equal(overrideReady({ ...base, hasWarning: true, reason: "a".repeat(MIN_OVERRIDE_REASON - 1) }), false);
  assert.equal(overrideReady({ ...base, hasWarning: true, reason: "a".repeat(MIN_OVERRIDE_REASON) }), true);
});

test("whitespace does not count toward the reason length", () => {
  assert.equal(overrideReady({ ...base, hasWarning: true, reason: " ".repeat(40) }), false);
  assert.equal(overrideReady({ ...base, hasWarning: true, reason: `  ${"a".repeat(MIN_OVERRIDE_REASON)}  ` }), true);
});

test("a submission already in flight blocks a second one", () => {
  assert.equal(overrideReady({ ...base, busy: true }), false);
});

test("the client minimum matches the server's", () => {
  // Drifting apart would show an enabled button the server then rejects.
  assert.equal(MIN_OVERRIDE_REASON, 15);
});
