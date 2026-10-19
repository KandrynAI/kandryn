import { and, eq, inArray } from "drizzle-orm";
import { db, projectsTable, tasksTable, runsTable, workItemLinksTable } from "@workspace/db";
import { getConfigs } from "./configService.js";
import { PlmError, normalizeJiraDomain } from "./plmProjects.js";
import { logger } from "../lib/logger.js";
import { jiraItemType, adoItemType, type BmType } from "./plmItemType.js";
import {
  jiraIssueLinks,
  adoWorkItemLinks,
  dedupeLinks,
  type TrackerLink,
  type JiraIssueLink,
  type AdoRelation,
} from "./plmLinks.js";

/**
 * Phase 2 hierarchy sync: pulls a project's full PLM work-item tree
 * (epic → story → task) into `tasks`, keyed on (project_id, external_id).
 *
 * The existing PLM adapters return the ingestion `DevCopilotTask` model (no
 * status / updated / url) and are bound to the config's default project, so
 * sync uses its own project-scoped fetch + a normalized model below.
 */

export interface SyncSummary {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
}

type BmStatus = "open" | "in-progress" | "review" | "done";
type BmPriority = "low" | "medium" | "high" | "critical";

interface SyncedItem {
  externalId: string;
  itemType: BmType;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  priority: BmPriority;
  status: BmStatus;
  plmStatus: string;
  parentExternalId: string | null;
  plmUrl: string | null;
  plmUpdatedAt: Date | null;
  /**
   * Backlog POSITION (1 = top), not the tracker's raw rank value. ADO's
   * StackRank is an unbounded float whose absolute value means nothing on its
   * own; the out_of_rank check asks "how many places apart are these two", so
   * the ordinal is what gets stored. Null when the tracker returned no rank.
   */
  rank: number | null;
}

/** What one provider fetch yields: the items, plus any dependency edges the
 *  tracker reported between them. */
interface FetchResult {
  items: SyncedItem[];
  links: TrackerLink[];
}

// ---- text converters (compact, self-contained) -----------------------------

type AdfNode = { type?: string; text?: string; content?: AdfNode[] };
function adfToText(node: AdfNode | string | null | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  const block = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock"]);
  if (node.type === "hardBreak" || node.type === "rule") return "\n";
  const inner = (node.content ?? []).map(adfToText).join("");
  if (block.has(node.type ?? "")) return node.type === "listItem" ? `• ${inner.trim()}\n` : `${inner.trim()}\n`;
  return inner;
}

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

function clean(s: string): string | null {
  const t = s.trim();
  return t.length ? t : null;
}

// ---- Jira -------------------------------------------------------------------

function jiraStatus(category: string | undefined): BmStatus {
  if (category === "done") return "done";
  if (category === "indeterminate") return "in-progress";
  return "open";
}

function jiraPriority(name: string | undefined): BmPriority {
  const n = (name ?? "").toLowerCase();
  if (n.includes("critical") || n.includes("blocker")) return "critical";
  if (n.includes("highest") || n.includes("high")) return "high";
  if (n.includes("lowest") || n.includes("low")) return "low";
  return "medium";
}

type JiraIssue = { key: string; fields: Record<string, unknown> };

