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

/**
 * How long a `indexing` claim is honoured before another caller may take it.
 *
 * Longer than the UI style profile's 10 minutes because the work is not
 * comparable: that extraction reads at most 40 files through the git API, while
 * this one clones the whole repository and runs a parser over it in a separate
 * service. 30 minutes is well past a real index on a large repository and well
 * short of a working day, which is what matters: the only cost of waiting is a
 * delayed rebuild, and the only cost of reclaiming too early is a duplicate job
 * on the customer's repository.
 */
export const INDEX_CLAIM_STALE_MINUTES = 30;

/** The statuses that mean an index is already pending for this repository. */
const PENDING_STATUSES = new Set(["queued", "indexing"]);

/**
 * Whether an index is genuinely in flight, and so a new one must be refused.
 *
 * `graph_status = 'indexing'` alone is not enough to answer this. The status is
 * resolved by a callback from the Graphify microservice, and a callback that
 * never arrives would pin the row at `indexing` for ever; a guard reading only
 * the status would then refuse every rebuild and leave the repository
 * permanently un-indexable. So a claim is in flight only while it is fresh, and
 * a claim with no timestamp at all (every row written before 0047) reads as not
 * in flight, which is the safe direction: a rebuild is allowed, not blocked.
 *
 * `queued` counts as pending too (0048). A queued index is one the dispatcher
 * has not started yet, so starting a second is the same duplicate work the
 * guard exists to prevent; and the same stale window applies, so a queue the
 * dispatcher can never drain cannot wedge the repository either.
 */
export function isIndexInFlight(
  graphStatus: string | null | undefined,
  graphStartedAt: Date | string | null | undefined,
  now: Date = new Date(),
  staleMinutes: number = INDEX_CLAIM_STALE_MINUTES,
): boolean {
  if (!graphStatus || !PENDING_STATUSES.has(graphStatus)) return false;
  if (!graphStartedAt) return false;
  const ageMs = now.getTime() - new Date(graphStartedAt).getTime();
  return ageMs < staleMinutes * 60 * 1000;
}
