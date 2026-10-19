/**
 * The graph half of the run-order check: prerequisites, cycles, ordering, and
 * the identity of a finding.
 *
 * Deliberately free of any database import, like plmItemType.ts and
 * plmLinks.ts. sequenceService cannot be loaded without DATABASE_URL, and this
 * is the logic whose mistakes are least visible: a wrong traversal does not
 * throw, it just orders someone's work incorrectly or misses a blocker.
 *
 * Every function here is total and cycle-safe. A dependency cycle is a real
 * state a tracker will happily hold, and it must never hang the check or the
 * request behind it — it is reported as a finding and overridden like anything
 * else.
 */

import { createHash } from "node:crypto";
import type { FindingType, SequenceFinding, SequenceVerdict } from "../../../../shared/types/sequence.js";

/** `from` must finish before `to` can safely run. */
export interface GraphEdge {
  from: number;
  to: number;
}

function incomingMap(edges: readonly GraphEdge[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const e of edges) {
    const list = m.get(e.to);
    if (list) list.push(e.from);
    else m.set(e.to, [e.from]);
  }
  return m;
}

function outgoingMap(edges: readonly GraphEdge[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const e of edges) {
    const list = m.get(e.from);
    if (list) list.push(e.to);
    else m.set(e.from, [e.to]);
  }
  return m;
}

/** Items that directly block `itemId`. */
export function directPrerequisites(itemId: number, edges: readonly GraphEdge[]): number[] {
  return [...new Set(incomingMap(edges).get(itemId) ?? [])];
}

/**
 * Every item that must finish before `itemId`, directly or through a chain.
 *
 * Breadth-first with a visited set, so a cycle upstream is traversed once
 * rather than forever. `itemId` itself is never returned even when it sits in
 * a cycle and is therefore its own ancestor.
 */
export function transitivePrerequisites(itemId: number, edges: readonly GraphEdge[]): number[] {
  const incoming = incomingMap(edges);
  const seen = new Set<number>();
  const queue = [...(incoming.get(itemId) ?? [])];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === itemId || seen.has(node)) continue;
    seen.add(node);
    for (const parent of incoming.get(node) ?? []) {
      if (!seen.has(parent)) queue.push(parent);
    }
  }

  return [...seen];
}

/**
 * A dependency cycle running through `itemId`, as the path back to itself, or
 * null when there is none. Depth-first over forward edges; the first cycle
 * found is enough, because the finding only needs to name one concrete loop
 * for a human to go and break it.
 */
export function findCycleThrough(itemId: number, edges: readonly GraphEdge[]): number[] | null {
  const outgoing = outgoingMap(edges);
  const stack: Array<{ node: number; path: number[] }> = [{ node: itemId, path: [itemId] }];
  const visited = new Set<number>();

  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    for (const next of outgoing.get(node) ?? []) {
      if (next === itemId) return [...path, itemId];
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push({ node: next, path: [...path, next] });
    }
  }

  return null;
}

/**
 * `ids` in an order that respects the edges between them — what the dialog's
 * "Do this first" list shows.
 *
 * Kahn's algorithm over the subgraph induced by `ids` alone, so an edge to an
 * item outside the set (already done, or in another project) cannot hold the
 * whole list back. Anything left over sits in a cycle and is appended in its
 * original order rather than dropped: the user still needs to see it.
 */
export function orderPrerequisites(ids: readonly number[], edges: readonly GraphEdge[]): number[] {
  const inSet = new Set(ids);
  const indegree = new Map<number, number>(ids.map((id) => [id, 0]));
  const next = new Map<number, number[]>();

  for (const e of edges) {
    if (!inSet.has(e.from) || !inSet.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    const list = next.get(e.from);
    if (list) list.push(e.to);
    else next.set(e.from, [e.to]);
  }

  // Seeded in the caller's order so the result is stable run to run, which the
  // check's fingerprint depends on.
  const ready = ids.filter((id) => indegree.get(id) === 0);
  const out: number[] = [];
  const done = new Set<number>();

  while (ready.length > 0) {
    const node = ready.shift()!;
    if (done.has(node)) continue;
    done.add(node);
    out.push(node);
    for (const n of next.get(node) ?? []) {
      const d = (indegree.get(n) ?? 1) - 1;
      indegree.set(n, d);
      if (d === 0) ready.push(n);
    }
  }

  for (const id of ids) if (!done.has(id)) out.push(id);
  return out;
}

export interface Waves {
  /** Wave 1 has no unsatisfied prerequisites; wave 2 depends only on wave 1. */
  waves: number[][];
  /** Items that could not be placed because they sit in, or behind, a cycle. */
  cyclic: number[];
}

/**
 * Group items into execution waves. Everything in one wave can be started in
 * parallel; a later wave waits on an earlier one.
 */
export function topologicalWaves(nodeIds: readonly number[], edges: readonly GraphEdge[]): Waves {
  const inSet = new Set(nodeIds);
  const indegree = new Map<number, number>(nodeIds.map((id) => [id, 0]));
  const next = new Map<number, number[]>();

  for (const e of edges) {
    if (!inSet.has(e.from) || !inSet.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    const list = next.get(e.from);
    if (list) list.push(e.to);
    else next.set(e.from, [e.to]);
  }

  const waves: number[][] = [];
  const placed = new Set<number>();
  let current = nodeIds.filter((id) => indegree.get(id) === 0);

  while (current.length > 0) {
    waves.push(current);
    for (const id of current) placed.add(id);

    const following: number[] = [];
    for (const id of current) {
      for (const n of next.get(id) ?? []) {
        const d = (indegree.get(n) ?? 1) - 1;
        indegree.set(n, d);
        if (d === 0) following.push(n);
      }
    }
    current = following;
  }

  return { waves, cyclic: nodeIds.filter((id) => !placed.has(id)) };
}

// ---- finding identity -------------------------------------------------------

/**
 * A finding's id: stable for the same state, different when the state changes.
 *
 * This is what the run request compares against to decide whether the user is
 * acknowledging the situation they were actually shown. Evidence is sorted, so
 * the order the analysis happened to visit items in cannot change the id and
 * spuriously invalidate an open dialog.
 */
export function makeFindingId(type: FindingType, evidenceIds: readonly string[]): string {
  const canonical = `${type}|${[...evidenceIds].sort().join(",")}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/** A hash over the whole finding set — the staleness check for one dialog. */
export function computeFingerprint(findingIds: readonly string[]): string {
  return createHash("sha256").update([...findingIds].sort().join(",")).digest("hex");
}

/** Any warning outranks any number of cautions; no findings at all is clear. */
export function verdictFrom(findings: readonly Pick<SequenceFinding, "severity">[]): SequenceVerdict {
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.length > 0) return "caution";
  return "clear";
}