async function fetchJiraItems(
  creds: { domain: string; email: string; token: string },
  projectKey: string,
): Promise<FetchResult> {
  const domain = normalizeJiraDomain(creds.domain);
  const auth = `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString("base64")}`;
  const jql = `project = "${projectKey.replace(/"/g, '\\"')}" ORDER BY updated DESC`;
  // labels carries the test-case marker createJiraTestCase sets. Without it a
  // pushed test case syncs back as a Jira Task, which maps to story below.
  // issuelinks rides along in the search response, so dependency edges cost no
  // extra request on the Jira side.
  const fields = "summary,description,issuetype,priority,parent,status,updated,labels,issuelinks";

  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  // Jira Cloud removed the classic GET /rest/api/3/search (410 Gone, May 2025).
  // Use the enhanced JQL search, which paginates by nextPageToken/isLast
  // instead of startAt/total. Guard against runaway pagination.
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ jql, maxResults: "100", fields });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);
    const res = await fetch(`${domain}/rest/api/3/search/jql?${params.toString()}`, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new PlmError(`Jira responded ${res.status} while syncing.`);
    const data = (await res.json()) as { issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
    const batch = data.issues ?? [];
    issues.push(...batch);
    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    nextPageToken = data.nextPageToken;
  }

  const links: TrackerLink[] = [];
  const items = issues.map((issue) => {
    const f = issue.fields;
    const typeName = (f.issuetype as { name?: string })?.name ?? "";
    const status = f.status as { name?: string; statusCategory?: { key?: string } } | undefined;
    const updated = f.updated as string | undefined;
    links.push(...jiraIssueLinks(issue.key, f.issuelinks as JiraIssueLink[] | undefined));
    return {
      externalId: issue.key,
      itemType: jiraItemType(typeName, f.labels as string[] | undefined),
      title: (f.summary as string) ?? "",
      description: clean(adfToText(f.description as AdfNode)),
      acceptanceCriteria: null,
      priority: jiraPriority((f.priority as { name?: string })?.name),
      status: jiraStatus(status?.statusCategory?.key),
      plmStatus: status?.name ?? "",
      parentExternalId: (f.parent as { key?: string })?.key ?? null,
      plmUrl: `${domain}/browse/${issue.key}`,
      plmUpdatedAt: updated ? new Date(updated) : null,
      // Jira's backlog rank is a LexoRank string on a per-site custom field, so
      // reading it needs a /field discovery request. Skipped: out_of_rank is
      // advisory and degrades to "not checked" when rank is absent.
      rank: null,
    } satisfies SyncedItem;
  });

  return { items, links: dedupeLinks(links) };
}

// ---- Azure DevOps -----------------------------------------------------------

function adoStatus(state: string | undefined): BmStatus {
  const s = (state ?? "").toLowerCase();
  if (["closed", "done", "completed"].includes(s)) return "done";
  if (["resolved"].includes(s)) return "review";
  if (["active", "doing", "in progress", "committed"].includes(s)) return "in-progress";
  return "open";
}

function adoPriority(p: number | undefined): BmPriority {
  if (p === 1) return "critical";
  if (p === 2) return "high";
  if (p === 4) return "low";
  return "medium";
}

type AdoItem = { id: number; fields: Record<string, unknown> };

/**
 * Dependency edges for a set of ADO work items.
 *
 * Its own request because the workitemsbatch API treats `fields` and `$expand`
 * as mutually exclusive — asking for relations means giving up the field
 * projection the item fetch depends on. Best-effort by contract: any failure
 * yields no edges and the sync carries on, because losing the order check is a
 * far smaller harm than losing the board.
 */
async function fetchAdoRelations(
  creds: { org: string; pat: string },
  ids: number[],
): Promise<TrackerLink[]> {
  const auth = `Basic ${Buffer.from(`:${creds.pat}`).toString("base64")}`;
  const orgUrl = `https://dev.azure.com/${creds.org}`;
  const links: TrackerLink[] = [];

  try {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const res = await fetch(`${orgUrl}/_apis/wit/workitemsbatch?api-version=7.1`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk, $expand: "Relations" }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "ADO relations fetch failed — syncing without dependency links");
        return [];
      }
      const data = (await res.json()) as { value?: Array<{ id: number; relations?: AdoRelation[] }> };
      for (const item of data.value ?? []) {
        links.push(...adoWorkItemLinks(String(item.id), item.relations));
      }
    }
  } catch (err) {
    logger.warn({ err }, "ADO relations fetch threw — syncing without dependency links");
    return [];
  }

  return links;
}

