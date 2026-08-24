import { useLocation } from "wouter";
import { ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import {
  fetchRetrievalAttribution,
  fetchPlanAcceptance,
  fetchCoherenceStats,
  fetchConfidenceDistribution,
  fetchAgentWin,
} from "@/services/api";
import { ReportPanel, PanelState, Sparkline, Row, usePanelData } from "@/components/reports/shared";

// Reporting Phase B — Manager panels. These extend the /reports analytics view
// (team-aware scope: admin sees the team, a member sees their own). Each fetches
// independently through the shared usePanelData three-state hook. `projectId`
// omitted = "All projects". PR 1 ships the two highest-leverage panels.

// ── 1.2 Plan acceptance rate ────────────────────────────────────────────────
// The headline number: how often the first plan is accepted and run without
// edits. Accuracy matters more than any other panel — the definition is spelled
// out server-side (never-edited runs over runs that produced a usable plan and
// reached a terminal state).
export function PlanAcceptancePanel({ days, projectId }: { days: number; projectId?: number }) {
  const { data, loading, error, reload } = usePanelData(() => fetchPlanAcceptance(days, projectId), [days, projectId]);
  const noRuns = !!data && data.total === 0;

  return (
    <ReportPanel
      title="Plan acceptance rate"
      subtitle={`Runs whose first plan was accepted without edits, last ${days} days.`}
    >
      <PanelState loading={loading} error={error} isEmpty={noRuns} onRetry={reload} emptyLabel="No runs produced a usable plan in this window.">
        {data && (
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 34, fontWeight: 600, color: "var(--c-ink)", lineHeight: 1 }}>
                {data.rate != null ? `${data.rate}%` : "—"}
              </div>
              {data.delta != null && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    fontSize: "var(--fs-sm)",
                    color: data.delta > 0 ? "var(--c-green)" : data.delta < 0 ? "var(--c-red)" : "var(--c-ink-4)",
                    paddingBottom: 4,
                  }}
                >
                  {data.delta > 0 ? <ArrowUpRight size={14} /> : data.delta < 0 ? <ArrowDownRight size={14} /> : null}
                  {Math.abs(data.delta)} pts vs. prior {days}d
                </div>
              )}
              {data.sparkline.length > 1 && (
                <div style={{ marginLeft: "auto", paddingBottom: 2 }}>
                  <Sparkline points={data.sparkline} width={120} height={28} />
                </div>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
              <b style={{ color: "var(--c-ink)" }}>{data.accepted}</b> accepted as-is ·{" "}
              <b style={{ color: "var(--c-ink)" }}>{data.edited}</b> edited ·{" "}
              <b style={{ color: "var(--c-ink)" }}>{data.rejected}</b> rejected
              <span style={{ color: "var(--c-ink-4)" }}> of {data.total} runs with a plan</span>
            </div>
          </div>
        )}
      </PanelState>
    </ReportPanel>
  );
}

