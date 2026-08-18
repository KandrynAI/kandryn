import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { agentDisplay } from "@/lib/agents";
import { Logo } from "@/components/Logo";
import { useRepo } from "@/context/RepoContext";
import {
  fetchRun,
  fetchProject,
  fetchProjectWorkItems,
  type RunDetail,
  type RunSuggestion,
  type Project,
  type WorkItem,
  type ScoreBreakdown,
} from "@/services/api";

const DIMS: { key: keyof Pick<ScoreBreakdown, "correctness" | "readability" | "minimalDiff" | "conventions" | "acCoverage">; label: string }[] = [
  { key: "correctness", label: "Correctness" },
  { key: "readability", label: "Readability" },
  { key: "minimalDiff", label: "Minimal diff" },
  { key: "conventions", label: "Conventions" },
  { key: "acCoverage", label: "AC coverage" },
];
const PRIORITY_DOT: Record<string, string> = { high: "var(--c-red)", medium: "var(--c-amber)", low: "var(--c-ink-4)" };
const TYPE_LABEL: Record<string, string> = { "happy-path": "Happy", "edge-case": "Edge", failure: "Fail" };
const VERDICT_STYLE: Record<string, { bg: string; fg: string }> = {
  strong: { bg: "var(--c-green-bg)", fg: "var(--c-green)" },
  adequate: { bg: "var(--c-amber-bg)", fg: "var(--c-amber)" },
  weak: { bg: "var(--c-red-bg)", fg: "var(--c-red)" },
};

function prNumber(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:pull|pullrequest)\/(\d+)/i) ?? url.match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

