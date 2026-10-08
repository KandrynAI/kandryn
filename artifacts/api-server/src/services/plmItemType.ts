/**
 * Mapping a PLM work-item type onto ours.
 *
 * Its own module, and deliberately free of any database import: syncService
 * cannot be loaded without DATABASE_URL, which would put this logic out of
 * reach of the test suite. That matters here because the mapping is exactly
 * what failed silently — a pushed test case came back from Jira as a story,
 * landed on the board, and nothing in the type system or the UI objected.
 */

/** Mirrors tasks.item_type. */
export type BmType = "epic" | "story" | "task" | "bug" | "test_case";

/** The label createJiraTestCase stamps on every case it pushes. */
export const TEST_CASE_LABEL = "test-case";

const JIRA_TYPE: Record<string, BmType> = {
  Epic: "epic",
  Feature: "epic", // flattened into epic (decision §10.2)
  Story: "story",
  "User Story": "story",
  Task: "story", // top-level Jira Task ~ story (§4.1)
  "Sub-task": "task",
  Subtask: "task",
  Bug: "bug",
};

const ADO_TYPE: Record<string, BmType> = {
  Epic: "epic",
  Feature: "epic", // flattened (decision §10.2)
  "User Story": "story",
  "Product Backlog Item": "story",
  Task: "task",
  Bug: "bug",
  // ADO has a real Test Case work item type, so unlike Jira there is nothing to
  // infer. The sync's WIQL deliberately does not select Test Case — pushed
  // cases live as local mirrors it never touches — but if that list ever grows,
  // they must type as test_case rather than falling through to task.
  "Test Case": "test_case",
};

/**
 * Jira has no test-case issue type available to us (Xray and Zephyr are out of
 * scope), so createJiraTestCase pushes cases as ordinary Tasks carrying
 * TEST_CASE_LABEL. JIRA_TYPE maps a top-level Task to story, so without the
 * label check the first sync after a push rewrites every pushed case into a
 * story — on the board, counted, and indistinguishable from real work.
 *
 * The label wins over the issue type: it is the marker we set ourselves.
 */
export function jiraItemType(typeName: string, labels?: readonly string[]): BmType {
  if (labels?.includes(TEST_CASE_LABEL)) return "test_case";
  return JIRA_TYPE[typeName] ?? "task";
}

export function adoItemType(workItemType: string): BmType {
  return ADO_TYPE[workItemType] ?? "task";
}