// ── 1.1 Retrieval attribution ───────────────────────────────────────────────
// For every file a human added to a plan by hand, was it in the planner's
// candidate set? The two categories carry their actionable meaning — a planner
// miss (fix the prompt) vs. a retrieval miss (fix retrieval) — not a raw boolean.
export function RetrievalAttributionPanel({ days, projectId }: { days: number; projectId?: number }) {
  const [, navigate] = useLocation();
  const { data, loading, error, reload } = usePanelData(() => fetchRetrievalAttribution(days, projectId), [days, projectId]);
  const total = data ? data.found + data.missed : 0;
  const max = data ? Math.max(data.found, data.missed, 1) : 1;

  const bar = (count: number, tone: "amber" | "red", label: string, hint: string) => (
    <div style={{ padding: "8px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>{label}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>{count}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--c-raised)", marginTop: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(count / max) * 100}%`, background: `var(--c-${tone})`, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 3 }}>{hint}</div>
    </div>
  );

  return (
    <ReportPanel
      title="Retrieval attribution"
      subtitle={`Where hand-added plan files came from, last ${days} days — a prompt problem vs. a retrieval problem.`}
    >
      <PanelState loading={loading} error={error} isEmpty={total === 0} onRetry={reload} emptyLabel="No plan files were added by hand in this window.">
        {data && (
          <>
            {bar(data.found, "amber", "Retrieval found it, planner chose badly", "The path was in candidates — fix the planner prompt.")}
            {bar(data.missed, "red", "Retrieval never found it", "The path wasn't retrieved at all — fix retrieval.")}
            {data.topPaths.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ padding: "8px 14px 2px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>
                  Most-added-by-hand paths
                </div>
                {data.topPaths.map((p) => (
                  <Row key={p.filePath}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.filePath}
                      </div>
                      <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>added by hand {p.count}×</div>
                    </div>
                    <button
                      onClick={() => navigate(`/runs/${p.exampleRunId}`)}
                      className="bm-ghost"
                      style={{ fontSize: "var(--fs-xs)", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                    >
                      Example <ArrowRight size={12} />
                    </button>
                  </Row>
                ))}
              </div>
            )}
          </>
        )}
      </PanelState>
    </ReportPanel>
  );
}

// ── 2.1 Coherence pass rate (C#) ────────────────────────────────────────────
// Scoped to C# suggestions by design — the Phase 3 checker is C#-only (regex,
// no Roslyn/tree-sitter at runtime); other stacks auto-pass, so they'd inflate
// the number. Labeled (C#) so the scope is explicit, not papered over.
export function CoherencePanel({ days, projectId }: { days: number; projectId?: number }) {
  const { data, loading, error, reload } = usePanelData(() => fetchCoherenceStats(days, projectId), [days, projectId]);
  const noData = !!data && data.total === 0;

  return (
    <ReportPanel
      title="Coherence pass rate (C#)"
      subtitle={`Static coherence checks on C# suggestions, last ${days} days. Non-C# stacks aren't checked yet.`}
    >
      <PanelState loading={loading} error={error} isEmpty={noData} onRetry={reload} emptyLabel="No C# suggestions with a coherence result in this window.">
        {data && (
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 34, fontWeight: 600, color: "var(--c-ink)", lineHeight: 1 }}>
                {data.rate != null ? `${data.rate}%` : "—"}
              </div>
              {data.delta != null && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    fontSize: "var(--fs-sm)",
                    color: data.delta > 0 ? "var(--c-green)" : data.delta < 0 ? "var(--c-red)" : "var(--c-ink-4)",
                    paddingBottom: 4,
                  }}
                >
                  {data.delta > 0 ? <ArrowUpRight size={14} /> : data.delta < 0 ? <ArrowDownRight size={14} /> : null}
                  {Math.abs(data.delta)} pts vs. prior {days}d
                </div>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
              <b style={{ color: "var(--c-green)" }}>{data.passed}</b> passed ·{" "}
              <b style={{ color: "var(--c-amber)" }}>{data.warnings}</b> warnings ·{" "}
              <b style={{ color: "var(--c-red)" }}>{data.failed}</b> failed
              <span style={{ color: "var(--c-ink-4)" }}> of {data.total} C# suggestions</span>
            </div>
          </div>
        )}
      </PanelState>
    </ReportPanel>
  );
}

