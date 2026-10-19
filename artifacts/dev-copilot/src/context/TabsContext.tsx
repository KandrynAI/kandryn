import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useLocation } from "wouter";

export type TabKind =
  | "tasks" | "task" | "workspace" | "repositories" | "repository"
  | "dashboard" | "history" | "settings" | "other";

export interface OpenTab {
  path: string;
  title: string;
  kind: TabKind;
}

/** Derive a tab's title + kind from a route path. */
export function deriveTabMeta(path: string): OpenTab {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/tasks") return { path: "/tasks", title: "Tasks", kind: "tasks" };
  if (p === "/tasks/new") return { path, title: "New task", kind: "task" };
  if (p.startsWith("/tasks/")) return { path, title: `Task ${p.split("/")[2]}`, kind: "task" };
  if (p.startsWith("/workspace/")) return { path, title: `Workspace ${p.split("/")[2]}`, kind: "workspace" };
  if (p === "/repositories") return { path, title: "Repositories", kind: "repositories" };
  if (p.startsWith("/repositories/")) return { path, title: `Repo ${p.split("/")[2]}`, kind: "repository" };
  if (p === "/dashboard") return { path, title: "Dashboard", kind: "dashboard" };
  if (p === "/history") return { path, title: "History", kind: "history" };
  if (p === "/settings") return { path, title: "Settings", kind: "settings" };
  // Project settings, under either path shape. Header tabs are only ever
  // opened explicitly, so this titles the tab if one is opened for it.
  if (/^\/(?:p|projects)\/[^/]+\/settings$/.test(p)) return { path, title: "Settings", kind: "settings" };
  return { path: p, title: p, kind: "other" };
}

interface TabsContextValue {
  tabs: OpenTab[];
  activePath: string;
  /** Plain navigation — switches the view WITHOUT opening a header tab. */
  open: (path: string) => void;
  /** Explicit tab open — adds a header tab (if absent) and navigates to it. */
  openTab: (path: string) => void;
  close: (path: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  // Header tabs are opened explicitly only — start empty, never auto-populate.
  const [tabs, setTabs] = useState<OpenTab[]>([]);

  const open = useCallback((path: string) => navigate(path), [navigate]);

  const openTab = useCallback(
    (path: string) => {
      setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, deriveTabMeta(path)]));
      navigate(path);
    },
    [navigate],
  );

  const close = useCallback(
    (path: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === path);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.path !== path);
        // If the closed tab was the active view, fall back to a neighbouring tab.
        if (path === location) {
          const fallback = next[idx - 1] ?? next[idx];
          if (fallback) navigate(fallback.path);
        }
        return next;
      });
    },
    [location, navigate],
  );

  return (
    <TabsContext.Provider value={{ tabs, activePath: location, open, openTab, close }}>
      {children}
    </TabsContext.Provider>
  );
}

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used inside TabsProvider");
  return ctx;
}
