import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { fetchProjects, type Project } from "@/services/api";
import { ACTIVE_PROJECT_KEY, RESOURCE_ROUTE_RE, projectRouteId, resolveActiveProject } from "@/lib/activeProject";

interface ActiveProjectContextValue {
  projects: Project[];
  activeProject: Project | null;
  /** Publish the project of the resource the current page renders (a run, a repo).
   *  Pass null to clear. Any page NOT under a /p/:id URL must call this via
   *  useActiveProjectFromResource so the sidebar reflects the resource, not a
   *  stale last-visited project. */
  setResourceProjectId: (id: number | null) => void;
  refetchProjects: () => void;
}

const ActiveProjectContext = createContext<ActiveProjectContextValue | null>(null);

/**
 * Single shared source of truth for the active project. Derives it once, via the
 * pure resolveActiveProject rule, from (in priority) the /p/:id URL → the
 * resource being viewed → the last-persisted selection → the first project.
 */
export function ActiveProjectProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  // State, not a one-shot read: the provider mounts once for the whole session,
  // so a value captured only in the initializer stays frozen at whatever was
  // stored at page load. Switching projects would then write localStorage but
  // leave this fallback pointing at the previous project — and every route
  // without /p/:id (the dashboard, settings) would resolve back to it.
  const [storedProjectId, setStoredProjectId] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(ACTIVE_PROJECT_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  const [resourceProjectId, setResourceProjectIdState] = useState<number | null>(null);

  const refetchProjects = useCallback(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);
  // Refetch on navigation so a project created this session appears without a reload.
  useEffect(() => {
    refetchProjects();
  }, [location, refetchProjects]);

  const routeId = projectRouteId(location);
  const activeProject = useMemo(
    () => resolveActiveProject(projects, { routeId, resourceProjectId, storedProjectId }),
    [projects, routeId, resourceProjectId, storedProjectId],
  );

  // Persist the active project, and keep the in-memory fallback in step with it
  // so a later un-prefixed route resolves to the project you are actually in.
  // The equality check is what stops this from looping: once stored matches the
  // resolved project, re-running the memo produces the same project again.
  useEffect(() => {
    if (!activeProject || activeProject.id === storedProjectId) return;
    setStoredProjectId(activeProject.id);
    try {
      localStorage.setItem(ACTIVE_PROJECT_KEY, String(activeProject.id));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [activeProject, storedProjectId]);

  // Dev-only regression guard: catch a project-resource route that forgot to call
  // useActiveProjectFromResource. Checked on a deferred tick so the page's own
  // mount effect (which sets the override) has run — a still-null override on a
  // resource-shaped, un-prefixed URL means the sidebar is showing a stale project.
  const resourceRef = useRef(resourceProjectId);
  resourceRef.current = resourceProjectId;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (routeId != null || !RESOURCE_ROUTE_RE.test(location)) return;
    const t = setTimeout(() => {
      if (resourceRef.current == null) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ActiveProject] "${location}" renders a project-owned resource but did not set an active project. ` +
            `Call useActiveProjectFromResource(resource.projectId) in that page, or the sidebar will show a stale project.`,
        );
      }
    }, 0);
    return () => clearTimeout(t);
  }, [location, routeId]);

  const setResourceProjectId = useCallback((id: number | null) => setResourceProjectIdState(id), []);
  const value = useMemo<ActiveProjectContextValue>(
    () => ({ projects, activeProject, setResourceProjectId, refetchProjects }),
    [projects, activeProject, setResourceProjectId, refetchProjects],
  );
  return <ActiveProjectContext.Provider value={value}>{children}</ActiveProjectContext.Provider>;
}

export function useActiveProject(): ActiveProjectContextValue {
  const ctx = useContext(ActiveProjectContext);
  if (!ctx) throw new Error("useActiveProject must be used within an ActiveProjectProvider");
  return ctx;
}

/**
 * Declare the project the current page's resource belongs to, so the sidebar's
 * active project follows the resource — not whatever was last active. The
 * override is set on mount / when the id resolves, and CLEARED on unmount (and
 * when the id changes), so navigating from a resource page to a generic page
 * (e.g. /settings) leaves nothing pinned.
 */
export function useActiveProjectFromResource(projectId: number | null | undefined): void {
  const { setResourceProjectId } = useActiveProject();
  useEffect(() => {
    setResourceProjectId(projectId ?? null);
    return () => setResourceProjectId(null);
  }, [projectId, setResourceProjectId]);
}