async function fetchAdoItems(
  creds: { org: string; pat: string },
  projectKey: string,
): Promise<FetchResult> {
  const auth = `Basic ${Buffer.from(`:${creds.pat}`).toString("base64")}`;
  const orgUrl = `https://dev.azure.com/${creds.org}`;
  const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectKey.replace(/'/g, "''")}' AND [System.WorkItemType] IN ('Epic','Feature','User Story','Product Backlog Item','Task','Bug') ORDER BY [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(`${orgUrl}/_apis/wit/wiql?api-version=7.1`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ query: wiql }),
    signal: AbortSignal.timeout(20000),
  });
  if (!wiqlRes.ok) throw new PlmError(`Azure DevOps responded ${wiqlRes.status} while syncing.`);
  const wiqlData = (await wiqlRes.json()) as { workItems?: Array<{ id: number }> };
  const ids = (wiqlData.workItems ?? []).map((w) => w.id);
  if (ids.length === 0) return { items: [], links: [] };

  const fields = [
    "System.Id",
    "System.WorkItemType",
    "System.Title",
    "System.Description",
    "System.State",
    "System.Parent",
    "System.ChangedDate",
    "Microsoft.VSTS.Common.Priority",
    "Microsoft.VSTS.Common.StackRank",
  ];

  const items: AdoItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await fetch(`${orgUrl}/_apis/wit/workitemsbatch?api-version=7.1`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk, fields }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new PlmError(`Azure DevOps responded ${res.status} while syncing.`);
    const data = (await res.json()) as { value?: AdoItem[] };
    items.push(...(data.value ?? []));
  }

  // StackRank is an unbounded float, so turn it into a 1-based backlog position
  // the out_of_rank check can measure a gap in. Items the tracker gave no rank
  // keep null rather than being pushed to the bottom.
  const rankOrder = items
    .map((it) => ({ id: String(it.fields["System.Id"]), raw: it.fields["Microsoft.VSTS.Common.StackRank"] }))
    .filter((x): x is { id: string; raw: number } => typeof x.raw === "number" && Number.isFinite(x.raw))
    .sort((a, b) => a.raw - b.raw);
  const positionById = new Map(rankOrder.map((x, i) => [x.id, i + 1]));

  const mapped = items.map((item) => {
    const f = item.fields;
    const id = String(f["System.Id"]);
    const changed = f["System.ChangedDate"] as string | undefined;
    const parent = f["System.Parent"];
    return {
      externalId: id,
      itemType: adoItemType((f["System.WorkItemType"] as string) ?? ""),
      title: (f["System.Title"] as string) ?? "",
      description: clean(stripHtml(f["System.Description"] as string)),
      acceptanceCriteria: clean(stripHtml(f["Microsoft.VSTS.Common.AcceptanceCriteria"] as string)),
      priority: adoPriority(f["Microsoft.VSTS.Common.Priority"] as number | undefined),
      status: adoStatus(f["System.State"] as string),
      plmStatus: (f["System.State"] as string) ?? "",
      parentExternalId: parent !== undefined && parent !== null ? String(parent) : null,
      plmUrl: `${orgUrl}/${encodeURIComponent(projectKey)}/_workitems/edit/${id}`,
      plmUpdatedAt: changed ? new Date(changed) : null,
      rank: positionById.get(id) ?? null,
    } satisfies SyncedItem;
  });

  const links = await fetchAdoRelations(creds, ids);
  return { items: mapped, links: dedupeLinks(links) };
}

// ---- Sync engine ------------------------------------------------------------