// ── 2.2 Confidence distribution ─────────────────────────────────────────────
// Histogram of the Phase 4 confidence score with the project threshold marked.
// The calibration tool for the placeholder threshold — accuracy over polish.
export function ConfidenceDistributionPanel({ days, projectId }: { days: number; projectId?: number }) {
  const { data, loading, error, reload } = usePanelData(() => fetchConfidenceDistribution(days, projectId), [days, projectId]);
  const noData = !!data && data.total === 0;
  const maxCount = data ? Math.max(...data.histogram.map((b) => b.count), 1) : 1;
  const below = data ? data.belowThreshold.approved + data.belowThreshold.edited + data.belowThreshold.rejected + data.belowThreshold.pending : 0;

  return (
    <ReportPanel
      title="Confidence distribution"
      subtitle={`Phase 4 plan confidence, last ${days} days${data?.threshold != null ? ` · threshold ${data.threshold.toFixed(2)}` : " · select one project to mark its threshold"}.`}
    >
      <PanelState loading={loading} error={error} isEmpty={noData} onRetry={reload} emptyLabel="No scored plans in this window.">
        {data && (
          <div style={{ padding: "14px 16px 16px" }}>
            {/* Histogram (10 buckets, 0→1) with the threshold marker. */}
            <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 3, height: 96, borderBottom: "1px solid var(--c-border)" }}>
              {data.histogram.map((b, i) => (
                <div
                  key={i}
                  title={`${b.lo.toFixed(1)}–${b.hi.toFixed(1)}: ${b.count}`}
                  style={{ flex: 1, height: `${(b.count / maxCount) * 100}%`, minHeight: b.count > 0 ? 2 : 0, background: "var(--c-blue)", borderRadius: "3px 3px 0 0" }}
                />
              ))}
              {data.threshold != null && (
                <div
                  style={{ position: "absolute", top: -4, bottom: 0, left: `${data.threshold * 100}%`, width: 0, borderLeft: "2px dashed var(--c-amber)" }}
                >
                  <span style={{ position: "absolute", top: -14, left: 3, fontSize: 10, color: "var(--c-amber)", whiteSpace: "nowrap" }}>
                    threshold {data.threshold.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--c-ink-4)", marginTop: 3 }}>
              <span>0.0</span><span>0.5</span><span>1.0</span>
            </div>
            {/* Below-threshold outcome breakdown. */}
            <div style={{ marginTop: 12, fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
              {below === 0 ? (
                <span style={{ color: "var(--c-ink-4)" }}>No plans fell below threshold.</span>
              ) : (
                <>
                  <span style={{ color: "var(--c-ink-4)" }}>Below threshold: </span>
                  <b style={{ color: "var(--c-ink)" }}>{data.belowThreshold.approved}</b> approved as-is ·{" "}
                  <b style={{ color: "var(--c-ink)" }}>{data.belowThreshold.edited}</b> edited ·{" "}
                  <b style={{ color: "var(--c-ink)" }}>{data.belowThreshold.rejected}</b> rejected
                  {data.belowThreshold.pending > 0 && (
                    <> · <b style={{ color: "var(--c-ink)" }}>{data.belowThreshold.pending}</b> pending</>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </PanelState>
    </ReportPanel>
  );
}

// ── 2.3 Agent win rate ──────────────────────────────────────────────────────
// Raptia vs. Fovea: Recommended rate + average per Synthesia dimension. Names,
// order, and weights are Synthesia's actual values — not relabeled.
const AGENT_DIMS: { key: string; label: string; weight: number }[] = [
  { key: "correctness", label: "Correctness", weight: 30 },
  { key: "coherence", label: "Coherence", weight: 15 },
  { key: "conventions", label: "Convention", weight: 15 },
  { key: "acCoverage", label: "AC coverage", weight: 15 },
  { key: "readability", label: "Readability", weight: 15 },
  { key: "minimalDiff", label: "Diff proportionality", weight: 10 },
];

export function AgentWinPanel({ days, projectId }: { days: number; projectId?: number }) {
  const { data, loading, error, reload } = usePanelData(() => fetchAgentWin(days, projectId), [days, projectId]);
  const raptia = data?.agents.find((a) => a.name === "Raptia");
  const fovea = data?.agents.find((a) => a.name === "Fovea");
  const noData = !!data && (raptia?.runs ?? 0) === 0 && (fovea?.runs ?? 0) === 0;

  const cell = (v: number | null, best: boolean) => (
    <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", fontWeight: best ? 700 : 400, color: best ? "var(--c-blue)" : "var(--c-ink)" }}>
      {v != null ? v : "—"}
    </td>
  );

  return (
    <ReportPanel title="Agent win rate" subtitle={`Raptia vs. Fovea — Recommended rate and average Synthesia dimension scores, last ${days} days.`}>
      <PanelState loading={loading} error={error} isEmpty={noData} onRetry={reload} emptyLabel="No scored suggestions in this window.">
        {data && (
          <div style={{ padding: "4px 4px 8px", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" }}>
              <thead>
                <tr style={{ color: "var(--c-ink-4)", textAlign: "left" }}>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Dimension</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500, textAlign: "right" }}>Raptia</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500, textAlign: "right" }}>Fovea</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: "1px solid var(--c-border)" }}>
                  <td style={{ padding: "6px 10px", color: "var(--c-ink)", fontWeight: 600 }}>Recommended rate</td>
                  {cell(raptia?.recommendedRate ?? null, (raptia?.recommendedRate ?? -1) > (fovea?.recommendedRate ?? -1))}
                  {cell(fovea?.recommendedRate ?? null, (fovea?.recommendedRate ?? -1) > (raptia?.recommendedRate ?? -1))}
                </tr>
                {AGENT_DIMS.map((d) => {
                  const ra = raptia?.dimensions[d.key] ?? null;
                  const fo = fovea?.dimensions[d.key] ?? null;
                  return (
                    <tr key={d.key} style={{ borderTop: "1px solid var(--c-border)" }}>
                      <td style={{ padding: "6px 10px", color: "var(--c-ink-2)" }}>
                        {d.label} <span style={{ color: "var(--c-ink-4)", fontSize: "var(--fs-xs)" }}>· {d.weight}</span>
                      </td>
                      {cell(ra, ra != null && fo != null && ra > fo)}
                      {cell(fo, ra != null && fo != null && fo > ra)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "6px 10px 0", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
              Recommended rate is % of runs where each agent was picked ({raptia?.runs ?? 0} / {fovea?.runs ?? 0} scored runs). Dimension scores are 0–100.
            </div>
          </div>
        )}
      </PanelState>
    </ReportPanel>
  );
}
