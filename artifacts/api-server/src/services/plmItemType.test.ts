import { test } from "node:test";
import assert from "node:assert/strict";
import { jiraItemType, adoItemType, TEST_CASE_LABEL } from "./plmItemType.js";

/**
 * The regression this file exists for: a test case pushed to Jira is an
 * ordinary Task carrying TEST_CASE_LABEL, and a top-level Jira Task maps to
 * story. Before the label check, the first sync after a push rewrote every
 * pushed case into a story — on the board, counted in the rail, and no longer
 * distinguishable from real work.
 */

test("a Jira Task carrying the test-case label is a test case, not a story", () => {
  assert.equal(jiraItemType("Task", [TEST_CASE_LABEL]), "test_case");
  assert.equal(jiraItemType("Task", ["test-case", "regression"]), "test_case");
});

test("a plain Jira Task is still a story", () => {
  assert.equal(jiraItemType("Task", []), "story");
  assert.equal(jiraItemType("Task", undefined), "story");
});

test("the label wins over the issue type, whatever the type is", () => {
  // A case pushed before the issue type is reconfigured, or relabelled by hand.
  assert.equal(jiraItemType("Story", [TEST_CASE_LABEL]), "test_case");
  assert.equal(jiraItemType("Bug", [TEST_CASE_LABEL]), "test_case");
});

test("the rest of the Jira mapping is unchanged", () => {
  assert.equal(jiraItemType("Epic", []), "epic");
  assert.equal(jiraItemType("Feature", []), "epic");
  assert.equal(jiraItemType("Story", []), "story");
  assert.equal(jiraItemType("Sub-task", []), "task");
  assert.equal(jiraItemType("Bug", []), "bug");
  assert.equal(jiraItemType("Something Custom", []), "task");
});

test("ADO types a real Test Case as one rather than falling through to task", () => {
  assert.equal(adoItemType("Test Case"), "test_case");
});

test("the rest of the ADO mapping is unchanged", () => {
  assert.equal(adoItemType("Epic"), "epic");
  assert.equal(adoItemType("Feature"), "epic");
  assert.equal(adoItemType("User Story"), "story");
  assert.equal(adoItemType("Product Backlog Item"), "story");
  assert.equal(adoItemType("Task"), "task");
  assert.equal(adoItemType("Bug"), "bug");
  assert.equal(adoItemType("Unknown"), "task");
});
