import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGraphServable,
  isGraphUsable,
  isIndexInFlight,
  INDEX_CLAIM_STALE_MINUTES,
} from "./graphUsability.js";

const NOW = new Date("2026-11-18T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

test("a fresh indexing claim is in flight, so a second rebuild is refused", () => {
  assert.equal(isIndexInFlight("indexing", minutesAgo(1), NOW), true);
  assert.equal(isIndexInFlight("indexing", minutesAgo(INDEX_CLAIM_STALE_MINUTES - 1), NOW), true);
});

test("a claim past the stale window is reclaimable, so a lost callback cannot wedge the repository", () => {
  // This is the case the timestamp exists for. The status is resolved by a
  // callback from the microservice; if that callback never arrives, a guard
  // reading the status alone would refuse every future rebuild for ever.
  assert.equal(isIndexInFlight("indexing", minutesAgo(INDEX_CLAIM_STALE_MINUTES + 1), NOW), false);
  assert.equal(isIndexInFlight("indexing", minutesAgo(60 * 24), NOW), false);
});

test("a row written before 0047 has no claim timestamp and reads as not in flight", () => {
  // The safe direction: a rebuild is allowed rather than blocked. Every row
  // that existed before the column was added looks like this.
  assert.equal(isIndexInFlight("indexing", null, NOW), false);
  assert.equal(isIndexInFlight("indexing", undefined, NOW), false);
});

test("only a pending status is a claim at all", () => {
  for (const status of ["idle", "succeeded", "failed", "stale", null, undefined, "", "INDEXING"]) {
    assert.equal(isIndexInFlight(status, minutesAgo(1), NOW), false, `status ${String(status)}`);
  }
});

test("a queued index counts as pending, and goes stale on the same clock", () => {
  // A queued index is one the dispatcher has not started yet, so starting a
  // second is the duplicate work this guard exists to prevent. And it must go
  // stale like any other claim, or a queue nothing can drain would wedge the
  // repository just as a lost callback would.
  assert.equal(isIndexInFlight("queued", minutesAgo(1), NOW), true);
  assert.equal(isIndexInFlight("queued", minutesAgo(INDEX_CLAIM_STALE_MINUTES + 1), NOW), false);
  assert.equal(isIndexInFlight("queued", null, NOW), false);
});

test("a timestamp is accepted as a string, the shape a database row carries", () => {
  assert.equal(isIndexInFlight("indexing", minutesAgo(1).toISOString(), NOW), true);
  assert.equal(
    isIndexInFlight("indexing", minutesAgo(INDEX_CLAIM_STALE_MINUTES + 1).toISOString(), NOW),
    false,
  );
});

test("the claim window is independent of the servable window", () => {
  // An index in flight means the graph is NOT servable: retrieval must fall
  // back to tree-only while it runs. These two predicates must not be confused.
  assert.equal(isIndexInFlight("indexing", minutesAgo(1), NOW), true);
  assert.equal(isGraphServable("indexing", minutesAgo(1)), false);
  // And a servable graph is never a claim.
  assert.equal(isGraphUsable(new Date(Date.now() - 60 * 1000)), true);
  assert.equal(isIndexInFlight("succeeded", new Date(), NOW), false);
});
