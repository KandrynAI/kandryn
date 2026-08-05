import { getConfigs } from "./configService.js";
import { PlmError, normalizeJiraDomain } from "./plmProjects.js";
import { logger } from "../lib/logger.js";

/**
 * PLM write layer (spec §3.2 / §4.1): creates a work item in Jira or Azure
 * DevOps and returns the identifiers we persist locally. Follows the same
 * project-scoped, standalone-fetch style as syncService.ts (the ingestion
 * adapters are bound to the config's default project and don't create).
 */

export type CreatableType = "epic" | "story" | "task" | "bug";
export type PlmProvider = "jira" | "azure-devops";

export interface PlmCreateInput {
  itemType: CreatableType;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  /** Parent's external id/key in the PLM (for hierarchy linkage). */
  parentExternalId?: string | null;
}

export interface PlmCreateResult {
  externalId: string;
  plmUrl: string;
  plmStatus: string | null;
}

const JIRA_ISSUE_TYPE: Record<CreatableType, string> = {
  epic: "Epic",
  story: "Story",
  task: "Task",
  bug: "Bug",
};

const ADO_WORK_ITEM_TYPE: Record<CreatableType, string> = {
  epic: "Epic",
  story: "User Story",
  task: "Task",
  bug: "Bug",
};

/** Combine description + acceptance criteria into a single plain-text body. */
function composeBody(description?: string | null, acceptanceCriteria?: string | null): string {
  const parts: string[] = [];
  if (description?.trim()) parts.push(description.trim());
  if (acceptanceCriteria?.trim()) {
    const lines = acceptanceCriteria
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `• ${l.replace(/^•\s*/, "")}`);
    if (lines.length) parts.push(`Acceptance Criteria:\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

/** Minimal ADF document from plain text (Jira Cloud REST v3 requires ADF). */
function textToAdf(text: string): object {
  const blocks = text.split(/\n{2,}/).map((block) => {
    const content: object[] = [];
    const lines = block.split(/\n/);
    lines.forEach((line, i) => {
      if (i > 0) content.push({ type: "hardBreak" });
      if (line.length) content.push({ type: "text", text: line });
    });
    return { type: "paragraph", content };
  });
  return { type: "doc", version: 1, content: blocks.length ? blocks : [{ type: "paragraph", content: [] }] };
}

// ---- Jira -------------------------------------------------------------------

async function jiraRequest<T>(
  creds: { domain: string; email: string; token: string },
  path: string,
  init: RequestInit,
): Promise<T> {
  const domain = normalizeJiraDomain(creds.domain);
  const auth = `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString("base64")}`;
  const res = await fetch(`${domain}/rest/api/3${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PlmError(`Jira responded ${res.status} while creating the item: ${body.slice(0, 300)}`);
  }
  // 204s (e.g. parent-link PUT) have no body.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function createJiraItem(
  creds: { domain: string; email: string; token: string },
  projectKey: string,
  input: PlmCreateInput,
): Promise<PlmCreateResult> {
  const domain = normalizeJiraDomain(creds.domain);
  const body = composeBody(input.description, input.acceptanceCriteria);
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: input.title.slice(0, 254),
    issuetype: { name: JIRA_ISSUE_TYPE[input.itemType] },
  };
  if (body) fields.description = textToAdf(body);
  if (input.parentExternalId) fields.parent = { key: input.parentExternalId };

  let created: { id: string; key: string };
  try {
    created = await jiraRequest<{ id: string; key: string }>(creds, "/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
  } catch (err) {
    // Parent linkage is the most fragile field (team- vs company-managed
    // projects differ). Retry once without it so creation still succeeds.
    if (input.parentExternalId) {
      logger.warn({ err }, "Jira create with parent failed — retrying without parent link");
      delete fields.parent;
      created = await jiraRequest<{ id: string; key: string }>(creds, "/issue", {
        method: "POST",
        body: JSON.stringify({ fields }),
      });
    } else {
      throw err;
    }
  }

  return {
    externalId: created.key,
    plmUrl: `${domain}/browse/${created.key}`,
    plmStatus: null,
  };
}

// ---- Azure DevOps -----------------------------------------------------------

