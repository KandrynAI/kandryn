import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ExternalLink, GitCommit, Loader2, RotateCcw, ChevronDown, ChevronRight, FileText, GitPullRequest, ShieldCheck, Check, X, AlertCircle, AlertTriangle, ThumbsUp, Eye, Network } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { TestStage } from "@/components/tests/TestStage";
import { agentDisplay } from "@/lib/agents";
import {
  fetchRun,
  commitRunSuggestion,
  reRunItem,
  runReview,
  pushWorkItemToPlm,
  ApiError,
  type RunDetail,
  type RunStatus,
  type RunSuggestion,
  type ScoreBreakdown,
  type Run,
  type ReviewFinding,
} from "@/services/api";

/** Extract "123" from a PR URL (GitHub /pull/123 or ADO /pullrequest/123). */
function prNumber(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:pull|pullrequest)\/(\d+)/i);
  return m ? m[1] : null;
}
/** "owner/repo" from a GitHub PR URL, else "PR". */
function repoLabel(url: string | null): string {
  if (!url) return "PR";
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\//i);
  return m ? m[1] : "PR";
}

const DIMENSIONS: { key: keyof Pick<ScoreBreakdown, "correctness" | "readability" | "minimalDiff" | "conventions" | "acCoverage">; label: string }[] = [
  { key: "correctness", label: "Correctness" },
  { key: "readability", label: "Readability" },
  { key: "minimalDiff", label: "Minimal diff" },
  { key: "conventions", label: "Conventions" },
  { key: "acCoverage", label: "AC coverage" },
];

const VERDICT_STYLE: Record<string, { bg: string; fg: string }> = {
  strong: { bg: "var(--c-green-bg)", fg: "var(--c-green)" },
  adequate: { bg: "var(--c-amber-bg)", fg: "var(--c-amber)" },
  weak: { bg: "var(--c-red-bg)", fg: "var(--c-red)" },
};

