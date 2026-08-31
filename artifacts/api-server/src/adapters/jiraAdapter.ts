import type { DevCopilotTask, PLMAdapter } from "../../../../shared/types/task.js";
import { logger } from "../lib/logger.js";
import { normalizeJiraDomain } from "../services/plmProjects.js";

type JiraIssue = {
  id: string;
  key: string;
  fields: Record<string, unknown>;
};

type JiraSearchResponse = {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
};

type JiraField = {
  id: string;
  name: string;
  schema?: { type?: string };
};

type JiraTransition = {
  id: string;
  name: string;
  to: { name: string };
};

type JiraTransitionsResponse = {
  transitions: JiraTransition[];
};

type AdfNode = {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
};

const ISSUE_TYPE_MAP: Record<string, DevCopilotTask["type"] | undefined> = {
  Epic: "epic",
  Feature: "feature",
  Story: "story",
  "User Story": "story",
  Task: "task",
  Subtask: "task",
  "Sub-task": "task",
  Bug: "bug",
};

function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return "";

  if (node.type === "text") return node.text ?? "";

  const blockTypes = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock"]);
  const lineBreakTypes = new Set(["hardBreak", "rule"]);

  if (lineBreakTypes.has(node.type)) return "\n";

  const children = (node.content ?? []).map(adfToText).join("");

  if (blockTypes.has(node.type)) {
    if (node.type === "listItem") return `• ${children.trim()}\n`;
    return `${children.trim()}\n`;
  }

  return children;
}

function parseAdf(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  try {
    return adfToText(raw as AdfNode).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}

function parseAcceptanceCriteria(raw: unknown): string[] {
  const text = parseAdf(raw);
  if (!text) return [];
  return text
    .split(/\n|;/)
    .map((s) => s.replace(/^•\s*/, "").trim())
    .filter(Boolean);
}

const PRIORITY_LABEL_MAP: Record<string, DevCopilotTask["priority"]> = {
  Highest: 1,
  High: 2,
  Medium: 3,
  Low: 4,
  Lowest: 4,
};

function mapPriority(priorityName: string | undefined): DevCopilotTask["priority"] {
  if (priorityName && priorityName in PRIORITY_LABEL_MAP) {
    return PRIORITY_LABEL_MAP[priorityName];
  }
  return 3;
}

export class JiraAdapter implements PLMAdapter {
  private readonly domain: string;
  private readonly email: string;
  private readonly apiToken: string;
  private readonly authHeader: string;
  private acFieldId: string | null = null;

  constructor(creds?: { domain?: string; email?: string; apiToken?: string }) {
    this.domain = creds?.domain ? normalizeJiraDomain(creds.domain) : "";
    this.email = creds?.email ?? "";
    this.apiToken = creds?.apiToken ?? "";
    this.authHeader = `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString("base64")}`;

    if (!this.domain || !this.email || !this.apiToken) {
      logger.warn("JiraAdapter: Missing JIRA_DOMAIN, JIRA_EMAIL, or JIRA_API_TOKEN");
    }
  }

  private get baseUrl(): string {
    return `${this.domain}/rest/api/3`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API error ${response.status} at ${path}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private async discoverAcFieldId(): Promise<string | null> {
    if (this.acFieldId !== null) return this.acFieldId;

    const fields = await this.request<JiraField[]>("/field");
    const AC_FIELD_NAMES = [
      "acceptance criteria",
      "acceptancecriteria",
      "story acceptance criteria",
      "definition of done",
    ];

    const match = fields.find(
      (f) =>
        AC_FIELD_NAMES.some((n) => f.name.toLowerCase().includes(n)) ||
        f.id.toLowerCase().includes("acceptancecriteria"),
    );

    this.acFieldId = match?.id ?? null;
    if (this.acFieldId) {
      logger.info({ fieldId: this.acFieldId, fieldName: match?.name }, "Jira AC field discovered");
    } else {
      logger.warn("JiraAdapter: Could not discover acceptance criteria custom field");
    }

    return this.acFieldId;
  }

  async fetchIncompleteTasks(): Promise<DevCopilotTask[]> {
    const acFieldId = await this.discoverAcFieldId();

    const jql = `
      issueType in (Epic, Feature, Story, "User Story", Task, Sub-task, Bug)
      AND statusCategory != Done
      AND sprint in openSprints()
      ORDER BY updated DESC
    `;

    const fieldsToFetch = [
      "summary",
      "description",
      "issuetype",
      "priority",
      "parent",
      ...(acFieldId ? [acFieldId] : []),
    ];

    const allIssues: JiraIssue[] = [];
    let nextPageToken: string | undefined;

    // Jira Cloud removed the classic GET /rest/api/3/search (410 Gone). Use the
    // enhanced JQL search with nextPageToken/isLast pagination.
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({ jql, maxResults: "100", fields: fieldsToFetch.join(",") });
      if (nextPageToken) params.set("nextPageToken", nextPageToken);
      const result = await this.request<JiraSearchResponse>(`/search/jql?${params.toString()}`);

      allIssues.push(...(result.issues ?? []));

      if (result.isLast || !result.nextPageToken || (result.issues ?? []).length === 0) break;
      nextPageToken = result.nextPageToken;
    }

    return allIssues.map((issue) => this.mapToTask(issue, acFieldId));
  }

  private mapToTask(issue: JiraIssue, acFieldId: string | null): DevCopilotTask {
    const f = issue.fields;

    const issueTypeName = (f.issuetype as { name?: string })?.name ?? "";
    const mappedType = ISSUE_TYPE_MAP[issueTypeName] ?? "task";

    const priorityName = (f.priority as { name?: string })?.name;

    const rawAc = acFieldId ? f[acFieldId] : undefined;
    const parentKey = (f.parent as { key?: string })?.key;

    return {
      id: issue.key,
      source: "jira",
      type: mappedType,
      title: (f.summary as string) ?? "",
      description: parseAdf(f.description),
      acceptanceCriteria: parseAcceptanceCriteria(rawAc),
      priority: mapPriority(priorityName),
      parentId: parentKey,
      rawSource: issue as unknown as object,
    };
  }

  async closeTask(taskId: string, commitHash: string): Promise<void> {
    const transitionsResult = await this.request<JiraTransitionsResponse>(
      `/issue/${taskId}/transitions`,
    );

    const DONE_NAMES = ["done", "closed", "resolved", "complete", "completed"];
    const doneTransition = transitionsResult.transitions.find((t) =>
      DONE_NAMES.some((n) => t.name.toLowerCase().includes(n) || t.to.name.toLowerCase().includes(n)),
    );

    if (!doneTransition) {
      throw new Error(
        `JiraAdapter: No 'Done' transition found for issue ${taskId}. Available: ${transitionsResult.transitions.map((t) => t.name).join(", ")}`,
      );
    }

    await this.request(`/issue/${taskId}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: doneTransition.id } }),
    });

    await this.request(`/issue/${taskId}/comment`, {
      method: "POST",
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `Closed via Kandryn. Commit: ${commitHash}`,
                },
              ],
            },
          ],
        },
      }),
    });

    logger.info({ taskId, commitHash }, "Jira issue closed");
  }
}
