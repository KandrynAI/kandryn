/**
 * Parsing dependency links out of a tracker payload.
 *
 * Its own module, and deliberately free of any database import: syncService
 * cannot be loaded without DATABASE_URL, which would put this logic out of
 * reach of the test suite (the same reason plmItemType.ts exists). Direction is
 * the whole game here — an edge pointing the wrong way tells a user to do the
 * work in exactly the reverse of the right order — so it needs to be testable.
 *
 * Only `blocks` edges are produced:
 *   - `parent` is already resolved onto tasks.parent_id by the sync's second
 *     pass. Writing it here too would be a second copy to keep reconciled, so
 *     sequenceService synthesizes parent edges from parent_id instead.
 *   - `relates` carries no ordering meaning and no finding type consumes it.
 * Both remain legal values on work_item_links for manual and inferred links.
 */

export type TrackerLinkType = "blocks" | "parent" | "relates";

export interface TrackerLink {
  /** Must finish first. */
  fromKey: string;
  /** Waits on `fromKey`. */
  toKey: string;
  linkType: TrackerLinkType;
}

// ---- Jira -------------------------------------------------------------------

export interface JiraIssueLink {
  type?: { name?: string; inward?: string; outward?: string };
  inwardIssue?: { key?: string };
  outwardIssue?: { key?: string };
}

type BlockDirection = "blocks" | "blocked_by" | null;

/**
 * What a Jira link-type phrase means for ordering.
 *
 * Matched on the inward/outward TEXT rather than the type name, because the
 * name is configurable per site and localised, while the phrasing of the
 * standard Blocks link ("blocks" / "is blocked by") is what Jira renders and
 * what admins preserve when they rename. "blocked by" is checked first: it
 * also contains "block", so testing for "block" first would read every
 * is-blocked-by link backwards.
 */
export function blockDirection(text: string | undefined): BlockDirection {
  const t = (text ?? "").toLowerCase().trim();
  if (!t) return null;
  if (t.includes("blocked by") || t.includes("blocked-by")) return "blocked_by";
  if (t.includes("block")) return "blocks";
  return null;
}

/**
 * Edges contributed by one issue's `issuelinks`.
 *
 * A Jira link always reads as the sentence "<this issue> <phrase> <other
 * issue>", whether the other issue arrives as `inwardIssue` or `outwardIssue` —
 * the phrase alone decides direction, which is why both branches below share
 * one rule.
 */
export function jiraIssueLinks(issueKey: string, links: readonly JiraIssueLink[] | undefined): TrackerLink[] {
  if (!links?.length) return [];
  const out: TrackerLink[] = [];

  for (const link of links) {
    const other = link.outwardIssue?.key ?? link.inwardIssue?.key;
    if (!other || other === issueKey) continue;
    const phrase = link.outwardIssue ? link.type?.outward : link.type?.inward;

    const dir = blockDirection(phrase);
    if (dir === "blocks") out.push({ fromKey: issueKey, toKey: other, linkType: "blocks" });
    else if (dir === "blocked_by") out.push({ fromKey: other, toKey: issueKey, linkType: "blocks" });
  }

  return out;
}

// ---- Azure DevOps -----------------------------------------------------------

export interface AdoRelation {
  rel?: string;
  url?: string;
}

/**
 * The numeric work-item id at the end of a relation URL
 * (…/_apis/wit/workItems/1234). Returns null for a relation that points at
 * anything else — an attachment, a commit, an external hyperlink.
 */
export function adoRelationTargetId(url: string | undefined): string | null {
  if (!url) return null;
  const m = /\/workItems\/(\d+)\s*$/i.exec(url.trim());
  return m ? m[1] : null;
}

/**
 * Edges contributed by one work item's `relations`.
 *
 * ADO names dependency links from the perspective of the item holding them:
 * `Dependency-Forward` points at this item's SUCCESSOR (which therefore waits
 * on this one) and `Dependency-Reverse` at its PREDECESSOR (which this one
 * waits on). Hierarchy relations are skipped — parentage already lives on
 * System.Parent, which the sync resolves onto tasks.parent_id.
 */
export function adoWorkItemLinks(itemId: string, relations: readonly AdoRelation[] | undefined): TrackerLink[] {
  if (!relations?.length) return [];
  const out: TrackerLink[] = [];

  for (const rel of relations) {
    const target = adoRelationTargetId(rel.url);
    if (!target || target === itemId) continue;
    const name = (rel.rel ?? "").toLowerCase();

    if (name === "system.linktypes.dependency-forward") {
      out.push({ fromKey: itemId, toKey: target, linkType: "blocks" });
    } else if (name === "system.linktypes.dependency-reverse") {
      out.push({ fromKey: target, toKey: itemId, linkType: "blocks" });
    }
  }

  return out;
}

// ---- shared -----------------------------------------------------------------

/**
 * Collapse duplicates. Both trackers report a link on each of the two issues it
 * joins, so a whole-project fetch sees every edge twice; a self-edge is dropped
 * because work_item_links rejects one at the database level anyway.
 */
export function dedupeLinks(links: readonly TrackerLink[]): TrackerLink[] {
  const seen = new Set<string>();
  const out: TrackerLink[] = [];
  for (const l of links) {
    if (l.fromKey === l.toKey) continue;
    const key = `${l.fromKey}\u0000${l.toKey}\u0000${l.linkType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}
