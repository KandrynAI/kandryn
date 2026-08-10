import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Clock, GitCommit, ExternalLink, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { fetchRuns, reRunItem, ApiError, type Run } from "@/services/api";

const RERUNNABLE = new Set(["failed", "canceled"]);

export default function HistoryPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [rerunning, setRerunning] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchRuns()
      .then((rs) =>
        setRuns([...rs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())),
      )
      .catch(() => setRuns([]));
  }, []);

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
    <div style={{ padding: "16px 20px" }}>
      <style>{`
        .hist-row:hover { background: var(--c-surface); }
        .hist-rerun {
          font-size: var(--fs-xs); font-weight: 600; padding: 2px 8px; border-radius: 3px;
          background: transparent; color: var(--c-blue); border: 1px solid var(--c-blue);
          cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
        }
        .hist-rerun:hover { background: var(--c-blue-bg); }
        .hist-rerun:disabled { opacity: 0.6; cursor: default; }
      `}</style>

      <h1 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--c-ink)" }}>History</h1>
      <p style={{ marginTop: 2, fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>Past runs and accepted suggestions</p>

      <div style={{ marginTop: 16 }}>
        {runs === null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, height: 360, border: "1px solid var(--c-border)", borderRadius: 6, color: "var(--c-ink-4)" }}>
            <Clock size={36} style={{ opacity: 0.2 }} />
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--c-ink)" }}>Nothing here yet</p>
              <p style={{ marginTop: 2, fontSize: "var(--fs-xs)" }}>Runs you start and the suggestions you commit will appear here.</p>
            </div>
          </div>
        ) : (
          <div style={{ borderTop: "1px solid var(--c-border)" }}>
            {runs.map((run) => {
              const committed = run.commitHash != null || run.committedSuggestionId != null;
              return (
                <div
                  key={run.id}
                  className="hist-row"
                  data-testid={`hist-run-${run.id}`}
                  onClick={() => navigate(`/runs/${run.id}`)}
                  role="button"
                  title={`Open run #${run.id}`}
                  style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: "1px solid var(--c-border)" }}
                >
                  <span className={`bm-badge bm-badge-${run.status}`}>{run.status}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>#{run.id}</span>
                  <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>{run.trigger}</span>
                  {committed && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-xs)", color: "var(--c-ink-3)" }}>
                      <GitCommit size={12} />
                      {run.prUrl ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (run.prUrl) window.open(run.prUrl, "_blank");
                          }}
                          style={{ background: "none", border: "none", padding: 0, color: "var(--c-blue)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--fs-xs)" }}
                          title="Open PR"
                        >
                          PR <ExternalLink size={10} />
                        </button>
                      ) : (
                        "committed"
                      )}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", fontFamily: "var(--mono)" }}>
                    {run.createdAt ? formatDistanceToNow(new Date(run.createdAt), { addSuffix: true }) : ""}
                  </span>
                  {RERUNNABLE.has(run.status) && (
                    <button className="hist-rerun" onClick={(e) => reRun(run, e)} disabled={rerunning.has(run.id)} title="Re-run this item">
                      {rerunning.has(run.id) ? <Loader2 size={12} className="animate-spin" /> : "Re-run"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
