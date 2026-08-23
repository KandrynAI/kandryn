import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useUser, useClerk } from "@clerk/react";
import { useRepo } from "@/context/RepoContext";
import { useConfig } from "@/context/ConfigContext";
import { useTeam } from "@/context/TeamContext";
import { useActiveProject } from "@/context/ActiveProjectContext";
import {
  fetchProjectWorkItems,
  fetchRuns,
  fetchRepositories,
  type Repository,
} from "@/services/api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useRightPanel } from "@/context/RightPanelContext";

interface Counts {
  open: number;
  inProgress: number;
  review: number;
  done: number;
  openBugs: number;
  allBugs: number;
  scheduled: number;
  running: number;
  completed: number;
}

const ZERO_COUNTS: Counts = {
  open: 0,
  inProgress: 0,
  review: 0,
  done: 0,
  openBugs: 0,
  allBugs: 0,
  scheduled: 0,
  running: 0,
  completed: 0,
};

const STATUS_COL: Record<string, keyof Counts> = {
  open: "open",
  blocked: "open",
  "in-progress": "inProgress",
  review: "review",
  done: "done",
};

// Board status rows → the ?col= value the board reads.
const BOARD_ROWS: { label: string; key: keyof Counts; col: string }[] = [
  { label: "Open", key: "open", col: "open" },
  { label: "In progress", key: "inProgress", col: "progress" },
  { label: "Review", key: "review", col: "review" },
  { label: "Done", key: "done", col: "done" },
];