async function createAdoItem(
  creds: { org: string; pat: string },
  projectKey: string,
  input: PlmCreateInput,
): Promise<PlmCreateResult> {
  const auth = `Basic ${Buffer.from(`:${creds.pat}`).toString("base64")}`;
  const orgUrl = `https://dev.azure.com/${creds.org}`;
  const type = ADO_WORK_ITEM_TYPE[input.itemType];
  const url = `${orgUrl}/${encodeURIComponent(projectKey)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`;

  const patch: object[] = [
    { op: "add", path: "/fields/System.Title", value: input.title.slice(0, 254) },
  ];
  const body = composeBody(input.description, input.acceptanceCriteria);
  if (body) patch.push({ op: "add", path: "/fields/System.Description", value: body.replace(/\n/g, "<br/>") });
  if (input.parentExternalId) {
    patch.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `${orgUrl}/_apis/wit/workItems/${input.parentExternalId}`,
      },
    });
  }

  const doRequest = async (doc: object[]) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json-patch+json" },
      body: JSON.stringify(doc),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new PlmError(`Azure DevOps responded ${res.status} while creating the item: ${t.slice(0, 300)}`);
    }
    return (await res.json()) as { id: number; fields?: Record<string, unknown> };
  };

  let created: { id: number; fields?: Record<string, unknown> };
  try {
    created = await doRequest(patch);
  } catch (err) {
    if (input.parentExternalId) {
      logger.warn({ err }, "ADO create with parent relation failed — retrying without it");
      created = await doRequest(patch.filter((p) => (p as { path?: string }).path !== "/relations/-"));
    } else {
      throw err;
    }
  }

  return {
    externalId: String(created.id),
    plmUrl: `${orgUrl}/${encodeURIComponent(projectKey)}/_workitems/edit/${created.id}`,
    plmStatus: (created.fields?.["System.State"] as string) ?? null,
  };
}

// ---- Test cases (Phase 5) ---------------------------------------------------

export interface PlmTestCaseInput {
  title: string;
  given?: string;
  when?: string;
  then?: string;
  priority?: "high" | "medium" | "low";
  type?: "happy-path" | "edge-case" | "failure";
  assertion?: string;
  tags?: string[];
  /** External id/key of the story/work item this case tests. */
  parentExternalId: string;
}

function testCaseBody(input: PlmTestCaseInput): string {
  const parts: string[] = [];
  const meta: string[] = [];
  if (input.priority) meta.push(`Priority: ${input.priority}`);
  if (input.type) meta.push(`Type: ${input.type}`);
  if (meta.length) parts.push(meta.join(" · "));
  if (input.given?.trim()) parts.push(`Given: ${input.given.trim()}`);
  if (input.when?.trim()) parts.push(`When: ${input.when.trim()}`);
  if (input.then?.trim()) parts.push(`Then: ${input.then.trim()}`);
  if (input.assertion?.trim()) parts.push(`Assert: ${input.assertion.trim()}`);
  if (input.tags?.length) parts.push(`Tags: ${input.tags.join(", ")}`);
  return parts.join("\n");
}

async function createJiraTestCase(
  creds: { domain: string; email: string; token: string },
  projectKey: string,
  input: PlmTestCaseInput,
): Promise<PlmCreateResult> {
  const domain = normalizeJiraDomain(creds.domain);
  const body = testCaseBody(input);
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: input.title.slice(0, 254),
    issuetype: { name: "Task" }, // Xray/Zephyr out of scope for v1 — labeled Task.
    labels: ["test-case", ...(input.tags ?? []).map((t) => t.replace(/\s+/g, "-")).slice(0, 8)],
  };
  if (body) fields.description = textToAdf(body);

  const created = await jiraRequest<{ id: string; key: string }>(creds, "/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  // Best-effort "Relates" link to the parent story.
  try {
    await jiraRequest(creds, "/issueLink", {
      method: "POST",
      body: JSON.stringify({
        type: { name: "Relates" },
        inwardIssue: { key: created.key },
        outwardIssue: { key: input.parentExternalId },
      }),
    });
  } catch (err) {
    logger.warn({ err }, "Jira test-case link to parent failed (item still created)");
  }

  return { externalId: created.key, plmUrl: `${domain}/browse/${created.key}`, plmStatus: null };
}

