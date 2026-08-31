import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useRepo } from "@/context/RepoContext";
import { useTopBarSlot } from "@/context/TopBarContext";
import { fetchProjects, type Project } from "@/services/api";

/** Resolve the page title + optional mono subtitle from the current route. */
function usePageTitle(): { title: string; subtitle: string } {
  const [location] = useLocation();
  const { repos } = useRepo();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  const projMatch = location.match(/\/p\/(\d+)\/(board|runs)/);
  if (projMatch) {
    const id = Number(projMatch[1]);
    const project = projects.find((p) => p.id === id) ?? null;
    if (projMatch[2] === "runs") {
      return { title: project ? `${project.name} · Runs` : "Runs", subtitle: "" };
    }
    // board
    if (project) {
      const provider = project.plmProvider === "jira" ? "jira" : "azure-devops";
      const parts = [provider, project.plmProjectKey ?? ""].filter(Boolean);
      if (project.lastSyncedAt) parts.push(`synced ${new Date(project.lastSyncedAt).toLocaleDateString()}`);
      return { title: project.name, subtitle: `· ${parts.join(" · ")}` };
    }
    return { title: "Board", subtitle: "" };
  }

  const runMatch = location.match(/\/runs\/(\d+)/);
  if (runMatch) return { title: `Run #${runMatch[1]}`, subtitle: "" };

  const repoMatch = location.match(/\/repositories\/(\d+)/);
  if (repoMatch) {
    const repo = repos.find((r) => r.id === Number(repoMatch[1]));
    return { title: repo?.name ?? "Repository", subtitle: "" };
  }

  if (location === "/dashboard") return { title: "Dashboard", subtitle: "" };
  if (location === "/repositories") return { title: "Repositories", subtitle: "" };
  if (location === "/history") return { title: "History", subtitle: "" };
  if (location === "/settings") return { title: "Settings", subtitle: "" };
  if (location === "/projects/new") return { title: "New project", subtitle: "" };
  if (location === "/tasks") return { title: "Tasks", subtitle: "" };
  if (location === "/tasks/new") return { title: "New task", subtitle: "" };
  if (location.startsWith("/tasks/")) return { title: "Task", subtitle: "" };
  if (location.startsWith("/workspace/")) return { title: "Workspace", subtitle: "" };
  return { title: "Kandryn", subtitle: "" };
}

export function TopBar() {
  const { title, subtitle } = usePageTitle();
  const { actions } = useTopBarSlot();

  return (
    <>
      <style>{`
        .tb-root {
          height: var(--topbar-h); min-height: var(--topbar-h); flex-shrink: 0;
          display: flex; align-items: center; padding: 0 16px;
          background: var(--c-bg); border-bottom: 1px solid var(--c-border);
        }
        .tb-title { font-size: var(--fs-base); font-weight: 600; color: var(--c-ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tb-sub { font-size: var(--fs-sm); color: var(--c-ink-4); font-family: var(--mono);
          margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tb-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; padding-left: 12px; }
      `}</style>
      <header className="tb-root" data-testid="topbar">
        <span className="tb-title" title={title}>{title}</span>
        {subtitle && <span className="tb-sub">{subtitle}</span>}
        <div className="tb-actions">{actions}</div>
      </header>
    </>
  );
}
