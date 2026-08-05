import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";

export interface GraphifyQueryResult {
  filePath: string;
  lineStart?: number; // parsed from sourceLocation "file.ts:42"
  lineEnd?: number; // lineStart + 40 (generous window)
  nodeLabel: string;
  relation: string; // how it was found: "direct" | "caller" | "callee" | "importer"
  confidence: number; // 0-1
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

  for (const { node } of direct) {
    const start = parseLineNumber(node.sourceLocation);
    results.push({
      filePath: node.sourceFile,
      lineStart: start,
      lineEnd: start != null ? start + 40 : undefined,
      nodeLabel: node.label,
      relation: "direct",
      confidence: 1.0,
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

/** Whether a graph exists and is reasonably fresh (default 24h). */
export function isGraphUsable(graphBuiltAt: Date | string | null | undefined, maxAgeHours = 24): boolean {
  if (!graphBuiltAt) return false;
  const ageMs = Date.now() - new Date(graphBuiltAt).getTime();
  return ageMs < maxAgeHours * 3600 * 1000;
}
