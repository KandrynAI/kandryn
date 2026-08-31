import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetDashboardStats, useGetRecentActivity } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { GitCommit, CheckSquare, FileText, FlaskConical, ChevronRight, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useActiveProject } from "@/context/ActiveProjectContext";
import { fetchRuns, reRunItem, ApiError, type Run } from "@/services/api";

const RERUNNABLE = new Set(["failed", "canceled"]);

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();

  const [runs, setRuns] = useState<Run[] | null>(null);
  const [rerunning, setRerunning] = useState<Set<number>>(new Set());
  // The dashboard itself is cross-project — its stats and recent runs are
  // user-wide — but these tiles jump INTO a project, so they must use the same
  // active project the rest of the shell shows. Picking the first project here
  // sent them to the oldest one no matter which project you had switched to.
  const { activeProject } = useActiveProject();
  const activeProjectId = activeProject?.id ?? null;

  useEffect(() => {
    fetchRuns({ limit: 5 })
      .then((rs) =>
        setRuns([...rs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5)),
      )
      .catch(() => setRuns([]));
  }, []);

  // Project-scoped tiles fall back to project creation when there's no project.
  const goProject = (suffix: string) =>
    navigate(activeProjectId ? `/p/${activeProjectId}${suffix}` : "/projects/new");

  const reRun = async (run: Run, e: React.MouseEvent) => {
    e.stopPropagation();
    setRerunning((s) => new Set(s).add(run.id));
    try {
      const nr = await reRunItem(run.workItemId);
      toast({ title: "Run started" });
      navigate(`/runs/${nr.id}`);
    } catch (err) {
      toast({
        title: "Could not start run",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setRerunning((s) => {
        const n = new Set(s);
        n.delete(run.id);
        return n;
      });
    }
  };

  return (
    <div>
      <style>{`
        .dash-row:hover { background: var(--c-surface); }
        .dash-stat { cursor: pointer; position: relative; transition: background 150ms ease; }
        .dash-stat:hover { background: var(--c-surface); }
        .dash-chev { position: absolute; right: 8px; bottom: 8px; opacity: 0; transition: opacity 150ms ease; color: var(--c-ink-4); }
        .dash-stat:hover .dash-chev { opacity: 1; }
        .dash-rerun {
          font-size: var(--fs-xs); font-weight: 600; padding: 2px 8px; border-radius: 3px;
          background: transparent; color: var(--c-blue); border: 1px solid var(--c-blue);
          cursor: pointer; margin-left: 8px; display: inline-flex; align-items: center; gap: 4px;
        }
        .dash-rerun:hover { background: var(--c-blue-bg); }
        .dash-rerun:disabled { opacity: 0.6; cursor: default; }
      `}</style>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--c-border)" }}>
        <Stat label="Repositories" value={stats?.totalRepositories} loading={statsLoading} testId="total-repositories" first onClick={() => navigate("/repositories")} />
        <Stat label="Active tasks" value={(stats?.openTasks || 0) + (stats?.inProgressTasks || 0)} loading={statsLoading} testId="active-tasks" onClick={() => goProject("/board")} />
        <Stat label="Completed" value={stats?.completedTasks} loading={statsLoading} testId="completed-tasks" onClick={() => goProject("/board?col=done")} />
        <Stat label="Linked commits" value={stats?.linkedCommits} loading={statsLoading} testId="linked-commits" onClick={() => goProject("/runs?status=committed")} />
      </div>

      {/* Recent runs */}
      <div style={{ padding: "16px 20px 0" }}>
        <SectionLabel>Recent runs</SectionLabel>
        {runs === null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-4)" }}>No runs yet.</p>
        ) : (
          <div style={{ borderTop: "1px solid var(--c-border)" }}>
            {runs.map((run) => (
              <div
                key={run.id}
                className="dash-row"
                data-testid={`dash-run-${run.id}`}
                onClick={() => navigate(`/runs/${run.id}`)}
                style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid var(--c-border)" }}
              >
                <span className={`bm-badge bm-badge-${run.status}`}>{run.status}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>#{run.id}</span>
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>{run.trigger}</span>
                <span style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", fontFamily: "var(--mono)" }}>
                  {run.createdAt ? formatDistanceToNow(new Date(run.createdAt), { addSuffix: true }) : ""}
                </span>
                {RERUNNABLE.has(run.status) && (
                  <button className="dash-rerun" onClick={(e) => reRun(run, e)} disabled={rerunning.has(run.id)} title="Re-run this item">
                    {rerunning.has(run.id) ? <Loader2 size={12} className="animate-spin" /> : "Re-run"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div style={{ padding: "16px 20px" }}>
        <SectionLabel>Recent activity</SectionLabel>
        {activityLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !activity || activity.length === 0 ? (
          <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-4)" }}>No recent activity yet.</p>
        ) : (
          <div style={{ borderTop: "1px solid var(--c-border)" }}>
            {activity.map((item, i: number) => (
              <div
                key={item.id ?? i}
                className="dash-row"
                data-testid={`activity-item-${item.id}`}
                onClick={() => navigate(`/tasks/${item.id}`)}
                role="button"
                title={`Open ${item.title}`}
                style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid var(--c-border)" }}
              >
                <span style={{ color: "var(--c-ink-4)", display: "inline-flex" }}>
                  {item.type === "test_case" ? <FlaskConical size={14} /> : item.linkedCommit ? <GitCommit size={14} /> : item.status === "done" ? <CheckSquare size={14} /> : <FileText size={14} />}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-base)", color: "var(--c-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.title}
                </span>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", fontFamily: "var(--mono)", flexShrink: 0 }}>
                  {item.updatedAt ? formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true }) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)", marginBottom: 10 }}>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  testId,
  first,
  onClick,
}: {
  label: string;
  value?: number;
  loading: boolean;
  testId: string;
  first?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={onClick ? "dash-stat" : undefined}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      title={onClick ? `Open ${label}` : undefined}
      style={{ padding: "14px 20px", borderRight: "1px solid var(--c-border)", borderLeft: first ? "none" : undefined }}
    >
      {loading ? (
        <Skeleton className="h-6 w-12" />
      ) : (
        <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 600, color: "var(--c-ink)", fontFamily: "var(--mono)", lineHeight: 1 }} data-testid={`stat-${testId}`}>
          {value ?? 0}
        </div>
      )}
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 500 }}>
        {label}
      </div>
      {onClick && <ChevronRight size={12} className="dash-chev" />}
    </div>
  );
}