export default function RunReportPage() {
  const params = useParams<{ runId: string }>();
  const runId = Number(params.runId);
  const [, navigate] = useLocation();
  const { user } = useUser();
  const { repos } = useRepo();

  const [data, setData] = useState<RunDetail | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [workItem, setWorkItem] = useState<WorkItem | null>(null);
  const [pushedCases, setPushedCases] = useState<WorkItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchRun(runId);
        if (cancelled) return;
        setData(d);
        const [p, items] = await Promise.all([
          fetchProject(d.run.projectId),
          fetchProjectWorkItems(d.run.projectId),
        ]);
        if (cancelled) return;
        setProject(p);
        setWorkItem(items.find((it) => it.id === d.run.workItemId) ?? null);
        setPushedCases(items.filter((it) => it.parentId === d.run.workItemId && it.itemType === "test_case"));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) return <div style={{ padding: 40, color: "var(--c-ink-4)" }}>Loading report…</div>;
  if (error || !data || !project) return <div style={{ padding: 40, color: "var(--c-ink-3)" }}>{error ?? "Report not found."}</div>;

  const { run, suggestions } = data;
  // Resolve the repo via the run's snapshot, else the project's owned repo
  // (repositories.project_id, 0020) — projects.repository_id is deprecated.
  const repo =
    repos.find((r) => run.repositoryId != null && r.id === run.repositoryId) ??
    repos.find((r) => r.projectId === project.id) ??
    null;
  const committed =
    suggestions.find((s) => run.committedSuggestionId != null && s.id === run.committedSuggestionId) ??
    suggestions.find((s) => s.recommendation === "Recommended") ??
    suggestions[0];
  const testCases = committed?.testCases ?? [];
  const raptia = suggestions.find((s) => agentDisplay(s.agent).name === "Raptia");
  const fovea = suggestions.find((s) => agentDisplay(s.agent).name === "Fovea");
  const recommended = suggestions.find((s) => s.recommendation === "Recommended") ?? suggestions[0];
  const ordered = [...suggestions].sort((a) => (a.recommendation === "Recommended" ? -1 : 1));
  const ac = workItem?.acceptanceCriteria?.split(/\n/).map((s) => s.trim()).filter(Boolean) ?? [];
  const reportDate = new Date().toLocaleString();
  const pr = prNumber(run.prUrl);

  return (
    <div className="report-root">
      <style>{`
        .rr-section { font-size: var(--fs-lg); font-weight: 700; color: var(--c-ink); border-bottom: 1px solid var(--c-border); padding-bottom: 6px; margin: 24px 0 12px; }
        .rr-sub { font-size: var(--fs-xs); color: var(--c-ink-4); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; font-weight: 600; }
        .rr-kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: var(--fs-sm); }
        .rr-kv .k { color: var(--c-ink-4); }
        .rr-kv .v { color: var(--c-ink-2); }
        .rr-code { counter-reset: ln; border: 1px solid var(--c-border); border-radius: 4px; background: var(--c-raised); padding: 12px 0; overflow-x: auto; }
        .rr-code .ln { display: grid; grid-template-columns: 40px 1fr; font-family: var(--mono); font-size: 11px; line-height: 1.6; color: var(--c-ink-2); }
        .rr-code .ln::before { counter-increment: ln; content: counter(ln); color: var(--c-ink-4); text-align: right; padding-right: 12px; user-select: none; }
        .rr-code .ln pre { margin: 0; white-space: pre; }
        .rr-tbl { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
        .rr-tbl th, .rr-tbl td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--c-border); }
        .rr-tbl th { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-ink-4); }
      `}</style>

      {/* Screen-only top bar */}
      <div className="screen-only" style={{ height: "var(--topbar-h)", display: "flex", alignItems: "center", padding: "0 16px", borderBottom: "1px solid var(--c-border)", background: "var(--c-bg)", position: "sticky", top: 0, zIndex: 2 }}>
        <button className="bm-ghost" style={{ border: "none" }} onClick={() => navigate(`/runs/${runId}`)}>
          <ArrowLeft size={12} />Back to run
        </button>
        <span style={{ margin: "0 auto", fontSize: "var(--fs-base)", fontWeight: 600 }}>Run report · #{runId}</span>
        <button className="bm-primary" onClick={() => window.print()}>
          <Download size={14} />Download PDF
        </button>
      </div>

      {/* Printable content */}
      <div className="report-content" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 40px", fontFamily: "var(--sans)" }}>
        {/* SECTION 1 — HEADER */}
        <div className="report-section">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Logo context="print" height={24} />
            </div>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>{reportDate}</span>
          </div>
          <div style={{ height: 1, background: "var(--c-border)", margin: "12px 0 20px" }} />

          <h1 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: "var(--c-ink)" }}>{workItem?.title ?? `Work item #${run.workItemId}`}</h1>
          <div style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 4 }}>
            {project.plmProvider} · {project.plmProjectKey ?? "—"} · {project.name}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <span className={`bm-badge bm-badge-${run.status}`}>{run.status}</span>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>Triggered by: {run.trigger === "scheduled" ? "Scheduled" : "Manual"}</span>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>Run at: {new Date(run.startedAt ?? run.createdAt).toLocaleString()}</span>
            {pr && (
              <a href={run.prUrl ?? undefined} target="_blank" rel="noopener noreferrer" style={{ fontSize: "var(--fs-sm)", color: "var(--c-blue)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                PR: #{pr}<ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>

        {/* SECTION 2 — EXECUTIVE SUMMARY */}
        <div className="report-section">
          <div className="rr-section">Executive summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              {recommended ? (
                <>
                  <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-ink)" }}>
                    Synthesis recommended {agentDisplay(recommended.agent).name}
                  </div>
                  {recommended.scoreBreakdown ? (
                    <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 2 }}>
                      {Math.round(recommended.scoreBreakdown.confidence)}% confidence · {recommended.scoreBreakdown.confidenceReason}
                    </div>
                  ) : null}
                  {recommended.scoreNarrative && (
                    <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.6, marginTop: 8 }}>{recommended.scoreNarrative}</p>
                  )}
                </>
              ) : (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>No suggestions were produced.</div>
              )}
            </div>
            <div>
              <table className="rr-tbl">
                <thead>
                  <tr><th>Dimension</th><th>Raptia</th><th>Fovea</th></tr>
                </thead>
                <tbody>
                  {DIMS.map(({ key, label }) => {
                    const ra = raptia?.scoreBreakdown?.[key].score;
                    const fo = fovea?.scoreBreakdown?.[key].score;
                    const raWin = ra != null && fo != null && ra >= fo;
                    return (
                      <tr key={key}>
                        <td>{label}</td>
                        <td style={{ fontWeight: raWin ? 700 : 400, color: raWin ? "var(--c-blue)" : undefined }}>{ra != null ? Math.round(ra) : "—"}</td>
                        <td style={{ fontWeight: ra != null && fo != null && fo > ra ? 700 : 400, color: ra != null && fo != null && fo > ra ? "var(--c-blue)" : undefined }}>{fo != null ? Math.round(fo) : "—"}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: "1px solid var(--c-border)" }}>
                    <td style={{ fontWeight: 700 }}>Overall</td>
                    <td style={{ fontWeight: 700 }}>{raptia?.score != null ? `${raptia.score}/10` : "—"}</td>
                    <td style={{ fontWeight: 700 }}>{fovea?.score != null ? `${fovea.score}/10` : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* SECTION 3 — WORK ITEM */}
        <div className="report-section">
          <div className="rr-section">Work item</div>
          <div className="rr-kv">
            <span className="k">Title</span><span className="v">{workItem?.title ?? "—"}</span>
            <span className="k">Type</span><span className="v">{workItem?.itemType ?? "—"}</span>
            <span className="k">Priority</span><span className="v">{workItem?.priority ?? "—"}</span>
            <span className="k">PLM key</span><span className="v">{workItem?.externalId ?? "—"}</span>
            <span className="k">Source</span><span className="v">{workItem?.source ?? project.plmProvider}</span>
            <span className="k">Project</span><span className="v">{project.name}</span>
          </div>
          {ac.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="rr-sub">Acceptance criteria</div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {ac.map((c, i) => <li key={i} style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", marginBottom: 3 }}>{c}</li>)}
              </ol>
            </div>
          )}
          {run.refinePrompt && (
            <div style={{ marginTop: 12 }}>
              <div className="rr-sub">Refinement prompt</div>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", fontStyle: "italic", borderLeft: "3px solid var(--c-border)", paddingLeft: 10 }}>{run.refinePrompt}</p>
            </div>
          )}
        </div>

        {/* SECTIONS 4 & 5 — SUGGESTIONS (recommended first) */}
        {ordered.map((s) => (
          <SuggestionSection key={s.id} s={s} />
        ))}

        {/* SECTION 6 — TEST CASES */}
        <div className="report-section">
          <div className="rr-section">Generated test cases</div>
          {testCases.length === 0 ? (
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>No test cases were generated for this run.</p>
          ) : (
            <>
              <table className="rr-tbl">
                <thead>
                  <tr><th>#</th><th>Priority</th><th>Type</th><th>Title</th><th>Given → When → Then</th></tr>
                </thead>
                <tbody>
                  {testCases.map((tc, i) => (
                    <tr key={tc.id} style={{ background: i % 2 ? "var(--c-surface)" : undefined }}>
                      <td style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{tc.id}</td>
                      <td><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: PRIORITY_DOT[tc.priority] }} />{tc.priority}</span></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)" }}>{TYPE_LABEL[tc.type] ?? tc.type}</td>
                      <td style={{ fontWeight: 600, color: "var(--c-ink)" }}>{tc.title}</td>
                      <td style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)" }}>
                        <div><b>Given:</b> {tc.given}</div>
                        <div><b>When:</b> {tc.when}</div>
                        <div><b>Then:</b> {tc.then}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12 }}>
                <div className="rr-sub">Assertion code</div>
                {testCases.map((tc) => (
                  <div key={tc.id} style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginBottom: 2 }}>
                    {tc.id.toUpperCase()} assert: {tc.assertion}
                  </div>
                ))}
              </div>
              {pushedCases.length > 0 && (
                <div style={{ marginTop: 12, background: "var(--c-green-bg)", color: "var(--c-green)", padding: "8px 12px", borderRadius: 4, fontSize: "var(--fs-sm)" }}>
                  {pushedCases.length} test case{pushedCases.length === 1 ? "" : "s"} pushed to {project.plmProvider} · {pushedCases.map((c) => c.externalId).filter(Boolean).join(" ")}
                </div>
              )}
            </>
          )}
        </div>

        {/* SECTION 7 — COMMIT DETAILS */}
        <div className="report-section">
          <div className="rr-section">Commit details</div>
          <div className="rr-kv">
            <span className="k">Branch</span><span className="v" style={{ fontFamily: "var(--mono)" }}>task/{run.workItemId}</span>
            <span className="k">Repository</span><span className="v">{repo?.name ?? "—"}</span>
            <span className="k">PR</span><span className="v">{run.prUrl ? <a href={run.prUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--c-blue)" }}>{run.prUrl}</a> : "Not committed"}</span>
            <span className="k">Committed at</span><span className="v">{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}</span>
            <span className="k">Auto-committed</span><span className="v">{run.autoCommit ? "Yes" : "No"}</span>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ height: 1, background: "var(--c-border)", margin: "24px 0 12px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
          <span>Generated by Blue Mantis · getbluemantis.com</span>
          <span>{user?.primaryEmailAddress?.emailAddress ?? run.userId} · {reportDate}</span>
        </div>
      </div>
    </div>
  );
}

