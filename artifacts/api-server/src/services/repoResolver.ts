import { and, asc, eq } from "drizzle-orm";
import { db, repositoriesTable } from "@workspace/db";

type Repo = typeof repositoriesTable.$inferSelect;

/**
 * Resolve a project's repository via repositories.project_id — the single source
 * of truth for the project↔repo binding (0020, replacing the deprecated
 * projects.repository_id). 1:1 by UI convention today; if a project ever owns
 * multiple repositories the lowest id wins until explicit selection is added.
 */
export async function getProjectRepository(
  projectId: number,
  userId: string,
): Promise<Repo | undefined> {
  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.projectId, projectId), eq(repositoriesTable.userId, userId)))
    .orderBy(asc(repositoriesTable.id))
    .limit(1);
  return repo;
}

/**
 * Resolve the repository a run targets. Prefers the snapshot on the run row
 * (runs.repository_id, taken at creation) so execution and commit act on one
 * fixed repo — closing the mid-flight rebinding window — and falls back to the
 * project's current binding for legacy runs created before the snapshot existed.
 */
export async function getRunRepository(run: {
  repositoryId: number | null;
  projectId: number;
  userId: string;
}): Promise<Repo | undefined> {
  if (run.repositoryId != null) {
    const [repo] = await db
      .select()
      .from(repositoriesTable)
      .where(and(eq(repositoriesTable.id, run.repositoryId), eq(repositoriesTable.userId, run.userId)));
    if (repo) return repo;
  }
  return getProjectRepository(run.projectId, run.userId);
}
