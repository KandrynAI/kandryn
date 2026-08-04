import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, X, Loader2, Clock, CheckCircle2, XCircle } from "lucide-react";
import {
  fetchRuns,
  fetchProject,
  fetchProjectWorkItems,
  cancelRun,
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

export default function RunsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [titles, setTitles] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<number | null>(null);

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

  const list = runs ?? [];

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
