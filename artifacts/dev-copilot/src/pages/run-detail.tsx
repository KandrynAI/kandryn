import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ExternalLink, GitCommit, Loader2 } from "lucide-react";
import { TestStage } from "@/components/tests/TestStage";
import {
  fetchRun,
  commitRunSuggestion,
  ApiError,
  type RunDetail,
  type RunStatus,
  type RunSuggestion,
} from "@/services/api";

const STATUS_LABEL: Record<RunStatus, string> = {
  scheduled: "scheduled",
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "canceled",
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
      toast({ title: "Committed & PR opened", description: res.prUrl });
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
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
        <div className="skeleton" style={{ height: 56 }} />
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p style={{ fontSize: "var(--fs-lg)", color: "var(--c-ink-3)" }}>{error ?? "Run not found."}</p>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  const { run, suggestions } = data;
  const inProgress = IN_PROGRESS.includes(run.status);
  const infoCells: [string, string][] = [
    ["Status", STATUS_LABEL[run.status]],
    ["Trigger", run.trigger === "scheduled" ? "Scheduled" : "Manual"],
    ["Auto-commit", run.autoCommit ? "On" : "Off"],
    ["When", run.scheduledAt ? new Date(run.scheduledAt).toLocaleString() : run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Back link */}
      <div style={{ padding: "10px 20px 0" }}>
        <Link href={`/p/${run.projectId}/runs`} className="bm-ghost" style={{ border: "none", padding: "2px 0", color: "var(--c-ink-3)" }}>
          <ArrowLeft size={12} />Runs
        </Link>
      </div>

      {/* Info strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: "1px solid var(--c-border)", borderBottom: "1px solid var(--c-border)", marginTop: 10 }}>
        {infoCells.map(([label, value], i) => (
          <div key={label} style={{ padding: "12px 20px", borderRight: i < 3 ? "1px solid var(--c-border)" : "none" }}>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: "var(--fs-base)", color: "var(--c-ink)", fontWeight: 500, marginTop: 3 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: 20, maxWidth: 760 }}>
        {run.refinePrompt && (
          <div style={{ marginBottom: 16, fontSize: "var(--fs-base)", color: "var(--c-ink-2)" }}>
            <span style={{ fontWeight: 600, color: "var(--c-ink)" }}>Refinement: </span>{run.refinePrompt}
          </div>
        )}

        {run.error && (
          <div style={{ marginBottom: 16, border: "1px solid var(--c-red)", background: "var(--c-red-bg)", color: "var(--c-red)", padding: "12px 14px", borderRadius: 4, fontSize: "var(--fs-base)" }}>
            {run.error}
          </div>
        )}

        {run.prUrl && (
          <div style={{ marginBottom: 16, border: "1px solid var(--c-blue)", background: "var(--c-blue-bg)", padding: "12px 14px", borderRadius: 4, animation: "bmrise 0.3s ease-out both" }}>
            <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-blue)" }}>Committed & pull request opened</div>
            <a href={run.prUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", marginTop: 4 }}>
              <ExternalLink size={12} />{run.prUrl}
            </a>
          </div>
        )}

        {inProgress ? (
          <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
            {run.status === "scheduled" ? (
              <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-3)" }}>This run is scheduled and hasn't started yet.</p>
            ) : (
              <>
                {["claude", "openai"].map((agent) => (
                  <div key={agent}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}>{agent}</span>
                      <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>generating…</span>
                    </div>
                    <div style={{ height: 4, background: "var(--c-raised)", borderRadius: 2 }}>
                      <div style={{ height: 4, background: "var(--c-blue)", borderRadius: 2, animation: "bmbar 4s ease-out forwards" }} />
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", animation: "bmblink 1.4s infinite", marginTop: 4 }}>
                  Agents are working — suggestions will appear here.
                </div>
              </>
            )}
          </div>
        ) : suggestions.length === 0 ? (
          <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-4)" }}>No suggestions were produced for this run.</p>
        ) : (
          <div>
            <div style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)", marginBottom: 8 }}>
              {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
            </div>
            {suggestions.map((s) => (
              <SuggestionCard key={s.id} s={s} committing={committingId === s.id} disabled={committingId !== null} onCommit={() => onCommit(s)} />
            ))}
          </div>
        )}
      </div>

      {run.status === "succeeded" && run.commitHash && (
        <div style={{ padding: "0 20px 24px", maxWidth: 760 }}>
          <TestStage workItemId={run.workItemId} canPushToPlm={true} />
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  s,
  committing,
  disabled,
  onCommit,
}: {
  s: RunSuggestion;
  committing: boolean;
  disabled: boolean;
  onCommit: () => void;
}) {
  const scorePct = s.score != null ? Math.max(0, Math.min(100, (s.score / 10) * 100)) : null;
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-surface)", marginBottom: 12, animation: "bmrise 0.3s ease-out both" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-base)", color: "var(--c-ink-2)", fontWeight: 500 }}>{s.agent}</span>
        {s.recommendation === "Recommended" && (
          <span style={{ fontSize: "var(--fs-xs)", fontWeight: 700, background: "var(--c-blue)", color: "#fff", padding: "2px 6px", borderRadius: 2, letterSpacing: "0.05em" }}>Recommended</span>
        )}
        {s.score != null && <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>score {s.score}/10</span>}
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{s.filePath}</span>
        <button className="bm-primary" onClick={onCommit} disabled={disabled}>
          {committing ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}Commit
        </button>
      </div>

      {scorePct != null && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--c-border)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 28px", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>Score</span>
            <span style={{ height: 3, background: "var(--c-raised)", display: "block" }}>
              <span style={{ display: "block", height: 3, background: "var(--c-blue)", width: `${scorePct}%` }} />
            </span>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", fontFamily: "var(--mono)", textAlign: "right" }}>{Math.round(scorePct)}%</span>
          </div>
        </div>
      )}

      {s.explanation && (
        <div style={{ padding: "10px 14px", fontSize: "var(--fs-base)", color: "var(--c-ink-2)", lineHeight: 1.55, borderBottom: "1px solid var(--c-border)" }}>
          {s.explanation}
        </div>
      )}

      <pre style={{ margin: 0, padding: "12px 14px", fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", lineHeight: 1.6, overflow: "auto", background: "var(--c-raised)", color: "var(--c-ink-2)" }}>
        <code>{s.code}</code>
      </pre>
    </div>
  );
}