export function ContextPanel() {
  const [location, navigate] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { setActiveRepository } = useRepo();
  const { isAzureConnected, isJiraConnected } = useConfig();
  const { team, role, isAdmin, loading: teamLoading } = useTeam();
  const { open: openRightPanel } = useRightPanel();

  // Active project + project list come from the single shared source of truth.
  const { projects, activeProject } = useActiveProject();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);

  // Resolve the repository from the active project (repositories.project_id,
  // 0020) rather than the first of the user's repos. Sync it to RepoContext so
  // the shared active repository / stack profile follow the project.
  const [projectRepo, setProjectRepo] = useState<Repository | null>(null);
  useEffect(() => {
    if (!activeProject) {
      setProjectRepo(null);
      setActiveRepository(null);
      return;
    }
    let cancelled = false;
    fetchRepositories(activeProject.id)
      .then((rs) => {
        if (cancelled) return;
        const repo = rs[0] ?? null;
        setProjectRepo(repo);
        setActiveRepository(repo);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeProject, setActiveRepository]);

  // Keep repository navigation scoped to the current project so the active
  // project isn't lost when viewing a repo (PART 3).
  const repoHref = (path: string) => (activeProject ? `/p/${activeProject.id}${path}` : path);

  // Board + bug counts from the project's work items. Bugs are excluded from the
  // board columns and counted separately for the BUGS section.
  useEffect(() => {
    if (!activeProject) {
      setCounts(null);
      return;
    }
    let cancelled = false;
    setCountsLoading(true);
    fetchProjectWorkItems(activeProject.id)
      .then((items) => {
        if (cancelled) return;
        const c = { open: 0, inProgress: 0, review: 0, done: 0, openBugs: 0, allBugs: 0 };
        for (const it of items) {
          if (it.itemType === "bug") {
            c.allBugs += 1;
            if (it.status === "open") c.openBugs += 1;
            continue;
          }
          const col = STATUS_COL[it.status];
          if (col === "open") c.open += 1;
          else if (col === "inProgress") c.inProgress += 1;
          else if (col === "review") c.review += 1;
          else if (col === "done") c.done += 1;
        }
        setCounts((prev) => ({ ...(prev ?? ZERO_COUNTS), ...c }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject, location]);

  // Run counts (scheduled / running / completed). Poll every 5s so the badges stay
  // live while a run progresses in the background.
  useEffect(() => {
    if (!activeProject) return;
    let cancelled = false;
    const load = () =>
      fetchRuns({ projectId: activeProject.id })
        .then((runs) => {
          if (cancelled) return;
          let scheduled = 0;
          let running = 0;
          let completed = 0;
          for (const r of runs) {
            if (r.status === "scheduled") scheduled += 1;
            else if (r.status === "running" || r.status === "queued") running += 1;
            else if (r.status === "succeeded") completed += 1;
          }
          setCounts((prev) => ({ ...(prev ?? ZERO_COUNTS), scheduled, running, completed }));
        })
        .catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [activeProject]);

  const providerLabel = activeProject
    ? `${activeProject.plmProvider === "jira" ? "jira" : "azure"}${activeProject.plmProjectKey ? ` · ${activeProject.plmProjectKey}` : ""}`
    : "";

  const cell = (v: number | undefined): string =>
    countsLoading ? "" : v == null ? "—" : String(v);

  const goBoard = (col?: string) => {
    if (!activeProject) return;
    navigate(`/p/${activeProject.id}/board${col ? `?col=${col}` : ""}`);
  };

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
        .cp-proj-click { cursor: pointer; margin: -4px -6px 0; padding: 4px 6px; }
        .cp-proj-click:hover { background: var(--c-raised); }
        .cp-proj-name { font-size: var(--fs-base); font-weight: 600; color: var(--c-ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .cp-proj-meta { font-family: var(--mono); font-size: var(--fs-xs); color: var(--c-ink-4); margin-top: 2px; }
        .cp-switch { font-size: var(--fs-sm); color: var(--c-blue); cursor: pointer; margin-top: 6px;
          display: inline-flex; align-items: center; gap: 3px; background: none; border: none; padding: 0; font-family: var(--sans); }
        .cp-switch:hover { text-decoration: underline; }
        .cp-section { padding: 10px 12px 0; }
        .cp-label { font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-4);
          letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
        .cp-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; margin: 0 -6px; }
        .cp-row + .cp-row { border-top: 1px solid var(--c-border); }
        .cp-row.clickable { cursor: pointer; }
        .cp-row.clickable:hover { background: var(--c-raised); }
        .cp-row-label { font-size: var(--fs-sm); color: var(--c-ink-3); }
        .cp-row-count { font-size: var(--fs-sm); font-weight: 600; color: var(--c-ink); font-family: var(--mono); }
        .cp-skel { display: inline-block; width: 24px; height: 10px; background: var(--c-raised); animation: bmpulse 1.4s ease-in-out infinite; }
        .cp-repo { font-size: var(--fs-sm); color: var(--c-ink); font-family: var(--mono);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
        .cp-repo.clickable:hover { text-decoration: underline; }
        .cp-manage { font-size: var(--fs-xs); color: var(--c-blue); margin-top: 3px; cursor: pointer;
          background: none; border: none; padding: 0; display: block; font-family: var(--sans); }
        .cp-manage:hover { text-decoration: underline; }
        .cp-spacer { flex: 1; }
        .cp-foot { border-top: 1px solid var(--c-border); padding: 8px 12px; }
        .cp-dotrow { display: flex; align-items: center; gap: 5px; padding: 2px 6px; margin: 0 -6px; cursor: pointer; }
        .cp-dotrow:hover { background: var(--c-raised); }
        .cp-dotrow + .cp-dotrow { margin-top: 2px; }
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
        {/* TEAM */}
        {team && (
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {team.name}
              </span>
              <span style={{ fontSize: "var(--fs-xs)", padding: "1px 6px", borderRadius: 3, background: isAdmin ? "var(--c-blue-bg)" : "var(--c-raised)", color: isAdmin ? "var(--c-blue)" : "var(--c-ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {role}
              </span>
            </div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 2 }}>
              <span style={{ textTransform: "capitalize" }}>{team.plan}</span> plan
              {isAdmin && (
                <span style={{ color: "var(--c-blue)", cursor: "pointer", marginLeft: 8 }} onClick={() => navigate("/settings?tab=team")}>
                  Manage →
                </span>
              )}
            </div>
          </div>
        )}
        {!team && !teamLoading && (
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--c-border)" }}>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-blue)", cursor: "pointer" }} onClick={() => navigate("/setup")}>
              + Create workspace
            </span>
          </div>
        )}

        {/* PROJECT */}
        <div className="cp-proj">
          {activeProject ? (
            <>
              <div
                className="cp-proj-click"
                onClick={() => goBoard()}
                role="button"
                tabIndex={0}
                title={`Open ${activeProject.name} board`}
                data-testid="panel-project"
              >
                <div className="cp-proj-name" title={activeProject.name}>{activeProject.name}</div>
                <div className="cp-proj-meta">{providerLabel}</div>
              </div>
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
              <button
                onClick={() => navigate(`/projects/${activeProject.id}/settings`)}
                data-testid="project-settings-link"
                style={{
                  fontSize: 11,
                  color: "var(--c-ink-4)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 0",
                  marginTop: 2,
                  display: "block",
                  textAlign: "left",
                }}
              >
                Project settings
              </button>
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
          {BOARD_ROWS.map(({ label, key, col }) => (
            <div
              className={`cp-row${activeProject ? " clickable" : ""}`}
              key={label}
              onClick={activeProject ? () => goBoard(col) : undefined}
              role={activeProject ? "button" : undefined}
              title={activeProject ? `${label} on the board` : undefined}
            >
              <span className="cp-row-label">{label}</span>
              <span className="cp-row-count">
                {activeProject && countsLoading ? <span className="cp-skel" /> : activeProject ? cell(counts?.[key]) : "—"}
              </span>
            </div>
          ))}
        </div>

        {/* BUGS */}
        <div className="cp-section" style={{ marginTop: 12 }}>
          <div className="cp-label">Bugs</div>
          {([
            ["Open bugs", counts?.openBugs, "open"],
            ["All bugs", counts?.allBugs, "all"],
          ] as const).map(([label, val, filter]) => (
            <div
              className={`cp-row${activeProject ? " clickable" : ""}`}
              key={label}
              onClick={activeProject ? () => openRightPanel({ type: "bugs", filter, projectId: activeProject.id }) : undefined}
              role={activeProject ? "button" : undefined}
              title={activeProject ? label : undefined}
            >
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
            ["Scheduled", counts?.scheduled, "scheduled"],
            ["Running", counts?.running, "running"],
            ["Completed", counts?.completed, "completed"],
          ] as const).map(([label, val, status]) => (
            <div
              className={`cp-row${activeProject ? " clickable" : ""}`}
              key={label}
              onClick={activeProject ? () => openRightPanel({ type: "run-list", status, projectId: activeProject.id }) : undefined}
              role={activeProject ? "button" : undefined}
              title={activeProject ? `${label} runs` : undefined}
            >
              <span className="cp-row-label" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                {status === "running" && (val ?? 0) > 0 && (
                  <Loader2 className="animate-spin" size={11} style={{ color: "var(--c-blue)" }} />
                )}
                {label}
              </span>
              <span className="cp-row-count">
                {activeProject && countsLoading ? <span className="cp-skel" /> : activeProject ? cell(val) : "—"}
              </span>
            </div>
          ))}
        </div>

        {/* REPOSITORY — resolved from the active project (0020). */}
        <div className="cp-section" style={{ marginTop: 12 }}>
          <div className="cp-label">Repository</div>
          <div
            className={`cp-repo${projectRepo != null ? " clickable" : ""}`}
            title={projectRepo?.name ?? "No repository connected"}
            onClick={
              projectRepo != null
                ? () => navigate(repoHref(`/repositories/${projectRepo.id}`))
                : activeProject
                  ? () => navigate(repoHref("/repositories"))
                  : undefined
            }
            role={projectRepo != null || activeProject ? "button" : undefined}
          >
            {projectRepo?.name ?? (activeProject ? "Connect repository…" : "—")}
          </div>
          <button className="cp-manage" onClick={() => navigate(repoHref("/repositories"))}>Manage</button>
        </div>

        <div className="cp-spacer" />

        {/* FOOTER */}
        <div className="cp-foot">
          <div
            className="cp-dotrow"
            onClick={() => navigate("/settings")}
            role="button"
            title="Go to Settings to manage Jira credentials"
          >
            <span className="cp-dot" style={{ background: isJiraConnected ? "var(--c-green)" : "var(--c-ink-4)" }} />
            <span className="cp-dot-label">jira</span>
          </div>
          <div
            className="cp-dotrow"
            onClick={() => navigate("/settings")}
            role="button"
            title="Go to Settings to manage GitHub credentials"
          >
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
