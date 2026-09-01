// Single source of truth for deriving the sidebar's active project. Kept pure
// (no React) so the priority rule is unit-testable and there is exactly ONE
// derivation used everywhere — never a per-route reimplementation.

export const ACTIVE_PROJECT_KEY = "kandryn_active_project_id";

/**
 * Resource-shaped app paths that render a project-owned resource but do NOT
 * carry a `/p/:projectId` URL segment. A page matching this MUST publish its
 * resource's project via `useActiveProjectFromResource`, or the sidebar falls
 * back to a stale project. Used by the dev-time guard to catch a new such route
 * that forgets the hook.
 */
export const RESOURCE_ROUTE_RE = /^\/(runs|repositories)\/\d+/;

/** The project id encoded in a `/p/:projectId/…` URL, or null. */
export function projectRouteId(location: string): number | null {
  const m = location.match(/\/p\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export interface ProjectLike {
  id: number;
}

/**
 * Resolve the active project, in strict priority order:
 *   1. `routeId`            — an explicit `/p/:id` URL (most authoritative)
 *   2. `resourceProjectId`  — the project of the resource being viewed (a run,
 *                             a repository) — beats stale storage
 *   3. `storedProjectId`    — the last-persisted selection (localStorage)
 *   4. the first project
 * Returning null only when the user has no projects.
 */
export function resolveActiveProject<T extends ProjectLike>(
  projects: T[],
  opts: { routeId?: number | null; resourceProjectId?: number | null; storedProjectId?: number | null },
): T | null {
  const byId = (id: number | null | undefined) => (id != null ? projects.find((p) => p.id === id) : undefined);
  return byId(opts.routeId) ?? byId(opts.resourceProjectId) ?? byId(opts.storedProjectId) ?? projects[0] ?? null;
}
