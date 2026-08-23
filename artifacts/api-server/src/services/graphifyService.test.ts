import { test } from "node:test";
import assert from "node:assert/strict";
import { isGraphServable, isGraphUsable } from "./graphUsability.js";

const fresh = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
const old = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago

// Retrieval may use a graph ONLY when its build succeeded AND it is fresh. This
// is the gate that makes retrievalMode 'graph' trustworthy: a stale graph (URL
// changed after the build), an in-flight indexing, a failed, or an idle graph
// must all be refused so planning falls back to tree-only.

test("succeeded + fresh → servable", () => {
  assert.equal(isGraphServable("succeeded", fresh), true);
});

test("stale + fresh → NOT servable (URL changed since build)", () => {
  assert.equal(isGraphServable("stale", fresh), false);
});

test("indexing + fresh → NOT servable (rebuild in flight)", () => {
  assert.equal(isGraphServable("indexing", fresh), false);
});

test("failed + fresh → NOT servable", () => {
  assert.equal(isGraphServable("failed", fresh), false);
});

test("idle + fresh → NOT servable", () => {
  assert.equal(isGraphServable("idle", fresh), false);
});

test("succeeded but stale by age → NOT servable", () => {
  assert.equal(isGraphServable("succeeded", old), false);
});

test("succeeded but no build timestamp → NOT servable", () => {
  assert.equal(isGraphServable("succeeded", null), false);
});

test("null/undefined status → NOT servable", () => {
  assert.equal(isGraphServable(null, fresh), false);
  assert.equal(isGraphServable(undefined, fresh), false);
});

test("isGraphUsable is unchanged (age-only, status-agnostic)", () => {
  // The display/staleness helper stays age-only; servability is the stricter gate.
  assert.equal(isGraphUsable(fresh), true);
  assert.equal(isGraphUsable(old), false);
  assert.equal(isGraphUsable(null), false);
});