const RERUNNABLE = new Set<RunStatus>(["failed", "canceled"]);

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
  const [, navigate] = useLocation();

  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [committingId, setCommittingId] = useState<number | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [reviewing, setReviewing] = useState(false);
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

  // Poll while the run is in progress, or while Veria is reviewing, so the
  // page updates live without a manual refresh.
  useEffect(() => {
    if (!data) return;
    const active = IN_PROGRESS.includes(data.run.status) || data.run.reviewStatus === "running";
    if (!active) return;
    timer.current = setTimeout(() => load(true), 4000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [data, load]);

  const onReRun = async () => {
    if (!data) return;
    setRerunning(true);
    try {
      const nr = await reRunItem(data.run.workItemId);
      toast({ title: "Run started" });
      navigate(`/runs/${nr.id}`);
    } catch (err) {
      setRerunning(false);
      toast({
        title: "Could not start run",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const onPromoteToPlm = async () => {
    if (!data) return;
    try {
      const linked = await pushWorkItemToPlm(data.run.workItemId);
      toast({
        title: "Pushed to PLM",
        description: linked.externalId ? `Created ${linked.externalId}. You can now push test cases.` : undefined,
      });
      await load(true);
    } catch (err) {
      toast({
        title: "Could not push item to PLM",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const onCommit = async (s: RunSuggestion) => {
    setCommittingId(s.id);
    try {
      const res = await commitRunSuggestion(runId, s.id);
      toast({ title: "Committed & PR opened", description: res.prUrl });
      await load(true);
    } catch (err) {
      // The API enforces one commit per run (409). If we raced it (e.g. a second
      // tab), just resync to the committed state instead of erroring.
      if (err instanceof ApiError && err.status === 409) {
        toast({ title: "Already committed — showing committed state." });
        await load(true);
      } else {
        toast({
          title: "Commit failed",
          description: err instanceof ApiError ? err.message : "Could not commit this suggestion.",
          variant: "destructive",
        });
      }
    } finally {
      setCommittingId(null);
    }
  };

  const onReview = async () => {
    setReviewing(true);
    try {
      const res = await runReview(runId);
      toast({ title: res.review ? "Veria review complete." : "Veria is running — check back in a moment." });
      await load(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast({ title: "Commit a suggestion before running Veria.", variant: "destructive" });
      } else if (err instanceof ApiError && err.status === 424) {
        toast({ title: "Add your Anthropic API key in Settings to run Veria.", variant: "destructive" });
      } else {
        toast({ title: "Veria could not complete. Try again.", variant: "destructive" });
      }
    } finally {
      setReviewing(false);
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
  // Test cases can only be pushed when the work item is linked to a Jira/ADO
  // story (has an externalId + a PLM source). Mirrors the server guard in
  // routes/tests.ts so the Push button is disabled instead of hitting a 422.
  const wi = data.workItem;
  const canPushToPlm = Boolean(wi?.externalId) && (wi?.source === "jira" || wi?.source === "azure-devops");
  // A committed run has no dedicated status here — it's signalled by
  // committedSuggestionId (the run stays "succeeded").
  const committedId = run.committedSuggestionId ?? null;
  const isCommitted = committedId !== null;
  const committedSug = suggestions.find((s) => s.id === committedId) ?? null;
  const ordered = [...suggestions].sort((a, b) => (a.id === committedId ? -1 : b.id === committedId ? 1 : 0));
  const alternatives = ordered.filter((s) => s.id !== committedId);
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
      <div style={{ padding: "10px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href={`/p/${run.projectId}/runs`} className="bm-ghost" style={{ border: "none", padding: "2px 0", color: "var(--c-ink-3)" }}>
          <ArrowLeft size={12} />Runs
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {run.usedGraphContext && (
            <span
              title="This run used the Graphify knowledge graph for precise, low-token file context."
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--fs-xs)",
                fontWeight: 600,
                color: "var(--c-blue)",
                background: "var(--c-blue-bg, rgba(25,195,154,0.10))",
                border: "1px solid var(--c-blue)",
                borderRadius: 999,
                padding: "2px 9px",
              }}
            >
              <Network size={12} />Graph context
            </span>
          )}
          {(run.status === "succeeded" || run.commitHash) && (
            <button className="bm-ghost" onClick={() => navigate(`/runs/${runId}/report`)} title="View report">
              <FileText size={14} />View report
            </button>
          )}
        </div>
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
        {RERUNNABLE.has(run.status) && (
          <button
            onClick={onReRun}
            disabled={rerunning}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--fs-base)",
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: 3,
              background: "var(--c-blue)",
              color: "#fff",
              border: "none",
              cursor: rerunning ? "default" : "pointer",
              opacity: rerunning ? 0.7 : 1,
              marginBottom: 16,
            }}
            title="Re-run this item"
          >
            {rerunning ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {rerunning ? "Starting…" : "Re-run this item"}
          </button>
        )}
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

        {isCommitted && run.prUrl && committedSug && (
          <div style={{ marginBottom: 14, border: "1px solid var(--c-green)", background: "var(--c-green-bg)", padding: "10px 14px", borderRadius: 4, display: "flex", alignItems: "center", gap: 10, animation: "bmrise 0.3s ease-out both" }}>
            <GitPullRequest size={14} style={{ color: "var(--c-green)", flexShrink: 0 }} />
            <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-green)" }}>
              PR opened — {agentDisplay(committedSug.agent).name} committed to task/{run.workItemId}
            </span>
            <a
              onClick={() => run.prUrl && window.open(run.prUrl, "_blank")}
              style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-green)", cursor: "pointer", textDecoration: "underline" }}
            >
              {repoLabel(run.prUrl)}{prNumber(run.prUrl) ? ` #${prNumber(run.prUrl)}` : ""} →
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
                      <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}>{agentDisplay(agent).name}</span>
                      <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>generating…</span>
                    </div>
                    <div style={{ height: 4, background: "var(--c-raised)", borderRadius: 2 }}>
                      <div style={{ height: 4, background: "var(--c-blue)", borderRadius: 2, animation: "bmbar 4s ease-out forwards" }} />
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", animation: "bmblink 1.4s infinite", marginTop: 4 }}>
                  Running Raptia and Fovea in parallel…
                </div>
              </>
            )}
          </div>
        ) : suggestions.length === 0 ? (
          <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-4)" }}>No suggestions were produced for this run.</p>
        ) : (
          <div>
            <ConfidenceStrip suggestions={suggestions} />

            {isCommitted ? (
              <>
                <SectionHeading>Committed suggestion</SectionHeading>
                {committedSug && (
                  <SuggestionCard
                    key={committedSug.id}
                    s={committedSug}
                    committing={false}
                    disabled
                    onCommit={() => onCommit(committedSug)}
                    isCommitted
                    isThisCommitted
                    prUrl={run.prUrl}
                    onReview={onReview}
                    reviewing={reviewing}
                  />
                )}
                {alternatives.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 12px" }}>
                    <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
                    <span style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)", fontWeight: 600 }}>
                      Alternative{alternatives.length === 1 ? "" : "s"}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
                  </div>
                )}
                {alternatives.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    s={s}
                    committing={false}
                    disabled
                    onCommit={() => onCommit(s)}
                    isCommitted
                    isThisCommitted={false}
                  />
                ))}
              </>
            ) : (
              <>
                <SectionHeading>Suggestions · {suggestions.length} result{suggestions.length === 1 ? "" : "s"}</SectionHeading>
                {ordered.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    s={s}
                    committing={committingId === s.id}
                    disabled={committingId !== null}
                    onCommit={() => onCommit(s)}
                    isCommitted={false}
                    isThisCommitted={false}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {isCommitted && run.reviewStatus && (
        <div style={{ padding: "0 20px 8px", maxWidth: 760 }}>
          <VeriaReview run={run} onReview={onReview} reviewing={reviewing} />
        </div>
      )}

      {run.status === "succeeded" && run.commitHash && (
        <div style={{ padding: "0 20px 24px", maxWidth: 760 }}>
          <TestStage
            workItemId={run.workItemId}
            canPushToPlm={canPushToPlm}
            onPushItemToPlm={onPromoteToPlm}
            initial={committedSug ? { testCases: committedSug.testCases ?? [], testScript: committedSug.testScript ?? null } : null}
          />
        </div>
      )}
    </div>
  );
}

const FINDING_ICON = {
  strength: ThumbsUp,
  gap: AlertCircle,
  risk: AlertTriangle,
} as const;
const FINDING_COLOR = {
  strength: "var(--c-green)",
  gap: "var(--c-amber)",
  risk: "var(--c-red)",
} as const;
const SEVERITY_STYLE: Record<string, { bg: string; fg: string }> = {
  high: { bg: "var(--c-red-bg)", fg: "var(--c-red)" },
  medium: { bg: "var(--c-amber-bg)", fg: "var(--c-amber)" },
  low: { bg: "var(--c-raised)", fg: "var(--c-ink-4)" },
};

function VeriaReview({ run, onReview, reviewing }: { run: Run; onReview: () => void; reviewing: boolean }) {
  if (run.reviewStatus === "running") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-amber)", animation: "bmblink 1.4s infinite" }} />
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>Veria reviewing committed code…</span>
      </div>
    );
  }

  if (run.reviewStatus === "failed") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
        <AlertCircle size={13} style={{ color: "var(--c-red)" }} />
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-red)" }}>Veria could not complete the review.</span>
        <button className="bm-ghost" style={{ marginLeft: "auto" }} onClick={onReview} disabled={reviewing}>
          {reviewing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}Retry
        </button>
      </div>
    );
  }

  const review = run.review;
  if (run.reviewStatus !== "done" || !review) return null;

  const { covered, missed, partial } = review.acCoverage;
  const noCoverage = covered.length === 0 && missed.length === 0 && partial.length === 0;

  return (
    <div style={{ animation: "bmrise 0.3s ease-out both" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--c-border)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", fontWeight: 700 }}>
          <ShieldCheck size={12} style={{ color: "var(--c-amber)" }} />Veria
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
          Reviewed {formatDistanceToNow(new Date(review.generatedAt), { addSuffix: true })}
        </span>
      </div>

      {/* Summary */}
      <p style={{ borderLeft: "3px solid var(--c-amber)", paddingLeft: 10, margin: "10px 0", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.6 }}>
        {review.summary}
      </p>

      {/* AC coverage */}
      <div style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)", fontWeight: 600, marginBottom: 8 }}>Acceptance criteria</div>
      {noCoverage ? (
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-green)" }}>All acceptance criteria addressed.</div>
      ) : (
        <>
          {covered.map((c, i) => <CoverageRow key={`c${i}`} icon={Check} color="var(--c-green)" text={c} />)}
          {partial.map((c, i) => <CoverageRow key={`p${i}`} icon={AlertCircle} color="var(--c-amber)" text={c} />)}
          {missed.map((c, i) => <CoverageRow key={`m${i}`} icon={X} color="var(--c-red)" text={c} />)}
        </>
      )}

      {/* Findings */}
      {review.findings.length > 0 && (
        <>
          <div style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)", fontWeight: 600, margin: "14px 0 6px" }}>Findings</div>
          {review.findings.map((f, i) => <FindingRow key={i} f={f} />)}
        </>
      )}

      {/* Reviewer note */}
      {review.reviewerNote && (
        <div style={{ marginTop: 12, background: "var(--c-amber-bg)", borderLeft: "3px solid var(--c-amber)", padding: "8px 12px", display: "flex", gap: 7, alignItems: "flex-start" }}>
          <Eye size={12} style={{ color: "var(--c-amber)", flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}>
            <span style={{ fontWeight: 600, color: "var(--c-ink)" }}>Focus: </span>{review.reviewerNote}
          </span>
        </div>
      )}
    </div>
  );
}