export async function syncProject(userId: string, projectId: number): Promise<SyncSummary> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)));
  if (!project) throw new PlmError("Project not found.", "not_connected");
  if (!project.plmProjectKey) throw new PlmError("This project has no PLM project bound.", "not_connected");

  // Fetch the PLM tree (project-scoped).
  // Resolve PLM creds team-first (0017): the project may belong to a team whose
  // shared Jira/ADO credentials any member can sync with.
  let fetched: FetchResult;
  if (project.plmProvider === "jira") {
    const c = await getConfigs(userId, ["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"], project.teamId);
    if (!c.JIRA_DOMAIN || !c.JIRA_EMAIL || !c.JIRA_API_TOKEN) {
      throw new PlmError("Jira is not connected. Add your Jira credentials in Integrations.", "not_connected");
    }
    fetched = await fetchJiraItems({ domain: c.JIRA_DOMAIN, email: c.JIRA_EMAIL, token: c.JIRA_API_TOKEN }, project.plmProjectKey);
  } else {
    const c = await getConfigs(userId, ["AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PAT"], project.teamId);
    if (!c.AZURE_DEVOPS_ORG || !c.AZURE_DEVOPS_PAT) {
      throw new PlmError("Azure DevOps is not connected. Add your Azure DevOps credentials in Integrations.", "not_connected");
    }
    fetched = await fetchAdoItems({ org: c.AZURE_DEVOPS_ORG, pat: c.AZURE_DEVOPS_PAT }, project.plmProjectKey);
  }
  const { items, links } = fetched;

  // Existing items for this project, indexed by external id.
  const existing = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.projectId, projectId), eq(tasksTable.userId, userId)));
  const byExternal = new Map(existing.filter((t) => t.externalId).map((t) => [t.externalId as string, t]));

  const summary: SyncSummary = { created: 0, updated: 0, unchanged: 0, conflicts: 0 };
  const source = project.plmProvider;

  // Pass 1: upsert every item.
  for (const item of items) {
    const prior = byExternal.get(item.externalId);
    if (!prior) {
      const [inserted] = await db
        .insert(tasksTable)
        .values({
          userId,
          projectId,
          externalId: item.externalId,
          source,
          type: item.itemType,
          itemType: item.itemType,
          title: item.title,
          description: item.description,
          acceptanceCriteria: item.acceptanceCriteria,
          priority: item.priority,
          status: item.status,
          plmStatus: item.plmStatus,
          plmUrl: item.plmUrl,
          plmUpdatedAt: item.plmUpdatedAt,
          plmRank: item.rank,
        })
        .returning();
      byExternal.set(item.externalId, inserted);
      summary.created++;
      continue;
    }

    // Skip if the PLM hasn't changed since we last saw it.
    const priorPlm = prior.plmUpdatedAt ? new Date(prior.plmUpdatedAt).getTime() : 0;
    const nextPlm = item.plmUpdatedAt ? item.plmUpdatedAt.getTime() : 0;
    // prior.itemType is compared too: a test case mis-typed as a story by an
    // earlier sync has not changed in the PLM, so without this it would skip
    // and keep the wrong type permanently. prior.plmRank is compared for the
    // same reason: every item synced before 0038 has a null rank, and nothing
    // about it has changed in the tracker, so without this the backfill would
    // never reach them.
    if (
      nextPlm !== 0 &&
      nextPlm === priorPlm &&
      prior.status === item.status &&
      prior.itemType === item.itemType &&
      prior.plmRank === item.rank
    ) {
      summary.unchanged++;
      continue;
    }

    // PLM is source of truth for status/title/description (§4.4).
    const [updated] = await db
      .update(tasksTable)
      .set({
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria ?? prior.acceptanceCriteria,
        priority: item.priority,
        status: item.status,
        itemType: item.itemType,
        type: item.itemType,
        plmStatus: item.plmStatus,
        plmUrl: item.plmUrl,
        plmUpdatedAt: item.plmUpdatedAt,
        plmRank: item.rank,
      })
      .where(eq(tasksTable.id, prior.id))
      .returning();
    byExternal.set(item.externalId, updated);
    summary.updated++;

    // Conflict: item closed in the PLM while a run is pending → cancel the run.
    if (item.status === "done") {
      const canceled = await db
        .update(runsTable)
        .set({ status: "canceled", error: `Item closed in ${source === "jira" ? "Jira" : "Azure DevOps"}`, finishedAt: new Date() })
        .where(
          and(
            eq(runsTable.workItemId, prior.id),
            inArray(runsTable.status, ["scheduled", "queued", "running"]),
          ),
        )
        .returning({ id: runsTable.id });
      if (canceled.length > 0) summary.conflicts += canceled.length;
    }
  }

  // Pass 2: resolve parent_id from external parent keys (parents may arrive after children).
  for (const item of items) {
    if (!item.parentExternalId) continue;
    const child = byExternal.get(item.externalId);
    const parent = byExternal.get(item.parentExternalId);
    if (!child || !parent || child.parentId === parent.id) continue;
    await db.update(tasksTable).set({ parentId: parent.id }).where(eq(tasksTable.id, child.id));
  }

  // Pass 3: reconcile tracker dependency edges (0038). Runs after pass 2 so
  // every endpoint is resolvable. Non-fatal by contract — the board is the
  // point of a sync, and losing the order check is the lesser harm.
  try {
    await reconcileTrackerLinks({ userId, projectId, teamId: project.teamId, links, byExternal });
  } catch (err) {
    logger.warn({ projectId, err }, "Tracker link reconciliation failed — board synced without updated links");
  }

  await db.update(projectsTable).set({ lastSyncedAt: new Date() }).where(eq(projectsTable.id, projectId));
  logger.info({ projectId, ...summary }, "Project sync complete");
  return summary;
}

