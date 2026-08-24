import { useLocation } from "wouter";
import { ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import { fetchRetrievalAttribution, fetchPlanAcceptance } from "@/services/api";
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
