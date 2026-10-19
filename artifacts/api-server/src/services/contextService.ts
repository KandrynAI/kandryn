import { and, eq } from "drizzle-orm";
import { db, projectsTable, tasksTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { compileContextPack, DEFAULT_PACK_BUDGET_TOKENS, type AncestorItem, type ContextPack } from "./contextPack.js";
import { retrieveReferences } from "./knowledgeRetrieval.js";

export { DEFAULT_PACK_BUDGET_TOKENS } from "./contextPack.js";
export type { ContextManifest, ContextPack } from "./contextPack.js";

/** How far up the hierarchy to walk. Kandryn's tree is epic → story → task. */
const DEFAULT_MAX_DEPTH = 3;

/**
 * The work item's ancestors, outermost first (epic, then story).
 *
 * Every hop is filtered by user_id AND project_id: `parent_id` is a plain
 * self-FK with no tenancy of its own, so a row repointed by a bad sync must
 * not be able to pull another user's item — or another project's — into a
 * prompt. A parent outside the scope ends the walk rather than being skipped,
 * because a broken chain is not background worth showing.
 */
export async function loadAncestors(
  userId: string,
  projectId: number,
  taskId: number,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Promise<AncestorItem[]> {
  const chain: AncestorItem[] = [];
  const seen = new Set<number>([taskId]);
  let currentId = taskId;

  for (let depth = 0; depth < maxDepth; depth++) {
    const [row] = await db
      .select({
        id: tasksTable.id,
        parentId: tasksTable.parentId,
        externalId: tasksTable.externalId,
        itemType: tasksTable.itemType,
        title: tasksTable.title,
        description: tasksTable.description,
        acceptanceCriteria: tasksTable.acceptanceCriteria,
      })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, currentId), eq(tasksTable.userId, userId), eq(tasksTable.projectId, projectId)));

    if (!row?.parentId) break;
    // A cycle (parent_id loops back) would otherwise spin to maxDepth and
    // render the same item twice.
    if (seen.has(row.parentId)) break;

    const [parent] = await db
      .select({
        id: tasksTable.id,
        externalId: tasksTable.externalId,
        itemType: tasksTable.itemType,
        title: tasksTable.title,
        description: tasksTable.description,
        acceptanceCriteria: tasksTable.acceptanceCriteria,
      })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, row.parentId), eq(tasksTable.userId, userId), eq(tasksTable.projectId, projectId)));

    if (!parent) break;
    seen.add(parent.id);
    chain.push(parent);
    currentId = parent.id;
  }

  // Walked upwards; the prompt reads downwards.
  return chain.reverse();
}

/**
 * The pack for one run. Best-effort by design: a run that cannot assemble its
 * background still runs with the prompt it had before this feature existed, so
 * every failure here returns an empty pack instead of throwing.
 *
 * Scoped to the PROJECT OWNER, not to `run.userId`. On a team project those
 * differ — a run records whoever triggered it, while `tasks` rows written by
 * sync and `knowledge_sources` rows written on upload both carry the owner's
 * id. Scoping by the triggering user would make both halves of the pack
 * silently come back empty for any run a team admin started.
 */
export async function buildRunContextPack(input: {
  projectId: number;
  workItemId: number;
  /** Used only if the project row cannot be read. */
  fallbackUserId: string;
  /** Omit to skip document retrieval (it needs the item's words). */
  workItem?: { title: string; acceptanceCriteria?: string[] };
  budgetTokens?: number;
}): Promise<ContextPack> {
  const { projectId, workItemId, fallbackUserId, workItem } = input;
  const budgetTokens = input.budgetTokens ?? DEFAULT_PACK_BUDGET_TOKENS;
  try {
    const [project] = await db
      .select({ userId: projectsTable.userId })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    const userId = project?.userId ?? fallbackUserId;

    // Independent sources, so fetched together. retrieveReferences already
    // swallows its own failures and returns [] — the pack simply carries no
    // reference section.
    const [parentChain, references] = await Promise.all([
      loadAncestors(userId, projectId, workItemId),
      workItem ? retrieveReferences({ userId, projectId, workItem }) : Promise.resolve([]),
    ]);
    return compileContextPack({ parentChain, references }, budgetTokens);
  } catch (err) {
    logger.warn({ err, projectId, workItemId }, "Context pack could not be built; running without project context");
    return { text: "", manifest: null };
  }
}