async function createAdoTestCase(
  creds: { org: string; pat: string },
  projectKey: string,
  input: PlmTestCaseInput,
): Promise<PlmCreateResult> {
  const auth = `Basic ${Buffer.from(`:${creds.pat}`).toString("base64")}`;
  const orgUrl = `https://dev.azure.com/${creds.org}`;
  const url = `${orgUrl}/${encodeURIComponent(projectKey)}/_apis/wit/workitems/$${encodeURIComponent("Test Case")}?api-version=7.1`;

  const body = testCaseBody(input);
  const patch: object[] = [{ op: "add", path: "/fields/System.Title", value: input.title.slice(0, 254) }];
  if (body) patch.push({ op: "add", path: "/fields/System.Description", value: body.replace(/\n/g, "<br/>") });
  // "Tests" relation to the story (test case tests the story).
  patch.push({
    op: "add",
    path: "/relations/-",
    value: {
      rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
      url: `${orgUrl}/_apis/wit/workItems/${input.parentExternalId}`,
    },
  });

  const doRequest = async (doc: object[]) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json-patch+json" },
      body: JSON.stringify(doc),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new PlmError(`Azure DevOps responded ${res.status} while creating the test case: ${t.slice(0, 300)}`);
    }
    return (await res.json()) as { id: number };
  };

  let created: { id: number };
  try {
    created = await doRequest(patch);
  } catch (err) {
    logger.warn({ err }, "ADO test-case create with relation failed — retrying without link");
    created = await doRequest(patch.filter((p) => (p as { path?: string }).path !== "/relations/-"));
  }

  return {
    externalId: String(created.id),
    plmUrl: `${orgUrl}/${encodeURIComponent(projectKey)}/_workitems/edit/${created.id}`,
    plmStatus: null,
  };
}

/** Create a test case in the project's PLM, linked to the parent story. */
export async function createPlmTestCase(
  userId: string,
  project: { plmProvider: PlmProvider; plmProjectKey: string | null },
  input: PlmTestCaseInput,
): Promise<PlmCreateResult> {
  if (!project.plmProjectKey) {
    throw new PlmError("This project has no PLM project bound.", "not_connected");
  }
  if (project.plmProvider === "jira") {
    const c = await getConfigs(userId, ["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"]);
    if (!c.JIRA_DOMAIN || !c.JIRA_EMAIL || !c.JIRA_API_TOKEN) {
      throw new PlmError("Jira is not connected. Add your Jira credentials in Integrations.", "not_connected");
    }
    return createJiraTestCase(
      { domain: c.JIRA_DOMAIN, email: c.JIRA_EMAIL, token: c.JIRA_API_TOKEN },
      project.plmProjectKey,
      input,
    );
  }
  const c = await getConfigs(userId, ["AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PAT"]);
  if (!c.AZURE_DEVOPS_ORG || !c.AZURE_DEVOPS_PAT) {
    throw new PlmError("Azure DevOps is not connected. Add your Azure DevOps credentials in Integrations.", "not_connected");
  }
  return createAdoTestCase({ org: c.AZURE_DEVOPS_ORG, pat: c.AZURE_DEVOPS_PAT }, project.plmProjectKey, input);
}

// ---- Public entry -----------------------------------------------------------

/**
 * Create a work item in the project's bound PLM using the user's credentials.
 * Throws PlmError (not_connected / unreachable) on credential or API problems.
 */
export async function createPlmWorkItem(
  userId: string,
  project: { plmProvider: PlmProvider; plmProjectKey: string | null },
  input: PlmCreateInput,
): Promise<PlmCreateResult> {
  if (!project.plmProjectKey) {
    throw new PlmError("This project has no PLM project bound.", "not_connected");
  }

  if (project.plmProvider === "jira") {
    const c = await getConfigs(userId, ["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"]);
    if (!c.JIRA_DOMAIN || !c.JIRA_EMAIL || !c.JIRA_API_TOKEN) {
      throw new PlmError("Jira is not connected. Add your Jira credentials in Integrations.", "not_connected");
    }
    return createJiraItem(
      { domain: c.JIRA_DOMAIN, email: c.JIRA_EMAIL, token: c.JIRA_API_TOKEN },
      project.plmProjectKey,
      input,
    );
  }

  const c = await getConfigs(userId, ["AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PAT"]);
  if (!c.AZURE_DEVOPS_ORG || !c.AZURE_DEVOPS_PAT) {
    throw new PlmError("Azure DevOps is not connected. Add your Azure DevOps credentials in Integrations.", "not_connected");
  }
  return createAdoItem({ org: c.AZURE_DEVOPS_ORG, pat: c.AZURE_DEVOPS_PAT }, project.plmProjectKey, input);
}
