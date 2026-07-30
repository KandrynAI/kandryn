import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ExternalLink,
  GitCommit,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { TestStage } from "@/components/tests/TestStage";
import {
  fetchRun,
  commitRunSuggestion,
  ApiError,
  type RunDetail,
  type RunStatus,
  type RunSuggestion,
} from "@/services/api";

const STATUS_META: Record<RunStatus, { label: string; className: string; icon: typeof Clock }> = {
  scheduled: { label: "Scheduled", className: "text-amber-700 border-amber-600/40", icon: Clock },
  queued: { label: "Queued", className: "text-blue-700 border-blue-600/40", icon: Loader2 },
  running: { label: "Running", className: "text-blue-700 border-blue-600/40", icon: Loader2 },
  succeeded: { label: "Succeeded", className: "text-emerald-700 border-emerald-600/40", icon: CheckCircle2 },
  failed: { label: "Failed", className: "text-red-700 border-red-600/40", icon: XCircle },
  canceled: { label: "Canceled", className: "text-muted-foreground border-border", icon: XCircle },
};

const IN_PROGRESS: RunStatus[] = ["scheduled", "queued", "running"];

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = Number(params.runId);
  const { toast } = useToast();

  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [committingId, setCommittingId] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!Number.isFinite(runId)) return;
      if (!silent) setLoading(true);
      try {
        const d = await fetchRun(runId);
        setData(d);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the run.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [runId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the run is still in progress so scheduled/queued runs update live.
  useEffect(() => {
    if (!data) return;
    if (!IN_PROGRESS.includes(data.run.status)) return;
    timer.current = setTimeout(() => load(true), 4000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [data, load]);

  const onCommit = async (s: RunSuggestion) => {
    setCommittingId(s.id);
    try {
      const res = await commitRunSuggestion(runId, s.id);
      toast({
        title: "Committed & PR opened",
        description: res.prUrl,
      });
      await load(true);
    } catch (err) {
      toast({
        title: "Commit failed",
        description: err instanceof ApiError ? err.message : "Could not commit this suggestion.",
        variant: "destructive",
      });
    } finally {
      setCommittingId(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">{error ?? "Run not found."}</p>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  const { run, suggestions } = data;
  const meta = STATUS_META[run.status];
  const StatusIcon = meta.icon;
  const inProgress = IN_PROGRESS.includes(run.status);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-5 py-6">
      <div className="flex items-center justify-between">
        <Link href={`/p/${run.projectId}/runs`}>
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Runs
          </Button>
        </Link>
        <Badge variant="outline" className={meta.className}>
          <StatusIcon className={`mr-1.5 h-3.5 w-3.5 ${inProgress && run.status !== "scheduled" ? "animate-spin" : ""}`} />
          {meta.label}
        </Badge>
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">Run #{run.id}</span>
          <span>·</span>
          <span>{run.trigger === "scheduled" ? "Scheduled" : "Manual"}</span>
          {run.autoCommit && (
            <>
              <span>·</span>
              <span>auto-commit</span>
            </>
          )}
          {run.scheduledAt && (
            <>
              <span>·</span>
              <span>for {new Date(run.scheduledAt).toLocaleString()}</span>
            </>
          )}
        </div>
        {run.refinePrompt && (
          <p className="mt-3 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Refinement: </span>
            {run.refinePrompt}
          </p>
        )}
        {run.error && (
          <p className="mt-3 rounded-md border border-red-600/30 bg-red-50 p-3 text-sm text-red-700">
            {run.error}
          </p>
        )}
        {run.prUrl && (
          <a
            href={run.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-700 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View pull request
          </a>
        )}
      </div>

      {inProgress ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {run.status === "scheduled"
              ? "This run is scheduled and hasn't started yet."
              : "Agents are working — suggestions will appear here."}
          </p>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">No suggestions were produced for this run.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
          </h2>
          {suggestions.map((s) => (
            <div key={s.id} className="overflow-hidden rounded-lg border border-border bg-card/40">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{s.agent}</span>
                  {s.recommendation === "Recommended" && (
                    <Badge variant="outline" className="border-emerald-600/40 text-emerald-700">
                      Recommended
                    </Badge>
                  )}
                  {s.score != null && (
                    <span className="text-xs text-muted-foreground">{s.score}/10</span>
                  )}
                </div>
                <Button size="sm" onClick={() => onCommit(s)} disabled={committingId !== null}>
                  {committingId === s.id ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitCommit className="mr-2 h-3.5 w-3.5" />
                  )}
                  Commit
                </Button>
              </div>
              <div className="px-4 py-3">
                <p className="font-mono text-xs text-muted-foreground">{s.filePath}</p>
                {s.explanation && <p className="mt-2 text-sm">{s.explanation}</p>}
                <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-background p-3 text-xs">
                  <code>{s.code}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}

      {run.status === "succeeded" && run.commitHash && (
        <TestStage workItemId={run.workItemId} canPushToPlm={true} />
      )}
    </div>
  );
}
