import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { useRepo } from "@/context/RepoContext";
import { useConfig } from "@/context/ConfigContext";
import {
  fetchProjects,
  fetchProjectWorkItems,
  fetchRuns,
  type Project,
  type WorkItem,
  type Run,
} from "@/services/api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface Counts {
  open: number;
  inProgress: number;
  review: number;
  done: number;
  scheduled: number;
  running: number;
}

const STATUS_COL: Record<string, keyof Counts> = {
  open: "open",
  blocked: "open",
  "in-progress": "inProgress",
  review: "review",
  done: "done",
};

export function ContextPanel() {
  const [location, navigate] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { activeRepository, repos } = useRepo();
  const { isAzureConnected, isJiraConnected } = useConfig();

  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  const routeMatch = location.match(/\/p\/(\d+)/);
  const routeId = routeMatch ? Number(routeMatch[1]) : null;
  const activeProject = useMemo(
    () => projects.find((p) => p.id === routeId) ?? projects[0] ?? null,
    [projects, routeId],
  );

  // Panel counts come from the same endpoints the board/runs pages use.
  useEffect(() => {
    if (!activeProject) {
      setCounts(null);
      return;
    }
    let cancelled = false;
    setCountsLoading(true);
    Promise.all([
      fetchProjectWorkItems(activeProject.id).catch(() => [] as WorkItem[]),
      fetchRuns({ projectId: activeProject.id }).catch(() => [] as Run[]),
    ])
      .then(([items, runs]) => {
        if (cancelled) return;
        const c: Counts = { open: 0, inProgress: 0, review: 0, done: 0, scheduled: 0, running: 0 };
        for (const it of items) {
          const col = STATUS_COL[it.status];
          if (col) (c[col] as number) += 1;
        }
        for (const r of runs) {
          if (r.status === "scheduled") c.scheduled += 1;
          else if (r.status === "running" || r.status === "queued") c.running += 1;
        }
        setCounts(c);
      })
      .finally(() => {
        if (!cancelled) setCountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject, location]);

  const providerLabel = activeProject
    ? `${activeProject.plmProvider === "jira" ? "jira" : "azure"}${activeProject.plmProjectKey ? ` · ${activeProject.plmProjectKey}` : ""}`
    : "";

  const cell = (v: number | undefined): string =>
    countsLoading ? "" : v == null ? "—" : String(v);

  return (
    <>
      <style>{`
        .cp-root {
          width: var(--panel-w); min-width: var(--panel-w); flex-shrink: 0;
          height: 100vh; background: var(--c-surface);
          border-right: 1px solid var(--c-border);
          display: flex; flex-direction: column; overflow: hidden;
          font-family: var(--sans);
        }
        .cp-proj { padding: 10px 12px; border-bottom: 1px solid var(--c-border); }
        .cp-proj-name { font-size: var(--fs-base); font-weight: 600; color: var(--c-ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .cp-proj-meta { font-family: var(--mono); font-size: var(--fs-xs); color: var(--c-ink-4); margin-top: 2px; }
        .cp-switch { font-size: var(--fs-sm); color: var(--c-blue); cursor: pointer; margin-top: 6px;
          display: inline-flex; align-items: center; gap: 3px; background: none; border: none; padding: 0; font-family: var(--sans); }
        .cp-switch:hover { text-decoration: underline; }
        .cp-section { padding: 10px 12px 0; }
        .cp-label { font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-4);
          letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
        .cp-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
        .cp-row + .cp-row { border-top: 1px solid var(--c-border); }
        .cp-row-label { font-size: var(--fs-sm); color: var(--c-ink-3); }
        .cp-row-count { font-size: var(--fs-sm); font-weight: 600; color: var(--c-ink); font-family: var(--mono); }
        .cp-skel { display: inline-block; width: 24px; height: 10px; background: var(--c-raised); animation: bmpulse 1.4s ease-in-out infinite; }
        .cp-repo { font-size: var(--fs-sm); color: var(--c-ink); font-family: var(--mono);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cp-manage { font-size: var(--fs-xs); color: var(--c-blue); margin-top: 3px; cursor: pointer;
          background: none; border: none; padding: 0; display: block; font-family: var(--sans); }
        .cp-manage:hover { text-decoration: underline; }
        .cp-spacer { flex: 1; }
        .cp-foot { border-top: 1px solid var(--c-border); padding: 8px 12px; }
        .cp-dotrow { display: flex; align-items: center; gap: 5px; }
        .cp-dotrow + .cp-dotrow { margin-top: 4px; }
        .cp-dot { width: 6px; height: 6px; border-radius: 0; flex-shrink: 0; }
        .cp-dot-label { font-size: var(--fs-xs); color: var(--c-ink-4); }
        .cp-email { margin-top: 6px; font-size: var(--fs-xs); color: var(--c-ink-4);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cp-signout { font-size: var(--fs-xs); color: var(--c-ink-4); cursor: pointer; margin-top: 2px;
          background: none; border: none; padding: 0; display: block; font-family: var(--sans); }
        .cp-signout:hover { color: var(--c-ink); }
        .cp-newproj { font-size: var(--fs-sm); color: var(--c-blue); cursor: pointer; margin-top: 4px;
          background: none; border: none; padding: 0; display: block; font-family: var(--sans); }
        .cp-newproj:hover { text-decoration: underline; }
      `}</style>

      <aside className="cp-root" data-testid="context-panel">
        {/* PROJECT */}
        <div className="cp-proj">
          {activeProject ? (
            <>
              <div className="cp-proj-name" title={activeProject.name}>{activeProject.name}</div>
              <div className="cp-proj-meta">{providerLabel}</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="cp-switch" data-testid="project-switcher">switch project ▾</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {projects.map((p) => (
                    <DropdownMenuItem key={p.id} onSelect={() => navigate(`/p/${p.id}/board`)}>
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate("/projects/new")} style={{ color: "var(--c-blue)" }}>
                    New project…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <div className="cp-proj-name" style={{ color: "var(--c-ink-4)" }}>No project</div>
              <button className="cp-newproj" onClick={() => navigate("/projects/new")}>+ New project</button>
            </>
          )}
        </div>

        {/* BOARD */}
        <div className="cp-section">
          <div className="cp-label">Board</div>
          {([
            ["Open", counts?.open],
            ["In progress", counts?.inProgress],
            ["Review", counts?.review],
            ["Done", counts?.done],
          ] as const).map(([label, val]) => (
            <div className="cp-row" key={label}>
              <span className="cp-row-label">{label}</span>
              <span className="cp-row-count">
                {activeProject && countsLoading ? <span className="cp-skel" /> : activeProject ? cell(val) : "—"}
              </span>
            </div>
          ))}
        </div>

        {/* RUNS */}
        <div className="cp-section" style={{ marginTop: 12 }}>
          <div className="cp-label">Runs</div>
          {([
            ["Scheduled", counts?.scheduled],
            ["Running", counts?.running],
          ] as const).map(([label, val]) => (
            <div className="cp-row" key={label}>
              <span className="cp-row-label">{label}</span>
              <span className="cp-row-count">
                {activeProject && countsLoading ? <span className="cp-skel" /> : activeProject ? cell(val) : "—"}
              </span>
            </div>
          ))}
        </div>

        {/* REPOSITORY */}
        <div className="cp-section" style={{ marginTop: 12 }}>
          <div className="cp-label">Repository</div>
          <div className="cp-repo" title={activeRepository?.name ?? repos[0]?.name ?? "No repository"}>
            {activeRepository?.name ?? repos[0]?.name ?? "—"}
          </div>
          <button className="cp-manage" onClick={() => navigate("/repositories")}>Manage</button>
        </div>

        <div className="cp-spacer" />

        {/* FOOTER */}
        <div className="cp-foot">
          <div className="cp-dotrow">
            <span className="cp-dot" style={{ background: isJiraConnected ? "var(--c-green)" : "var(--c-ink-4)" }} />
            <span className="cp-dot-label">jira</span>
          </div>
          <div className="cp-dotrow">
            <span className="cp-dot" style={{ background: isAzureConnected ? "var(--c-green)" : "var(--c-ink-4)" }} />
            <span className="cp-dot-label">github</span>
          </div>
          {user?.primaryEmailAddress?.emailAddress && (
            <div className="cp-email" title={user.primaryEmailAddress.emailAddress}>
              {user.primaryEmailAddress.emailAddress}
            </div>
          )}
          <button className="cp-signout" onClick={() => signOut()} data-testid="signout">sign out</button>
        </div>
      </aside>
    </>
  );
}
