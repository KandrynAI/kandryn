import { eq } from "drizzle-orm";
import { db, repositoriesTable } from "@workspace/db";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";

// Pure usability predicates live in a db-free module (unit-testable); re-exported
// here so existing callers keep importing them from graphifyService.
export { isGraphUsable, isGraphServable, isIndexInFlight, INDEX_CLAIM_STALE_MINUTES } from "./graphUsability.js";

export interface GraphifyQueryResult {
  filePath: string;
  lineStart?: number; // parsed from sourceLocation "file.ts:42"
  lineEnd?: number; // lineStart + 40 (generous window)
  nodeLabel: string;
  relation: string; // how it was found: "direct" | "caller" | "callee" | "importer"
  confidence: number; // 0-1
  // Raw weighted relevance score (label==10 / includes==5 / file==3 / id==2 +
  // degree; one-hop neighbours far lower). Exposed for the Phase 4 confidence
  // gate's score-gap/density signals, which need finer granularity than the
  // coarse 1.0/0.9/0.6 confidence tiers.
  score: number;
}

function parseLineNumber(sourceLocation?: string): number | undefined {
  if (!sourceLocation) return undefined;
  const parts = sourceLocation.split(":");
  const n = parseInt(parts[parts.length - 1], 10);
  return isNaN(n) ? undefined : n;
}

/** Query the in-memory graph for the source files most relevant to `keywords`. */
export function queryGraph(
  graph: GraphifyGraph,
  keywords: string[],
  maxResults = 8,
): GraphifyQueryResult[] {
  if (!graph || !graph.nodes?.length) return [];

  const kw = keywords.map((k) => k.toLowerCase());

  const scored = graph.nodes.map((node) => {
    const label = node.label.toLowerCase();
    const file = node.sourceFile?.toLowerCase() ?? "";
    const nodeId = node.id.toLowerCase();

    let score = 0;
    for (const k of kw) {
      if (label === k) score += 10;
      if (label.includes(k)) score += 5;
      if (file.includes(k)) score += 3;
      if (nodeId.includes(k)) score += 2;
    }
    const degree = node.degree ?? 0;
    score += Math.min(degree * 0.1, 2);
    return { node, score };
  });

  const direct = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (direct.length === 0) return [];

  const directIds = new Set(direct.map((d) => d.node.id));
  const results: GraphifyQueryResult[] = [];

  for (const { node, score } of direct) {
    const start = parseLineNumber(node.sourceLocation);
    results.push({
      filePath: node.sourceFile,
      lineStart: start,
      lineEnd: start != null ? start + 40 : undefined,
      nodeLabel: node.label,
      relation: "direct",
      confidence: 1.0,
      score,
    });
  }

  // One hop: callers/callees/importers of direct matches.
  for (const edge of graph.edges) {
    if (results.length >= maxResults * 2) break;
    const isRelevantEdge =
      (directIds.has(edge.source) || directIds.has(edge.target)) &&
      ["calls", "imports", "imports_from"].includes(edge.relation);
    if (!isRelevantEdge) continue;

    const neighborId = directIds.has(edge.source) ? edge.target : edge.source;
    const neighbor = graph.nodes.find((n) => n.id === neighborId);
    if (!neighbor || !neighbor.sourceFile) continue;
    if (results.some((r) => r.filePath === neighbor.sourceFile)) continue;

    const start = parseLineNumber(neighbor.sourceLocation);
    results.push({
      filePath: neighbor.sourceFile,
      lineStart: start,
      lineEnd: start != null ? start + 30 : undefined,
      nodeLabel: neighbor.label,
      relation: edge.relation,
      confidence: edge.confidence === "EXTRACTED" ? 0.9 : 0.6,
      // One-hop neighbours are weak candidates — kept below the graph relevance
      // floor so they don't inflate the confidence density signal.
      score: edge.confidence === "EXTRACTED" ? 3 : 2,
    });
  }

  // Deduplicate by filePath, keeping the highest-confidence hit per file.
  const byFile = new Map<string, GraphifyQueryResult>();
  for (const r of results) {
    const existing = byFile.get(r.filePath);
    if (!existing || r.confidence > existing.confidence) byFile.set(r.filePath, r);
  }

  return Array.from(byFile.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

/** Whether the Graphify microservice is configured for this deployment. */
export function isGraphifyConfigured(): boolean {
  return Boolean(process.env.GRAPHIFY_SERVICE_URL);
}

interface TriggerIndexArgs {
  repoUrl: string;
  githubToken: string;
  repoId: number;
  /**
   * The user who asked for this index, recorded on the row (0047). Required
   * rather than optional: once a team admin can re-index a repository they do
   * not own, the row's own user_id no longer answers "who started this".
   */
  triggeredBy: string | null;
  /** Optional pino-style logger for a warning if the trigger fetch rejects. */
  log?: { warn: (obj: unknown, msg: string) => void };
}

/**
 * Ask the Graphify microservice to (re)index a repository. Used on connect
 * (Phase 2), on manual Rebuild, and after a commit lands (Phase 3 — the graph
 * is now stale). Returns whether a request was dispatched (false when the
 * microservice isn't configured). Never throws: the microservice replies 202
 * and does the clone + extract in the background, POSTing the result back to
 * /api/internal/graphify-callback.
 *
 * The CLAIM is awaited; the request to the microservice is not. That split is
 * deliberate. `isIndexInFlight` reads graph_started_at to refuse a duplicate
 * index, and a guard whose column is written fire-and-forget is not a guard:
 * on a serverless invocation the write can be dropped when the response is
 * sent, and the next caller then sees an unclaimed row. So the claim lands
 * before this function returns, and the caller awaits it.
 */
export async function triggerRepoIndex({
  repoUrl,
  githubToken,
  repoId,
  triggeredBy,
  log,
}: TriggerIndexArgs): Promise<boolean> {
  const graphifyUrl = process.env.GRAPHIFY_SERVICE_URL;
  if (!graphifyUrl) return false;

  // Claim the index: status, when it started and who asked (0021, 0047). The
  // callback resolves the status to succeeded/failed. Awaited, per the note
  // above. A failure here is logged and swallowed — the index itself is worth
  // attempting even when the bookkeeping write fails, and the stale-claim
  // window means a missing claim cannot wedge the repository.
  try {
    await db
      .update(repositoriesTable)
      .set({
        graphStatus: "indexing",
        graphError: null,
        graphStartedAt: new Date(),
        graphTriggeredBy: triggeredBy,
      })
      .where(eq(repositoriesTable.id, repoId));
  } catch (err) {
    log?.warn({ err }, "Graphify status update to indexing failed");
  }

  const callbackUrl = `${process.env.APP_BASE_URL ?? "https://app.kandryn.com"}/api/internal/graphify-callback`;
  void fetch(`${graphifyUrl}/index`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-secret": process.env.GRAPHIFY_SERVICE_SECRET ?? "",
    },
    body: JSON.stringify({
      repo_url: repoUrl,
      github_token: githubToken,
      repo_id: repoId,
      callback_url: callbackUrl,
    }),
  }).catch((err) => log?.warn({ err }, "Graphify index trigger failed"));

  return true;
}