function CoverageRow({ icon: Icon, color, text }: { icon: typeof Check; color: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 6, padding: "4px 0", alignItems: "flex-start" }}>
      <Icon size={11} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-2)" }}>{text}</span>
    </div>
  );
}

function FindingRow({ f }: { f: ReviewFinding }) {
  const Icon = FINDING_ICON[f.type];
  const color = FINDING_COLOR[f.type];
  const sev = f.severity ? SEVERITY_STYLE[f.severity] : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "14px 56px 1fr", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--c-border)" }}>
      <Icon size={12} style={{ color, marginTop: 2 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", fontWeight: 700, color }}>{f.type}</span>
        {sev && f.type !== "strength" && (
          <span style={{ fontSize: "var(--fs-xs)", padding: "1px 4px", borderRadius: 2, background: sev.bg, color: sev.fg, alignSelf: "flex-start" }}>{f.severity}</span>
        )}
      </div>
      <div>
        <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-ink)", marginBottom: 2 }}>{f.title}</div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1.5 }}>{f.detail}</div>
        {f.acRef && <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", fontStyle: "italic", marginTop: 2 }}>{f.acRef}</div>}
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)", margin: "12px 0 8px" }}>
      {children}
    </div>
  );
}

function CommittedBadge() {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--c-green-bg)", color: "var(--c-green)", fontSize: "var(--fs-xs)", fontWeight: 700, padding: "4px 10px", borderRadius: 3 }}>
      <Check size={12} />Committed
    </span>
  );
}

