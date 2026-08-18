import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ExternalLink, Loader2, RotateCcw, ChevronDown, ChevronRight, FileText, FileCheck, Copy, GitPullRequest, ShieldCheck, ShieldAlert, ShieldX, Check, X, AlertCircle, AlertTriangle, ThumbsUp, Eye, Network, Upload, Zap } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDistanceToNow } from "date-fns";
import { TestStage } from "@/components/tests/TestStage";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { agentDisplay } from "@/lib/agents";
import { useTeam } from "@/context/TeamContext";

type AegisIssueType = "bug" | "subtask";
type AegisIssueTypePref = AegisIssueType | "smart";

/** Client mirror of the server's issue-type resolution (preference + severity). */
function resolveAegisIssueType(pref: AegisIssueTypePref, severity: string): AegisIssueType {
  if (pref === "bug") return "bug";
  if (pref === "subtask") return "subtask";
  return severity === "critical" || severity === "high" ? "bug" : "subtask";
}
import {
  fetchRun,
  commitRunSuggestion,
  reRunItem,
  runReview,
  runAegisScan,
  runNarratia,
  remediateAegisFinding,
  pushWorkItemToPlm,
  fetchTeamIntegrations,
  ApiError,
  type RunDetail,
  type RunStatus,
  type RunSuggestion,
  type ScoreBreakdown,
  type Run,
  type ReviewFinding,
  type AegisFinding,
  type RunbookTarget,
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
  const [staleError, setStaleError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [aegisLoading, setAegisLoading] = useState(false);
  const [narratiaLoading, setNarratiaLoading] = useState(false);
  const [runbookTarget, setRunbookTarget] = useState<RunbookTarget>("markdown");
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
    const active =
      IN_PROGRESS.includes(data.run.status) ||
      data.run.reviewStatus === "running" ||
      data.run.securityScanStatus === "running" ||
      data.run.runbookStatus === "running";
    if (!active) return;
    timer.current = setTimeout(() => load(true), 4000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [data, load]);

  // In-app completion notification: when a run we're watching (e.g. a background
  // remediation run started while this page is open) transitions out of an
  // in-progress state, toast the outcome.
  const prevStatus = useRef<RunStatus | null>(null);
  useEffect(() => {
    if (!data) return;
    const s = data.run.status;
    const was = prevStatus.current;
    if (was && IN_PROGRESS.includes(was) && !IN_PROGRESS.includes(s)) {
      if (s === "succeeded") {
        toast({ title: `Run #${data.run.id} complete`, description: "The run finished successfully." });
      } else if (s === "failed") {
        toast({ title: `Run #${data.run.id} failed`, description: data.run.error ?? undefined, variant: "destructive" });
      } else if (s === "canceled") {
        toast({ title: `Run #${data.run.id} canceled` });
      }
    }
    prevStatus.current = s;
  }, [data, toast]);

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
    setStaleError(null);
    try {
      const res = await commitRunSuggestion(runId, s.id);
      toast({ title: "Committed & PR opened", description: res.prUrl });
      await load(true);
    } catch (err) {
      // The commit path returns 409 for three cases: the branch moved since the
      // run (1.5), the suggestion couldn't be applied, or another commit already
      // landed. Staleness gets its own banner; the rest resync to committed state.
      if (err instanceof ApiError && err.status === 409 && err.message.startsWith("The branch changed")) {
        setStaleError(err.message);
        toast({ title: "Branch changed — re-run to regenerate.", variant: "destructive" });
      } else if (err instanceof ApiError && err.status === 409) {
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

  const onAegis = async () => {
    setAegisLoading(true);
    try {
      await runAegisScan(runId);
      toast({ title: "Aegis scan complete." });
      await load(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 202) {
        toast({ title: "Aegis is already scanning." });
      } else if (err instanceof ApiError && err.status === 409) {
        toast({ title: "Commit a suggestion before running Aegis.", variant: "destructive" });
      } else if (err instanceof ApiError && err.status === 424) {
        toast({ title: "Add your Anthropic API key in Settings to run Aegis.", variant: "destructive" });
      } else {
        toast({ title: "Aegis scan failed. Try again.", variant: "destructive" });
      }
    } finally {
      setAegisLoading(false);
    }
  };

  const onNarratia = async (target: RunbookTarget) => {
    setNarratiaLoading(true);
    try {
      await runNarratia(runId, target);
      toast({ title: "Runbook generated." });
      await load(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 202) {
        toast({ title: "Narratia is already generating." });
      } else if (err instanceof ApiError && err.status === 409) {
        toast({ title: "Commit a suggestion before running Narratia.", variant: "destructive" });
      } else if (err instanceof ApiError && err.status === 424) {
        toast({ title: "Add your Anthropic API key in Settings to run Narratia.", variant: "destructive" });
      } else {
        toast({ title: "Generation failed. Try again.", variant: "destructive" });
      }
    } finally {
      setNarratiaLoading(false);
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
  const inProgress = IN_PROGRESS.includes(run.status);
  const infoCells: [string, string][] = [
    ["Status", STATUS_LABEL[run.status]],
    ["Trigger", run.trigger === "scheduled" ? "Scheduled" : "Manual"],
    ["Auto-commit", run.autoCommit ? "On" : "Off"],
    ["When", run.scheduledAt ? new Date(run.scheduledAt).toLocaleString() : run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"],
    ["Stack", run.stackDesc || "Not detected"],
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", borderTop: "1px solid var(--c-border)", borderBottom: "1px solid var(--c-border)", marginTop: 10 }}>
        {infoCells.map(([label, value], i) => (
          <div key={label} style={{ padding: "12px 20px", borderRight: i < infoCells.length - 1 ? "1px solid var(--c-border)" : "none" }}>
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
              <div style={{ border: "1px solid var(--c-border)", borderRadius: 6, background: "var(--c-surface)", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-ink)" }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: "var(--c-blue)" }} />
                  {run.triggerContext === "remediation" ? "Remediation queued" : "Run scheduled"}
                </div>
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 6, lineHeight: 1.5 }}>
                  {run.triggerContext === "remediation"
                    ? "This fix runs automatically in the background and starts within a few minutes. This page updates live — you'll be notified here the moment it completes. You can also track it in the left panel under Runs → Running / Completed."
                    : "This run is scheduled and hasn't started yet. It will start automatically at its scheduled time."}
                </p>
              </div>
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
            <DiffViewer
              suggestions={ordered}
              committedId={committedId}
              committingId={committingId}
              staleMessage={staleError}
              onCommit={onCommit}
              onReRun={onReRun}
              rerunning={rerunning}
              prUrl={run.prUrl}
              onReview={onReview}
              reviewing={reviewing}
              renderScoreAnalysis={(s) => (s.scoreBreakdown ? <ScoreAnalysis breakdown={s.scoreBreakdown} /> : null)}
            />
          </div>
        )}
      </div>

      {isCommitted && run.reviewStatus && (
        <div style={{ padding: "0 20px 8px", maxWidth: 760 }}>
          <VeriaReview run={run} onReview={onReview} reviewing={reviewing} />
        </div>
      )}

      {isCommitted && (
        <div style={{ padding: "0 20px 8px", maxWidth: 760 }}>
          <AegisSection run={run} runId={runId} onScan={onAegis} scanning={aegisLoading} navigate={navigate} onChanged={() => load(true)} />
        </div>
      )}

      {isCommitted && (
        <div style={{ padding: "0 20px 8px", maxWidth: 760 }}>
          <NarratiaSection run={run} onGenerate={onNarratia} loading={narratiaLoading} target={runbookTarget} setTarget={setRunbookTarget} />
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

// Minimal Markdown → HTML for the runbook preview (no external library).
// Handles ## / ### headings, **bold**, `inline code`, ```code blocks```, and
// -/1. list items. Escapes HTML in text and code.
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks: string[] = [];
  const src = md.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push(`<pre><code>${esc(code)}</code></pre>`);
    return ` BLOCK${blocks.length - 1} `;
  });
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of src.split("\n")) {
    const bm = raw.match(/^ BLOCK(\d+) $/);
    if (bm) { closeList(); out.push(blocks[Number(bm[1])]); continue; }
    const inline = esc(raw.trimEnd())
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    if (/^## /.test(raw)) { closeList(); out.push(`<h2>${inline.replace(/^## /, "")}</h2>`); }
    else if (/^### /.test(raw)) { closeList(); out.push(`<h3>${inline.replace(/^### /, "")}</h3>`); }
    else if (/^\s*[-*] /.test(raw)) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline.replace(/^\s*[-*] /, "")}</li>`); }
    else if (/^\s*\d+\. /.test(raw)) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline.replace(/^\s*\d+\.\s/, "")}</li>`); }
    else if (raw.trim() === "") { closeList(); }
    else { closeList(); out.push(`<p>${inline}</p>`); }
  }
  closeList();
  return out.join("\n");
}

function NarratiaSection({
  run,
  onGenerate,
  loading,
  target,
  setTarget,
}: {
  run: Run;
  onGenerate: (t: RunbookTarget) => void;
  loading: boolean;
  target: RunbookTarget;
  setTarget: (t: RunbookTarget) => void;
}) {
  const [showRunbook, setShowRunbook] = useState(false);
  const { toast } = useToast();
  const status = run.runbookStatus;

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <FileText size={16} style={{ color: "#0F6E56" }} />
      <span style={{ fontSize: "var(--fs-lg)", fontWeight: 600 }}>Narratia · Runbook</span>
    </div>
  );

  const card = (children: React.ReactNode) => (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-bg)", padding: "10px 14px" }}>
      <style>{`
        .nar-md h2 { font-size: 14px; font-weight: 600; margin-top: 16px; border-bottom: 1px solid var(--c-border); padding-bottom: 3px; }
        .nar-md h3 { font-size: 13px; font-weight: 600; margin-top: 12px; }
        .nar-md p { font-size: 13px; line-height: 1.55; color: var(--c-ink-2); margin: 6px 0; }
        .nar-md li { font-size: 13px; line-height: 1.55; color: var(--c-ink-2); margin-left: 16px; }
        .nar-md pre { background: var(--c-raised); padding: 8px; border-radius: 3px; overflow-x: auto; }
        .nar-md code { font-family: var(--mono); font-size: 11px; }
      `}</style>
      {header}
      {children}
    </div>
  );

  if (status === "running") {
    return card(
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0F6E56", animation: "bmblink 1.4s infinite" }} />
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>Narratia generating runbook…</span>
      </span>,
    );
  }

  if (status === "failed") {
    return card(
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-red)" }}>Narratia could not generate the runbook.</span>
        <button className="bm-ghost" onClick={() => onGenerate(target)} disabled={loading}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}Retry
        </button>
      </span>,
    );
  }

  if (status === "done" && run.runbook) {
    const doneTarget = run.runbookTarget ?? target;
    return card(
      <>
        <div style={{ background: "var(--c-blue-bg)", border: "1px solid var(--c-blue)", padding: "10px 14px", borderRadius: 4, marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <FileCheck size={14} style={{ color: "var(--c-blue)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-blue)" }}>Runbook generated</span>
          {run.runbookUrl && (
            <button onClick={() => run.runbookUrl && window.open(run.runbookUrl, "_blank")} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--c-blue)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              View in {doneTarget} <ExternalLink size={11} />
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <button className="bm-ghost" onClick={() => setShowRunbook((s) => !s)}>
            {showRunbook ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{showRunbook ? "Hide runbook" : "Show runbook"}
          </button>
          <button
            className="bm-ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(run.runbook ?? "");
                toast({ title: "Runbook copied" });
              } catch {
                toast({ title: "Copy failed", variant: "destructive" });
              }
            }}
          >
            <Copy size={12} />Copy runbook
          </button>
          <button className="bm-ghost" onClick={() => onGenerate(doneTarget as RunbookTarget)} disabled={loading}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}Regenerate
          </button>
        </div>

        {showRunbook && (
          <div className="nar-md" style={{ borderTop: "1px solid var(--c-border)", paddingTop: 8 }} dangerouslySetInnerHTML={{ __html: mdToHtml(run.runbook) }} />
        )}
      </>,
    );
  }

  // Idle — target selector + generate.
  const TARGETS: { key: RunbookTarget; label: string }[] = [
    { key: "markdown", label: "Markdown (PR)" },
    { key: "confluence", label: "Confluence" },
    { key: "notion", label: "Notion" },
  ];
  return card(
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {TARGETS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTarget(t.key)}
            style={{
              fontSize: "var(--fs-sm)",
              fontWeight: 500,
              padding: "3px 10px",
              borderRadius: 3,
              cursor: "pointer",
              border: `1px solid ${target === t.key ? "var(--c-blue)" : "var(--c-border)"}`,
              background: target === t.key ? "var(--c-blue)" : "transparent",
              color: target === t.key ? "#fff" : "var(--c-ink-3)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button className="bm-primary" onClick={() => onGenerate(target)} disabled={loading}>
        {loading ? <><Loader2 size={12} className="animate-spin" />Narratia generating…</> : <><FileText size={12} />Generate runbook</>}
      </button>
    </div>,
  );
}

const SEV_BADGE: Record<string, { bg: string; fg: string }> = {
  critical: { bg: "#7f1d1d", fg: "#fee2e2" },
  high: { bg: "#f87171", fg: "#7f1d1d" },
  medium: { bg: "#fbbf24", fg: "#78350f" },
  low: { bg: "#d4d4d4", fg: "#171717" },
  info: { bg: "#e5e5e5", fg: "#404040" },
};

type FindingLocalState = { pushed?: boolean; runId?: number; status?: string };

function AegisFindingRow({
  f, last, selectable, selected, onToggle, remediating, state, defaultIssueType, onPush, onRemediate, navigate,
}: {
  f: AegisFinding;
  last: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: (v: boolean) => void;
  remediating: boolean;
  state?: FindingLocalState;
  defaultIssueType: AegisIssueType;
  onPush: (issueType: AegisIssueType) => void;
  onRemediate: () => void;
  navigate: (to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showPushPicker, setShowPushPicker] = useState(false);
  const [pushIssueType, setPushIssueType] = useState<AegisIssueType>(defaultIssueType);
  const sev = SEV_BADGE[f.severity] ?? SEV_BADGE.info;
  const isInfo = f.severity === "info";
  const pushed = Boolean(state?.pushed || f.pushedToBoard || f.plmTicketKey);
  const runId = state?.runId ?? f.remediationRunId;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "20px 60px 48px 1fr 150px", gap: 10, padding: "10px 0", borderBottom: last ? "none" : "1px solid var(--c-border)" }}>
      <span style={{ alignSelf: "start", paddingTop: 2 }}>
        {!isInfo && <Checkbox checked={selected} onCheckedChange={(v) => onToggle(v === true)} disabled={!selectable} />}
      </span>
      <span style={{ alignSelf: "start", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 3, background: sev.bg, color: sev.fg, textAlign: "center" }}>{f.severity}</span>
      <span style={{ alignSelf: "start", fontFamily: "var(--mono)", fontSize: 12, color: "var(--c-ink-4)" }}>{(f.owasp || "").split(":")[0] || "—"}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ink)" }}>{f.title}</div>
        <div style={{ fontSize: 12, color: "var(--c-ink-3)", lineHeight: 1.5, marginTop: 3 }}>{f.detail}</div>
        {f.lineRef && (
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--c-ink-4)", marginTop: 4 }}>📍 {f.lineRef}</div>
        )}
        <button className="bm-ghost" onClick={() => setOpen((o) => !o)} style={{ border: "none", padding: "4px 0", color: "var(--c-ink-3)", fontSize: 12 }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}Remediation
        </button>
        {open && (
          <div style={{ fontSize: 12, color: "var(--c-ink-2)", lineHeight: 1.5, borderLeft: "2px solid var(--c-blue)", paddingLeft: 8, marginTop: 2 }}>{f.remediation || "—"}</div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          {pushed && f.plmTicketKey && (
            <button onClick={() => f.plmTicketUrl && window.open(f.plmTicketUrl, "_blank")} style={{ fontSize: "var(--fs-xs)", background: "var(--c-green-bg)", color: "var(--c-green)", border: "1px solid var(--c-green)", padding: "2px 8px", borderRadius: 3, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>
              ✓ {f.plmTicketKey} <ExternalLink size={10} />
            </button>
          )}
          {runId && (
            <button onClick={() => navigate(`/runs/${runId}`)} style={{ fontSize: "var(--fs-xs)", background: "var(--c-blue-bg)", color: "var(--c-blue)", border: "1px solid var(--c-blue)", padding: "2px 8px", borderRadius: 3, cursor: "pointer" }}>
              ▶ Run #{runId}
            </button>
          )}
        </div>
      </div>
      {!isInfo && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {pushed ? (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-green)", textAlign: "center" }}>Pushed ✓</span>
          ) : showPushPicker ? (
            <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-surface)", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, color: "var(--c-ink-3)", fontWeight: 600 }}>Create as:</div>
              {(["bug", "subtask"] as const).map((t) => (
                <label key={t} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--c-ink)", cursor: "pointer" }}>
                  <input type="radio" name={`push-${f.id}`} checked={pushIssueType === t} onChange={() => setPushIssueType(t)} />
                  {t === "bug" ? "Bug" : "Sub-task"}
                </label>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button
                  onClick={() => { setShowPushPicker(false); onPush(pushIssueType); }}
                  disabled={remediating}
                  style={{ background: "var(--c-blue)", color: "#fff", border: "none", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 3, cursor: "pointer" }}
                >
                  Push
                </button>
                <button onClick={() => setShowPushPicker(false)} style={{ background: "none", border: "1px solid var(--c-border)", fontSize: 11, padding: "3px 10px", borderRadius: 3, cursor: "pointer", color: "var(--c-ink-3)" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="bm-ghost" onClick={() => { setPushIssueType(defaultIssueType); setShowPushPicker(true); }} disabled={remediating} style={{ justifyContent: "center" }}>
              {remediating ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}{remediating ? "Pushing…" : "Push to PLM"}
            </button>
          )}
          {runId ? (
            <button className="bm-ghost" onClick={() => navigate(`/runs/${runId}`)} style={{ justifyContent: "center" }}>View fix →</button>
          ) : (
            <button
              onClick={onRemediate}
              disabled={remediating}
              style={{ background: "var(--c-blue)", color: "#fff", border: "none", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 3, cursor: remediating ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, opacity: remediating ? 0.7 : 1 }}
            >
              {remediating ? <><Loader2 size={11} className="animate-spin" />Starting…</> : <><Zap size={11} />Remediate Now</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AegisSection({ run, runId, onScan, scanning, navigate, onChanged }: {
  run: Run;
  runId: number;
  onScan: () => void;
  scanning: boolean;
  navigate: (to: string) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { team } = useTeam();
  const [issueTypePref, setIssueTypePref] = useState<AegisIssueTypePref>("smart");
  useEffect(() => {
    if (!team) return;
    fetchTeamIntegrations(team.id)
      .then((rows) => {
        const v = rows.find((r) => r.key === "AEGIS_JIRA_ISSUE_TYPE")?.value;
        if (v === "bug" || v === "subtask" || v === "smart") setIssueTypePref(v);
      })
      .catch(() => {});
  }, [team]);
  const status = run.securityScanStatus;
  const scan = run.securityScan;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remediatingId, setRemediatingId] = useState<string | null>(null);
  const [bulkPushing, setBulkPushing] = useState(false);
  const [findingStates, setFindingStates] = useState<Record<string, FindingLocalState>>({});

  const findings = scan?.findings ?? [];
  const selectableIds = findings
    .filter((f) => f.severity !== "info" && !(f.pushedToBoard || f.plmTicketKey || findingStates[f.id]?.pushed))
    .map((f) => f.id);
  const allSelected = selectableIds.length > 0 && selected.size === selectableIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggle = (id: string, v: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  const remediate = async (id: string, action: "push" | "remediate-now", issueType?: AegisIssueType) => {
    setRemediatingId(id);
    try {
      const res = await remediateAegisFinding(runId, id, action, issueType);
      setFindingStates((prev) => ({
        ...prev,
        [id]: { pushed: true, runId: res.newRunId ?? prev[id]?.runId, status: action === "remediate-now" ? "running" : undefined },
      }));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      if (action === "remediate-now" && res.newRunId) {
        toast({ title: `${res.ticketKey} created`, description: `Remediation run #${res.newRunId} queued — starts in a few minutes. Opening…` });
        setTimeout(() => navigate(`/runs/${res.newRunId}`), 1200);
      } else {
        toast({ title: `${res.ticketKey} created`, description: "Appearing on the board." });
        onChanged();
      }
    } catch (err) {
      toast({ title: "Remediation failed", description: err instanceof ApiError ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setRemediatingId(null);
    }
  };

  const onRemediateNow = (f: AegisFinding) => {
    if (window.confirm(`This will create a tracker ticket for "${f.title}" and immediately start a new run to fix it.\n\nContinue?`)) {
      // Remediate Now is always a standalone Bug — a sub-task would not make sense.
      void remediate(f.id, "remediate-now", "bug");
    }
  };

  const pushSelected = async () => {
    const ids = [...selected];
    setBulkPushing(true);
    for (const id of ids) {
      try {
        const finding = findings.find((f) => f.id === id);
        const issueType = finding ? resolveAegisIssueType(issueTypePref, finding.severity) : undefined;
        await remediateAegisFinding(runId, id, "push", issueType);
        setFindingStates((prev) => ({ ...prev, [id]: { ...prev[id], pushed: true } }));
      } catch {
        /* continue with the rest */
      }
    }
    setSelected(new Set());
    setBulkPushing(false);
    toast({ title: `Pushed ${ids.length} finding${ids.length === 1 ? "" : "s"} to the tracker` });
    onChanged();
  };

  const header = (right?: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: status === "done" && scan ? 12 : 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldAlert size={16} style={{ color: "var(--c-red)" }} />
        <span style={{ fontSize: "var(--fs-lg)", fontWeight: 600 }}>Aegis · Security</span>
      </div>
      {right}
    </div>
  );

  // Idle — offer the scan.
  if (!status) {
    return (
      <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-bg)", padding: "10px 14px" }}>
        {header(
          <button className="bm-ghost" onClick={onScan} disabled={scanning}>
            {scanning ? <><Loader2 size={12} className="animate-spin" />Scanning…</> : <><ShieldAlert size={14} />Run Aegis security scan</>}
          </button>,
        )}
      </div>
    );
  }

  if (status === "running") {
    return (
      <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-bg)", padding: "10px 14px" }}>
        {header(
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-amber)", animation: "bmblink 1.4s infinite" }} />
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>Aegis scanning for vulnerabilities…</span>
          </span>,
        )}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-bg)", padding: "10px 14px" }}>
        {header(
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-red)" }}>Aegis scan failed.</span>
            <button className="bm-ghost" onClick={onScan} disabled={scanning}>
              {scanning ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}Retry
            </button>
          </span>,
        )}
      </div>
    );
  }

  if (status !== "done" || !scan) return null;

  const blocked = scan.gateDecision === "blocked";
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-bg)", padding: "10px 14px" }}>
      {header()}

      {blocked ? (
        <div style={{ background: "var(--c-red-bg)", border: "2px solid var(--c-red)", padding: "12px 16px", borderRadius: 4, marginBottom: 14, animation: "bmrise 0.3s ease-out both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldX size={16} style={{ color: "var(--c-red)" }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--c-red)" }}>Security gate blocked</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--c-red)", marginTop: 4 }}>{scan.gateReason}</div>
          <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--c-red)", marginTop: 6 }}>
            {scan.criticalCount} critical · {scan.highCount} high · resolve to unblock PR
          </div>
        </div>
      ) : (
        <div style={{ background: "var(--c-green-bg)", border: "1px solid var(--c-green)", padding: "10px 14px", borderRadius: 4, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={14} style={{ color: "var(--c-green)" }} />
          <span style={{ fontSize: 13, color: "var(--c-green)" }}>Security gate approved · {scan.findings.length} finding(s)</span>
        </div>
      )}

      {findings.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingBottom: 10, borderBottom: "1px solid var(--c-border)", marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: selectableIds.length ? "pointer" : "default" }}>
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                disabled={selectableIds.length === 0}
              />
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Aegis findings · {findings.length} finding{findings.length === 1 ? "" : "s"}
              </span>
            </label>
            {selected.size > 0 && (
              <button className="bm-ghost" onClick={pushSelected} disabled={bulkPushing}>
                {bulkPushing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {bulkPushing ? "Pushing…" : `Push ${selected.size} selected`}
              </button>
            )}
          </div>
          {findings.map((f, i) => (
            <AegisFindingRow
              key={f.id}
              f={f}
              last={i === findings.length - 1}
              selectable={selectableIds.includes(f.id)}
              selected={selected.has(f.id)}
              onToggle={(v) => toggle(f.id, v)}
              remediating={remediatingId === f.id || bulkPushing}
              state={findingStates[f.id]}
              defaultIssueType={resolveAegisIssueType(issueTypePref, f.severity)}
              onPush={(issueType) => remediate(f.id, "push", issueType)}
              onRemediate={() => onRemediateNow(f)}
              navigate={navigate}
            />
          ))}
        </>
      )}
    </div>
  );
}

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

          {(breakdown.ambiguityHandling || breakdown.surgicalPrecision) && (
            <div style={{ borderTop: "1px dashed var(--c-border)", marginTop: 10, paddingTop: 10 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)", marginBottom: 8 }}>Behaviour signals</div>
              {([
                ["Ambiguity handling", breakdown.ambiguityHandling],
                ["Surgical precision", breakdown.surgicalPrecision],
              ] as const)
                .filter(([, d]) => d)
                .map(([label, d]) => (
                  <div key={label} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, alignItems: "start", padding: "5px 0" }}>
                    <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)" }}>{label}</span>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", lineHeight: 1.5 }}>{d!.reason || "—"}</span>
                  </div>
                ))}
            </div>
          )}

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
