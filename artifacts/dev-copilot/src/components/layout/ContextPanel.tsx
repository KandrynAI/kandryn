import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Check } from "lucide-react";
import { useUser, useClerk } from "@clerk/react";
import { useRepo } from "@/context/RepoContext";
import { useConfig } from "@/context/ConfigContext";
import { useTeam } from "@/context/TeamContext";
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

const ACTIVE_PROJECT_KEY = "bluemantis_active_project_id";

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

// Board status rows → the ?col= value the board reads.
const BOARD_ROWS: { label: string; key: keyof Counts; col: string }[] = [
  { label: "Open", key: "open", col: "open" },
  { label: "In progress", key: "inProgress", col: "progress" },
  { label: "Review", key: "review", col: "review" },
  { label: "Done", key: "done", col: "done" },
];

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const runItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "5px 6px",
  fontSize: 12,
  color: "var(--c-ink)",
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  borderRadius: 4,
};
const runTitleStyle: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const runSubStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--c-ink-4)",
  padding: "4px 4px 2px",
};

export function ContextPanel() {
  const [location, navigate] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { activeRepository, repos } = useRepo();
  const { isAzureConnected, isJiraConnected } = useConfig();
  const { team, role, isAdmin, loading: teamLoading } = useTeam();

  const [projects, setProjects] = useState<Project[]>([]);
  const [storedProjectId] = useState<number | null>(() => {
    const v = localStorage.getItem(ACTIVE_PROJECT_KEY);
    return v ? Number(v) : null;
  });
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const [itemTitles, setItemTitles] = useState<Map<number, string>>(new Map());
  const [runningRuns, setRunningRuns] = useState<Run[]>([]);
  const [completedRuns, setCompletedRuns] = useState<Run[]>([]);

  // Refetch on navigation so a project created this session appears without a reload.
  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, [location]);

  const routeMatch = location.match(/\/p\/(\d+)/);
  const routeId = routeMatch ? Number(routeMatch[1]) : null;
  const activeProject = useMemo(
    () =>
      projects.find((p) => p.id === routeId) ??
      projects.find((p) => p.id === storedProjectId) ??
      projects[0] ??
      null,
    [projects, routeId, storedProjectId],
  );

  // Persist the active project so it is restored on the next load.
  useEffect(() => {
    if (activeProject) localStorage.setItem(ACTIVE_PROJECT_KEY, String(activeProject.id));
  }, [activeProject]);
  const activeRepoId = activeRepository?.id ?? repos[0]?.id ?? null;

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
        setItemTitles(new Map(items.map((it) => [it.id, it.title])));
        setCounts(c);
      })
      .finally(() => {
        if (!cancelled) setCountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject, location]);

  // Running + recently completed runs for the panel lists. Poll every 5s so a run
  // that starts or finishes while the run panel is closed still shows up here.
  useEffect(() => {
    if (!activeProject) {
      setRunningRuns([]);
      setCompletedRuns([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchRuns({ projectId: activeProject.id, limit: 50 })
        .then((runs) => {
          if (cancelled) return;
          setRunningRuns(runs.filter((r) => r.status === "running" || r.status === "queued"));
          setCompletedRuns(runs.filter((r) => r.status === "succeeded").slice(0, 5));
        })
        .catch(() => {});
    };
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
  const goRuns = (status: string) => {
    if (!activeProject) return;
    navigate(`/p/${activeProject.id}/runs?status=${status}`);
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

        {/* RUNS */}
        <div className="cp-section" style={{ marginTop: 12 }}>
          <div className="cp-label">Runs</div>
          <div
            className={`cp-row${activeProject ? " clickable" : ""}`}
            onClick={activeProject ? () => goRuns("scheduled") : undefined}
            role={activeProject ? "button" : undefined}
            title={activeProject ? "Scheduled runs" : undefined}
          >
            <span className="cp-row-label">Scheduled</span>
            <span className="cp-row-count">
              {activeProject && countsLoading ? <span className="cp-skel" /> : activeProject ? cell(counts?.scheduled) : "—"}
            </span>
          </div>

          {runningRuns.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={runSubStyle}>Running</div>
              {runningRuns.map((run) => (
                <button key={run.id} onClick={() => navigate(`/runs/${run.id}`)} style={runItemStyle} title="View run">
                  <Loader2 className="animate-spin" size={12} style={{ color: "var(--c-blue)", flexShrink: 0 }} />
                  <span style={runTitleStyle}>{itemTitles.get(run.workItemId) ?? `#${run.workItemId}`}</span>
                </button>
              ))}
            </div>
          )}

          {completedRuns.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={runSubStyle}>Completed</div>
              {completedRuns.map((run) => (
                <button key={run.id} onClick={() => navigate(`/runs/${run.id}`)} style={runItemStyle} title="View run">
                  <Check size={12} strokeWidth={2.5} style={{ color: "var(--c-green)", flexShrink: 0 }} />
                  <span style={runTitleStyle}>{itemTitles.get(run.workItemId) ?? `#${run.workItemId}`}</span>
                  <span style={{ fontSize: 10, color: "var(--c-ink-4)", flexShrink: 0 }}>{relativeTime(run.finishedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* REPOSITORY */}
        <div className="cp-section" style={{ marginTop: 12 }}>
          <div className="cp-label">Repository</div>
          <div
            className={`cp-repo${activeRepoId != null ? " clickable" : ""}`}
            title={activeRepository?.name ?? repos[0]?.name ?? "No repository"}
            onClick={activeRepoId != null ? () => navigate(`/repositories/${activeRepoId}`) : undefined}
            role={activeRepoId != null ? "button" : undefined}
          >
            {activeRepository?.name ?? repos[0]?.name ?? "—"}
          </div>
          <button className="cp-manage" onClick={() => navigate("/repositories")}>Manage</button>
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