function SuggestionCard({
  s,
  committing,
  disabled,
  onCommit,
  isCommitted,
  isThisCommitted,
  prUrl,
  onReview,
  reviewing,
}: {
  s: RunSuggestion;
  committing: boolean;
  disabled: boolean;
  onCommit: () => void;
  isCommitted: boolean;
  isThisCommitted: boolean;
  prUrl?: string | null;
  onReview?: () => void;
  reviewing?: boolean;
}) {
  const isAlternative = isCommitted && !isThisCommitted;
  const [altExpanded, setAltExpanded] = useState(false);
  const scorePct = s.score != null ? Math.max(0, Math.min(100, (s.score / 10) * 100)) : null;

  // Collapsed "alternative" row — the default for a non-committed suggestion
  // once another has been committed.
  if (isAlternative && !altExpanded) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--c-border)", background: "var(--c-surface)", borderRadius: 4, padding: "8px 12px", marginBottom: 10, opacity: 0.55 }}>
        <button onClick={() => setAltExpanded(true)} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--c-ink-3)", fontSize: "var(--fs-sm)", padding: 0 }} title="Show alternative">
          <ChevronRight size={12} />Show alternative
        </button>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: agentDisplay(s.agent).colour, fontWeight: 600 }}>{agentDisplay(s.agent).name}</span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>Alternative · not used</span>
        {s.score != null && <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>score {s.score}/10</span>}
      </div>
    );
  }

  return (
    <div style={{ border: isThisCommitted ? "1px solid var(--c-green)" : "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-surface)", marginBottom: 12, opacity: isAlternative ? 0.7 : 1, animation: "bmrise 0.3s ease-out both" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-base)", color: agentDisplay(s.agent).colour, fontWeight: 600 }}>{agentDisplay(s.agent).name}</span>
        {isThisCommitted ? (
          <CommittedBadge />
        ) : s.recommendation === "Recommended" ? (
          <span style={{ fontSize: "var(--fs-xs)", fontWeight: 700, background: "var(--c-blue)", color: "#fff", padding: "2px 6px", borderRadius: 2, letterSpacing: "0.05em" }}>Recommended</span>
        ) : null}
        {s.score != null && <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>score {s.score}/10</span>}
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{s.filePath}</span>
        {!isCommitted && (
          <button className="bm-primary" onClick={onCommit} disabled={disabled}>
            {committing ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}Commit
          </button>
        )}
        {isAlternative && (
          <button onClick={() => setAltExpanded(false)} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--c-ink-4)", fontSize: "var(--fs-xs)", padding: 0 }} title="Hide alternative">
            <ChevronDown size={12} />Hide alternative
          </button>
        )}
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

      {s.scoreBreakdown && <ScoreAnalysis breakdown={s.scoreBreakdown} />}

      {isThisCommitted && (
        <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--c-border)" }}>
          <button className="bm-ghost" onClick={() => prUrl && window.open(prUrl, "_blank")} disabled={!prUrl}>
            <ExternalLink size={12} />View PR →
          </button>
          {onReview && (
            <button className="bm-ghost" onClick={onReview} disabled={reviewing}>
              {reviewing ? <><Loader2 size={12} className="animate-spin" />Running Veria…</> : <><ShieldCheck size={12} />Run Veria</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreAnalysis({ breakdown }: { breakdown: ScoreBreakdown }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: "1px solid var(--c-border)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="bm-ghost"
        style={{ border: "none", margin: "8px 14px", padding: "2px 0", color: "var(--c-ink-3)" }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}Score analysis
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--c-border)", padding: "12px 16px" }}>
          {breakdown.overallNarrative && (
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.6, borderLeft: "3px solid var(--c-blue)", background: "var(--c-blue-bg)", padding: "10px 12px", marginBottom: 12 }}>
              {breakdown.overallNarrative}
            </p>
          )}

          {DIMENSIONS.map(({ key, label }, i) => {
            const d = breakdown[key];
            const vs = VERDICT_STYLE[d.verdict] ?? VERDICT_STYLE.adequate;
            return (
              <div key={key} style={{ display: "grid", gridTemplateColumns: "120px 1fr 48px 80px", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: i < DIMENSIONS.length - 1 ? "1px solid var(--c-border)" : "none" }}>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
                <span style={{ height: 4, background: "var(--c-raised)", display: "block", borderRadius: 2 }}>
                  <span className="score-fill" style={{ display: "block", height: 4, background: "var(--c-blue)", width: `${Math.max(0, Math.min(100, d.score))}%`, borderRadius: 2 }} />
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", fontWeight: 600 }}>{Math.round(d.score)}</span>
                <span style={{ justifySelf: "start", fontSize: "var(--fs-xs)", fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", borderRadius: 3, background: vs.bg, color: vs.fg }}>{d.verdict}</span>
              </div>
            );
          })}

          <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 10 }}>
            Weights: Correctness 35% · Readability 20% · Minimal diff 15% · Conventions 15% · AC coverage 15%
          </p>
        </div>
      )}
    </div>
  );
}

function ConfidenceStrip({ suggestions }: { suggestions: RunSuggestion[] }) {
  const recommended = suggestions.find((s) => s.recommendation === "Recommended") ?? suggestions[0];
  const b = recommended?.scoreBreakdown;
  if (!b) return null;
  const colour = b.confidence >= 80 ? "var(--c-green)" : b.confidence >= 60 ? "var(--c-amber)" : "var(--c-ink-3)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, background: "var(--c-surface)", border: "1px solid var(--c-border)", padding: "10px 16px" }}>
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Synthesis confidence</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xl)", fontWeight: 600, color: colour }}>{Math.round(b.confidence)}%</span>
      {b.confidenceReason && (
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", maxWidth: 300, textWrap: "pretty" }}>{b.confidenceReason}</span>
      )}
    </div>
  );
}
