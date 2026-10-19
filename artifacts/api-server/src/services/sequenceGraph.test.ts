import { test } from "node:test";
import assert from "node:assert/strict";
import {
  directPrerequisites,
  transitivePrerequisites,
  findCycleThrough,
  orderPrerequisites,
  topologicalWaves,
  makeFindingId,
  computeFingerprint,
  verdictFrom,
  type GraphEdge,
} from "./sequenceGraph.js";

const e = (from: number, to: number): GraphEdge => ({ from, to });

// ---- prerequisites ----------------------------------------------------------

test("no links means no prerequisites (spec 1)", () => {
  assert.deepEqual(directPrerequisites(2, []), []);
  assert.deepEqual(transitivePrerequisites(2, []), []);
});

test("A blocks B: B has A as a prerequisite, A has none (spec 2)", () => {
  const edges = [e(1, 2)];
  assert.deepEqual(directPrerequisites(2, edges), [1]);
  assert.deepEqual(directPrerequisites(1, edges), []);
});

test("A blocks B blocks C: C's prerequisites are A and B transitively (spec 6)", () => {
  const edges = [e(1, 2), e(2, 3)];
  assert.deepEqual(directPrerequisites(3, edges), [2]);
  assert.deepEqual(transitivePrerequisites(3, edges).sort(), [1, 2]);
});

test("transitivePrerequisites terminates on an upstream cycle (spec 7)", () => {
  // A <-> B, both blocking C. Naive traversal would loop forever.
  const edges = [e(1, 2), e(2, 1), e(2, 3)];
  assert.deepEqual(transitivePrerequisites(3, edges).sort(), [1, 2]);
});

test("an item in a cycle is not its own prerequisite", () => {
  assert.deepEqual(transitivePrerequisites(1, [e(1, 2), e(2, 1)]), [2]);
});

test("duplicate edges do not duplicate a prerequisite", () => {
  assert.deepEqual(directPrerequisites(2, [e(1, 2), e(1, 2)]), [1]);
});

// ---- cycles -----------------------------------------------------------------

test("findCycleThrough returns the loop and does not hang (spec 7)", () => {
  const cycle = findCycleThrough(1, [e(1, 2), e(2, 1)]);
  assert.deepEqual(cycle, [1, 2, 1]);
});

test("findCycleThrough finds a longer loop", () => {
  const cycle = findCycleThrough(1, [e(1, 2), e(2, 3), e(3, 1)]);
  assert.deepEqual(cycle, [1, 2, 3, 1]);
});

test("findCycleThrough returns null for an acyclic graph", () => {
  assert.equal(findCycleThrough(1, [e(1, 2), e(2, 3)]), null);
  assert.equal(findCycleThrough(3, [e(1, 2), e(2, 3)]), null);
});

test("findCycleThrough ignores a cycle this item is not part of", () => {
  // 2 <-> 3 is a cycle, but nothing leads back to 1.
  assert.equal(findCycleThrough(1, [e(1, 2), e(2, 3), e(3, 2)]), null);
});

// ---- ordering ---------------------------------------------------------------

test("orderPrerequisites puts A before B for a chain (spec 6)", () => {
  assert.deepEqual(orderPrerequisites([2, 1], [e(1, 2), e(2, 3)]), [1, 2]);
});

test("orderPrerequisites ignores edges leaving the set", () => {
  // 9 is done and not in the set; it must not stall 1.
  assert.deepEqual(orderPrerequisites([1, 2], [e(9, 1), e(1, 2)]), [1, 2]);
});

test("orderPrerequisites still lists items caught in a cycle", () => {
  const out = orderPrerequisites([1, 2, 3], [e(1, 2), e(2, 3), e(3, 2)]);
  assert.equal(out[0], 1);
  assert.deepEqual([...out].sort(), [1, 2, 3], "nothing may be dropped");
});

test("orderPrerequisites is stable for the same input", () => {
  const edges = [e(1, 3), e(2, 3)];
  assert.deepEqual(orderPrerequisites([1, 2, 3], edges), orderPrerequisites([1, 2, 3], edges));
});

// ---- waves (spec 12) --------------------------------------------------------

test("topologicalWaves separates a diamond correctly", () => {
  // 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
  const { waves, cyclic } = topologicalWaves([1, 2, 3, 4], [e(1, 2), e(1, 3), e(2, 4), e(3, 4)]);
  assert.deepEqual(waves[0], [1]);
  assert.deepEqual([...waves[1]].sort(), [2, 3]);
  assert.deepEqual(waves[2], [4]);
  assert.deepEqual(cyclic, []);
});

test("topologicalWaves puts independent items in one wave", () => {
  const { waves } = topologicalWaves([1, 2, 3], []);
  assert.equal(waves.length, 1);
  assert.deepEqual([...waves[0]].sort(), [1, 2, 3]);
});

test("topologicalWaves separates the cycle group (spec 12)", () => {
  // 1 is clean; 2 <-> 3 cycle; 4 sits behind the cycle.
  const { waves, cyclic } = topologicalWaves([1, 2, 3, 4], [e(2, 3), e(3, 2), e(3, 4)]);
  assert.deepEqual(waves[0], [1]);
  assert.deepEqual([...cyclic].sort(), [2, 3, 4]);
});

test("topologicalWaves on an empty project yields nothing", () => {
  assert.deepEqual(topologicalWaves([], []), { waves: [], cyclic: [] });
});

// ---- identity (spec 11) -----------------------------------------------------

test("a finding id is stable for the same state", () => {
  assert.equal(makeFindingId("unmet_blocker", ["PAY-A"]), makeFindingId("unmet_blocker", ["PAY-A"]));
});

test("a finding id ignores the order evidence was collected in", () => {
  assert.equal(
    makeFindingId("file_overlap", ["PAY-A", "PAY-B"]),
    makeFindingId("file_overlap", ["PAY-B", "PAY-A"]),
  );
});

test("a finding id changes with the type and with the evidence", () => {
  const base = makeFindingId("unmet_blocker", ["PAY-A"]);
  assert.notEqual(base, makeFindingId("blocker_pr_unmerged", ["PAY-A"]));
  assert.notEqual(base, makeFindingId("unmet_blocker", ["PAY-B"]));
  assert.notEqual(base, makeFindingId("unmet_blocker", ["PAY-A", "PAY-B"]));
});

test("a finding id is 12 hex characters", () => {
  assert.match(makeFindingId("unmet_blocker", ["PAY-A"]), /^[0-9a-f]{12}$/);
});

test("a fingerprint is stable, order-independent, and moves when the set changes", () => {
  const a = makeFindingId("unmet_blocker", ["PAY-A"]);
  const b = makeFindingId("file_overlap", ["PAY-B"]);
  assert.equal(computeFingerprint([a, b]), computeFingerprint([b, a]));
  assert.notEqual(computeFingerprint([a, b]), computeFingerprint([a]));
  assert.notEqual(computeFingerprint([a]), computeFingerprint([]));
});

// ---- verdict (spec 8) -------------------------------------------------------

test("verdict: no findings is clear, a caution is caution, any warning wins", () => {
  assert.equal(verdictFrom([]), "clear");
  assert.equal(verdictFrom([{ severity: "caution" }]), "caution");
  assert.equal(verdictFrom([{ severity: "caution" }, { severity: "caution" }]), "caution");
  assert.equal(verdictFrom([{ severity: "caution" }, { severity: "warning" }]), "warning");
  assert.equal(verdictFrom([{ severity: "warning" }]), "warning");
});
