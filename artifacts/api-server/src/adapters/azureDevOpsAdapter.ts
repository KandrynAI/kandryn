import type { DevCopilotTask, PLMAdapter } from "../../../../shared/types/task.js";
import { logger } from "../lib/logger.js";

type WorkItemFields = {
  "System.Id": number;
  "System.WorkItemType": string;
  "System.Title": string;
  "System.Description"?: string;
  "Microsoft.VSTS.Common.AcceptanceCriteria"?: string;
  "Microsoft.VSTS.Common.Priority"?: number;
  "System.Parent"?: number;
  [key: string]: unknown;
};

type WorkItemResult = {
  id: number;
  fields: WorkItemFields;
};

type WIQLResponse = {
  workItems: Array<{ id: number; url: string }>;
};

type WorkItemsBatchResponse = {
  value: WorkItemResult[];
};

const WORK_ITEM_TYPE_MAP: Record<string, DevCopilotTask["type"] | undefined> = {
  Epic: "epic",
  Feature: "feature",
  "User Story": "story",
  Task: "task",
  Bug: "bug",
};

const PRIORITY_MAP: Record<number, DevCopilotTask["priority"]> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
};

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseAcceptanceCriteria(raw: string | undefined): string[] {
  const text = stripHtml(raw);
  if (!text) return [];
  return text
    .split(/\n|;/)
    .map((s) => s.replace(/^•\s*/, "").trim())
    .filter(Boolean);
}

function mapPriority(p: number | undefined): DevCopilotTask["priority"] {
  if (p !== undefined && p in PRIORITY_MAP) return PRIORITY_MAP[p];
  return 3;
}

export class AzureDevOpsAdapter implements PLMAdapter {
  private readonly org: string;
  private readonly project: string;
  private readonly pat: string;
  private readonly authHeader: string;

  constructor(creds?: { org?: string; project?: string; pat?: string }) {
    this.org = creds?.org ?? "";
    this.project = creds?.project ?? "";
    const pat = creds?.pat ?? "";
    this.pat = pat;
    this.authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;

    if (!this.org || !this.project || !pat) {
      logger.warn("AzureDevOpsAdapter: Missing AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT, or AZURE_DEVOPS_PAT");
    }
  }

  private get baseUrl(): string {
    return `https://dev.azure.com/${this.org}/${this.project}`;
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Azure DevOps API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async fetchIncompleteTasks(): Promise<DevCopilotTask[]> {
    const wiql = `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.WorkItemType] IN ('Epic', 'Feature', 'User Story', 'Task', 'Bug')
        AND [System.State] NOT IN ('Done', 'Closed', 'Removed', 'Resolved')
      ORDER BY [System.ChangedDate] DESC
    `;

    const wiqlResult = await this.request<WIQLResponse>(
      `${this.baseUrl}/_apis/wit/wiql?api-version=7.1`,
      {
        method: "POST",
        body: JSON.stringify({ query: wiql }),
      },
    );

    if (!wiqlResult.workItems?.length) return [];

    const ids = wiqlResult.workItems.map((wi) => wi.id);
    const fields = [
      "System.Id",
      "System.WorkItemType",
      "System.Title",
      "System.Description",
      "Microsoft.VSTS.Common.AcceptanceCriteria",
      "Microsoft.VSTS.Common.Priority",
      "System.Parent",
    ];

    const batchResult = await this.request<WorkItemsBatchResponse>(
      `${this.baseUrl}/_apis/wit/workitemsbatch?api-version=7.1`,
      {
        method: "POST",
        body: JSON.stringify({ ids, fields }),
      },
    );

    return batchResult.value.map((item) => this.mapToTask(item));
  }

  private mapToTask(item: WorkItemResult): DevCopilotTask {
    const f = item.fields;
    const rawType = f["System.WorkItemType"];
    const mappedType = WORK_ITEM_TYPE_MAP[rawType] ?? "task";

    return {
      id: String(f["System.Id"]),
      source: "azure-devops",
      type: mappedType,
      title: f["System.Title"] ?? "",
      description: stripHtml(f["System.Description"]),
      acceptanceCriteria: parseAcceptanceCriteria(f["Microsoft.VSTS.Common.AcceptanceCriteria"]),
      priority: mapPriority(f["Microsoft.VSTS.Common.Priority"]),
      parentId: f["System.Parent"] !== undefined ? String(f["System.Parent"]) : undefined,
      rawSource: item as unknown as object,
    };
  }

  async closeTask(taskId: string, commitHash: string): Promise<void> {
    const patchDoc = [
      {
        op: "add",
        path: "/fields/System.State",
        value: "Done",
      },
      {
        op: "add",
        path: "/fields/System.History",
        value: `Closed via Kandryn. Commit: ${commitHash}`,
      },
    ];

    await this.request<unknown>(
      `${this.baseUrl}/_apis/wit/workitems/${taskId}?api-version=7.1`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json-patch+json",
        },
        body: JSON.stringify(patchDoc),
      },
    );

    logger.info({ taskId, commitHash }, "AzureDevOps task closed");
  }
}