function SuggestionSection({ s }: { s: RunSuggestion }) {
  const name = agentDisplay(s.agent).name;
  const b = s.scoreBreakdown;
  return (
    <div className="report-section">
      <div className="rr-section">{name} · Score {s.score ?? "—"}{s.score != null ? "/10" : ""}{s.recommendation === "Recommended" ? " · Recommended" : ""}</div>

      {b && (
        <div style={{ marginBottom: 12 }}>
          {DIMS.map(({ key, label }) => {
            const d = b[key];
            const vs = VERDICT_STYLE[d.verdict] ?? VERDICT_STYLE.adequate;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                <span style={{ width: 120, fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{label}</span>
                <span style={{ flex: 1, height: 3, background: "var(--c-raised)", display: "block" }}>
                  <span className="score-fill" style={{ display: "block", height: 3, background: "var(--c-blue)", width: `${Math.max(0, Math.min(100, d.score))}%` }} />
                </span>
                <span style={{ width: 28, fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", textAlign: "right" }}>{Math.round(d.score)}</span>
                <span style={{ fontSize: "var(--fs-xs)", fontWeight: 700, textTransform: "uppercase", padding: "1px 5px", borderRadius: 3, background: vs.bg, color: vs.fg }}>{d.verdict}</span>
              </div>
            );
          })}
        </div>
      )}

      {s.explanation && (
        <div style={{ marginBottom: 10 }}>
          <div className="rr-sub">Explanation</div>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.6, borderLeft: "3px solid var(--c-blue-bg)", paddingLeft: 10 }}>{s.explanation}</p>
        </div>
      )}

      <div style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginBottom: 6 }}>File: {s.files?.[0]?.filePath ?? s.filePath}</div>

      <div className="rr-code code-block">
        {(s.files?.[0]?.content ?? s.code ?? "").split("\n").map((line, i) => (
          <div className="ln" key={i}><pre>{line || " "}</pre></div>
        ))}
      </div>
    </div>
  );
}
