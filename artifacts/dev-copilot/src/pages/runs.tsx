import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useLocation, useSearch } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, X, Loader2, Clock, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import {
  fetchRuns,
  fetchProject,
  fetchProjectWorkItems,
  cancelRun,
  reRunItem,
  ApiError,
  type Run,
  type RunStatus,
  type Project,
  type WorkItem,
} from "@/services/api";

const STATUS_META: Record<RunStatus, { label: string; className: string; icon: typeof Clock }> = {
  scheduled: { label: "Scheduled", className: "text-amber-700 border-amber-600/40", icon: Clock },
  queued: { label: "Queued", className: "text-blue-700 border-blue-600/40", icon: Loader2 },
  running: { label: "Running", className: "text-blue-700 border-blue-600/40", icon: Loader2 },
  succeeded: { label: "Succeeded", className: "text-emerald-700 border-emerald-600/40", icon: CheckCircle2 },
  failed: { label: "Failed", className: "text-red-700 border-red-600/40", icon: XCircle },
  canceled: { label: "Canceled", className: "text-muted-foreground border-border", icon: XCircle },
};

const CANCELABLE: RunStatus[] = ["scheduled", "queued"];
const RERUNNABLE = new Set<RunStatus>(["failed", "canceled"]);

export default function RunsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  // ContextPanel deep-links here with ?status=scheduled|running.
  const statusFilter = new URLSearchParams(search).get("status");

  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [titles, setTitles] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<number | null>(null);
  const [rerunning, setRerunning] = useState<Set<number>>(new Set());

  const onReRun = async (run: Run) => {
    setRerunning((s) => new Set(s).add(run.id));
    try {
      const nr = await reRunItem(run.workItemId);
      toast({ title: "Run started" });
      navigate(`/runs/${nr.id}`);
    } catch (err) {
      setRerunning((s) => {
        const n = new Set(s);
        n.delete(run.id);
        return n;
      });
      toast({
        title: "Could not start run",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const load = useCallback(
    async (silent = false) => {
      if (!Number.isFinite(projectId)) return;
      if (!silent) setLoading(true);
      try {
        const [p, r, items] = await Promise.all([
          fetchProject(projectId),
          fetchRuns({ projectId }),
          fetchProjectWorkItems(projectId),
        ]);
        setProject(p);
        setRuns(r);
        setTitles(new Map((items as WorkItem[]).map((it) => [it.id, it.title])));
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load runs.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Live-refresh while any run is still in progress.
  useEffect(() => {
    if (!runs) return;
    const active = runs.some((r) => r.status === "queued" || r.status === "running");
    if (!active) return;
    const t = setTimeout(() => load(true), 5000);
    return () => clearTimeout(t);
  }, [runs, load]);

  const onCancel = async (run: Run) => {
    setCancelingId(run.id);
    try {
      await cancelRun(run.id);
      toast({ title: "Run canceled" });
      await load(true);
    } catch (err) {
      toast({
        title: "Could not cancel",
        description: err instanceof ApiError ? err.message : "The run may already be running.",
        variant: "destructive",
      });
    } finally {
      setCancelingId(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 py-6">
        <Skeleton className="h-8 w-64" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">{error ?? "Project not found."}</p>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  const allRuns = runs ?? [];
  const list = statusFilter
    ? allRuns.filter((r) => {
        if (statusFilter === "running") return r.status === "running" || r.status === "queued";
        if (statusFilter === "scheduled") return r.status === "scheduled";
        return r.status === statusFilter;
      })
    : allRuns;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-5 py-6">
      <div className="flex items-center justify-between">
        <Link href={`/p/${projectId}/board`}>
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {project.name}
          </Button>
        </Link>
      </div>

      {statusFilter && (
        <div>
          <span
            style={{
              fontSize: "var(--fs-xs)",
              padding: "2px 8px",
              borderRadius: 3,
              background: "var(--c-blue-bg)",
              color: "var(--c-blue)",
              border: "1px solid var(--c-blue)",
              display: "inline-flex",
              gap: 5,
              alignItems: "center",
            }}
          >
            Showing: {statusFilter}
            <button
              onClick={() => navigate(`/p/${projectId}/runs`)}
              title="Clear filter"
              style={{ background: "none", border: "none", color: "var(--c-blue)", cursor: "pointer", display: "inline-flex", padding: 0 }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No runs yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Open a work item on the board and choose <span className="font-medium">Run</span> to start one.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((run) => {
            const meta = STATUS_META[run.status];
            const StatusIcon = meta.icon;
            const spinning = run.status === "queued" || run.status === "running";
            return (
              <div
                key={run.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/40 px-4 py-3 transition-colors hover:bg-card/70"
              >
                <button
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                  onClick={() => navigate(`/runs/${run.id}`)}
                >
                  <span className="truncate text-sm font-medium">
                    {titles.get(run.workItemId) ?? `Work item #${run.workItemId}`}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">#{run.id}</span>
                    <span>·</span>
                    <span>{run.trigger === "scheduled" ? "Scheduled" : "Manual"}</span>
                    {run.scheduledAt && run.status === "scheduled" && (
                      <>
                        <span>·</span>
                        <span>{new Date(run.scheduledAt).toLocaleString()}</span>
                      </>
                    )}
                    {run.finishedAt && (
                      <>
                        <span>·</span>
                        <span>{new Date(run.finishedAt).toLocaleString()}</span>
                      </>
                    )}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={meta.className}>
                    <StatusIcon className={`mr-1.5 h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} />
                    {meta.label}
                  </Badge>
                  {RERUNNABLE.has(run.status) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onReRun(run);
                      }}
                      disabled={rerunning.has(run.id)}
                      title="Re-run this item"
                      style={{
                        fontSize: "var(--fs-xs)",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 3,
                        background: "transparent",
                        color: "var(--c-blue)",
                        border: "1px solid var(--c-blue)",
                        cursor: rerunning.has(run.id) ? "default" : "pointer",
                        opacity: rerunning.has(run.id) ? 0.6 : 1,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {rerunning.has(run.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      Re-run
                    </button>
                  )}
                  {CANCELABLE.includes(run.status) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Cancel run"
                      disabled={cancelingId !== null}
                      onClick={() => onCancel(run)}
                    >
                      {cancelingId === run.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
