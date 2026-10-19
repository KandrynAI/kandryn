import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockDirection,
  jiraIssueLinks,
  adoRelationTargetId,
  adoWorkItemLinks,
  dedupeLinks,
} from "./plmLinks.js";

// ---- Jira phrase direction --------------------------------------------------

test("blockDirection reads 'is blocked by' before 'blocks'", () => {
  // The whole trap: "is blocked by" contains "block".
  assert.equal(blockDirection("is blocked by"), "blocked_by");
  assert.equal(blockDirection("blocks"), "blocks");
  assert.equal(blockDirection("Blocks"), "blocks");
  assert.equal(blockDirection("  IS BLOCKED BY  "), "blocked_by");
  assert.equal(blockDirection("is blocked-by"), "blocked_by");
});

test("blockDirection ignores link phrases that carry no ordering", () => {
  for (const p of ["relates to", "duplicates", "is cloned by", "causes", "", undefined]) {
    assert.equal(blockDirection(p), null, `expected null for ${JSON.stringify(p)}`);
  }
});

// ---- Jira edges -------------------------------------------------------------

test("jira outward 'blocks' points from this issue to the other", () => {
  const links = jiraIssueLinks("PAY-A", [
    { type: { name: "Blocks", inward: "is blocked by", outward: "blocks" }, outwardIssue: { key: "PAY-B" } },
  ]);
  assert.deepEqual(links, [{ fromKey: "PAY-A", toKey: "PAY-B", linkType: "blocks" }]);
});

test("jira inward 'is blocked by' points from the other issue to this one", () => {
  const links = jiraIssueLinks("PAY-B", [
    { type: { name: "Blocks", inward: "is blocked by", outward: "blocks" }, inwardIssue: { key: "PAY-A" } },
  ]);
  assert.deepEqual(links, [{ fromKey: "PAY-A", toKey: "PAY-B", linkType: "blocks" }]);
});

test("the two sides of one jira link agree on direction", () => {
  // Jira reports the same link on both issues. Parsed from either end it must
  // describe the same edge, or a project sync would store both directions and
  // manufacture a cycle.
  const fromA = jiraIssueLinks("PAY-A", [
    { type: { inward: "is blocked by", outward: "blocks" }, outwardIssue: { key: "PAY-B" } },
  ]);
  const fromB = jiraIssueLinks("PAY-B", [
    { type: { inward: "is blocked by", outward: "blocks" }, inwardIssue: { key: "PAY-A" } },
  ]);
  assert.deepEqual(fromA, fromB);
});

test("jira non-blocking link types produce no edges", () => {
  assert.deepEqual(
    jiraIssueLinks("PAY-A", [
      { type: { inward: "is related to", outward: "relates to" }, outwardIssue: { key: "PAY-B" } },
      { type: { inward: "is duplicated by", outward: "duplicates" }, outwardIssue: { key: "PAY-C" } },
    ]),
    [],
  );
});

test("jira tolerates a malformed or empty issuelinks payload", () => {
  assert.deepEqual(jiraIssueLinks("PAY-A", undefined), []);
  assert.deepEqual(jiraIssueLinks("PAY-A", []), []);
  assert.deepEqual(jiraIssueLinks("PAY-A", [{}]), []);
  assert.deepEqual(jiraIssueLinks("PAY-A", [{ type: { outward: "blocks" } }]), []); // no target
  // A link pointing at itself is dropped rather than stored and rejected.
  assert.deepEqual(
    jiraIssueLinks("PAY-A", [{ type: { outward: "blocks" }, outwardIssue: { key: "PAY-A" } }]),
    [],
  );
});

// ---- ADO --------------------------------------------------------------------

test("adoRelationTargetId takes the work-item id and rejects anything else", () => {
  assert.equal(adoRelationTargetId("https://dev.azure.com/o/_apis/wit/workItems/1234"), "1234");
  assert.equal(adoRelationTargetId("https://dev.azure.com/o/_apis/wit/workitems/77"), "77");
  assert.equal(adoRelationTargetId("https://dev.azure.com/o/_apis/wit/attachments/abc"), null);
  assert.equal(adoRelationTargetId("https://example.com/some/page"), null);
  assert.equal(adoRelationTargetId(undefined), null);
});

test("ado Dependency-Forward points at a successor, so this item blocks it", () => {
  const links = adoWorkItemLinks("10", [
    { rel: "System.LinkTypes.Dependency-Forward", url: "https://dev.azure.com/o/_apis/wit/workItems/20" },
  ]);
  assert.deepEqual(links, [{ fromKey: "10", toKey: "20", linkType: "blocks" }]);
});

test("ado Dependency-Reverse points at a predecessor, so it blocks this item", () => {
  const links = adoWorkItemLinks("20", [
    { rel: "System.LinkTypes.Dependency-Reverse", url: "https://dev.azure.com/o/_apis/wit/workItems/10" },
  ]);
  assert.deepEqual(links, [{ fromKey: "10", toKey: "20", linkType: "blocks" }]);
});

test("the two sides of one ado dependency agree on direction", () => {
  const fwd = adoWorkItemLinks("10", [
    { rel: "System.LinkTypes.Dependency-Forward", url: "https://dev.azure.com/o/_apis/wit/workItems/20" },
  ]);
  const rev = adoWorkItemLinks("20", [
    { rel: "System.LinkTypes.Dependency-Reverse", url: "https://dev.azure.com/o/_apis/wit/workItems/10" },
  ]);
  assert.deepEqual(fwd, rev);
});

test("ado hierarchy and attachment relations are skipped", () => {
  // Parentage is resolved from System.Parent onto tasks.parent_id; duplicating
  // it as an edge would be a second copy to keep reconciled.
  assert.deepEqual(
    adoWorkItemLinks("10", [
      { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/o/_apis/wit/workItems/11" },
      { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/o/_apis/wit/workItems/9" },
      { rel: "AttachedFile", url: "https://dev.azure.com/o/_apis/wit/attachments/x" },
      { rel: "ArtifactLink", url: "vstfs:///Git/Commit/abc" },
    ]),
    [],
  );
});

test("ado relation matching is case-insensitive", () => {
  const links = adoWorkItemLinks("10", [
    { rel: "system.linktypes.dependency-forward", url: "https://dev.azure.com/o/_apis/wit/workitems/20" },
  ]);
  assert.deepEqual(links, [{ fromKey: "10", toKey: "20", linkType: "blocks" }]);
});

// ---- dedupe -----------------------------------------------------------------

test("dedupeLinks collapses the duplicate each tracker reports from both ends", () => {
  const deduped = dedupeLinks([
    { fromKey: "A", toKey: "B", linkType: "blocks" },
    { fromKey: "A", toKey: "B", linkType: "blocks" },
    { fromKey: "B", toKey: "C", linkType: "blocks" },
  ]);
  assert.deepEqual(deduped, [
    { fromKey: "A", toKey: "B", linkType: "blocks" },
    { fromKey: "B", toKey: "C", linkType: "blocks" },
  ]);
});

test("dedupeLinks keeps both directions of a genuine two-way cycle", () => {
  // A blocks B and B blocks A is a real (bad) state the cycle check must see,
  // not a duplicate to collapse.
  const deduped = dedupeLinks([
    { fromKey: "A", toKey: "B", linkType: "blocks" },
    { fromKey: "B", toKey: "A", linkType: "blocks" },
  ]);
  assert.equal(deduped.length, 2);
});

test("dedupeLinks drops a self-edge", () => {
  assert.deepEqual(dedupeLinks([{ fromKey: "A", toKey: "A", linkType: "blocks" }]), []);
});