/**
 * Make work_item_links agree with what the tracker just said.
 *
 * Scoped to source 'tracker' throughout: a link a human added by hand, or one
 * the model inferred, is not the tracker's to delete. An edge whose endpoints
 * are not both items of this project is dropped — a Jira issue may legitimately
 * block something in another project, and there is no row to point at.
 *
 * Exported only so the data-layer check can drive it against a real Postgres;
 * it deletes rows, and the rule it must never break (leave manual and inferred
 * links alone) is not something the type system can enforce.
 */
export async function reconcileTrackerLinks(args: {
  userId: string;
  projectId: number;
  teamId: number | null;
  links: readonly TrackerLink[];
  byExternal: Map<string, typeof tasksTable.$inferSelect>;
}): Promise<void> {
  const { userId, projectId, teamId, links, byExternal } = args;

  const desired = new Map<string, { fromItemId: number; toItemId: number }>();
  for (const link of links) {
    const from = byExternal.get(link.fromKey);
    const to = byExternal.get(link.toKey);
    if (!from || !to || from.id === to.id) continue;
    desired.set(`${from.id}:${to.id}`, { fromItemId: from.id, toItemId: to.id });
  }

  const existing = await db
    .select()
    .from(workItemLinksTable)
    .where(
      and(
        eq(workItemLinksTable.projectId, projectId),
        eq(workItemLinksTable.userId, userId),
        eq(workItemLinksTable.source, "tracker"),
        eq(workItemLinksTable.linkType, "blocks"),
      ),
    );

  const existingKeys = new Set(existing.map((r) => `${r.fromItemId}:${r.toItemId}`));
  const staleIds = existing.filter((r) => !desired.has(`${r.fromItemId}:${r.toItemId}`)).map((r) => r.id);
  const toInsert = [...desired.entries()].filter(([k]) => !existingKeys.has(k)).map(([, v]) => v);

  if (staleIds.length > 0) {
    await db.delete(workItemLinksTable).where(inArray(workItemLinksTable.id, staleIds));
  }
  if (toInsert.length > 0) {
    await db
      .insert(workItemLinksTable)
      .values(
        toInsert.map((v) => ({
          userId,
          teamId,
          projectId,
          fromItemId: v.fromItemId,
          toItemId: v.toItemId,
          linkType: "blocks" as const,
          source: "tracker" as const,
        })),
      )
      // A concurrent sync of the same project may have inserted the same edge.
      .onConflictDoNothing();
  }

  if (staleIds.length > 0 || toInsert.length > 0) {
    logger.info(
      { projectId, added: toInsert.length, removed: staleIds.length, total: desired.size },
      "Tracker links reconciled",
    );
  }
}
