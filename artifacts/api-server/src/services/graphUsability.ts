// Pure graph-usability predicates, kept free of the db layer so they can be
// unit-tested without a DATABASE_URL. Re-exported from graphifyService for
// existing callers.

/** Whether a graph exists and is reasonably fresh (default 24h). Age only. */
export function isGraphUsable(graphBuiltAt: Date | string | null | undefined, maxAgeHours = 24): boolean {
  if (!graphBuiltAt) return false;
  const ageMs = Date.now() - new Date(graphBuiltAt).getTime();
  return ageMs < maxAgeHours * 3600 * 1000;
}

/**
 * Whether retrieval may actually USE the graph. Requires a completed build
 * (`succeeded`) AND freshness. A `stale` graph (URL changed since the build),
 * an in-flight `indexing`, a `failed`, or an `idle` graph is refused — retrieval
 * falls back to tree-only planning. This is the gate that makes retrievalMode
 * `graph` mean the graph is current, not merely that one exists.
 */
export function isGraphServable(
  graphStatus: string | null | undefined,
  graphBuiltAt: Date | string | null | undefined,
  maxAgeHours = 24,
): boolean {
  return graphStatus === "succeeded" && isGraphUsable(graphBuiltAt, maxAgeHours);
}
