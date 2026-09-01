import { useLocation } from "wouter";
import { ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import {
  fetchRetrievalAttribution,
  fetchPlanAcceptance,
  fetchCoherenceStats,
  fetchConfidenceDistribution,
  fetchAgentWin,
  fetchThroughput,
  fetchTimeToPr,
  fetchPlanningCost,
  fetchSecurityPosture,
  type SecurityPosture,
} from "@/services/api";
import { ReportPanel, PanelState, Sparkline, Row, usePanelData } from "@/components/reports/shared";
import { SEV_COLOR } from "@/components/reports/ChartsGrid";

type SecuritySeverities = SecurityPosture["severities"];

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
// How well retrieval served the planner. Two views: planner coverage (over all
// planned files — has data on real runs) and hand-added files (empty until users
// edit plans). Each category carries its actionable meaning, not a raw boolean.
function AttrBar({ count, denom, tone, label, hint }: { count: number; denom: number; tone: "teal" | "amber" | "red"; label: string; hint: string }) {
  const bg = tone === "teal" ? "var(--accent-blue)" : `var(--c-${tone})`;
  return (
    <div style={{ padding: "8px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>{label}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>{count}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--c-raised)", marginTop: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(count / Math.max(denom, 1)) * 100}%`, background: bg, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 3 }}>{hint}</div>
    </div>
  );
}

export function RetrievalAttributionPanel({ days, projectId }: { days: number; projectId?: number }) {
  const [, navigate] = useLocation();
  const { data, loading, error, reload } = usePanelData(() => fetchRetrievalAttribution(days, projectId), [days, projectId]);
  const plannerTotal = data ? data.planner.inCandidates + data.planner.missed : 0; // edit/delete only
  const plannerAny = data ? plannerTotal + data.planner.creates : 0;
  const manualTotal = data ? data.manual.found + data.manual.missed : 0;

  return (
    <ReportPanel
      title="Retrieval attribution"
      subtitle={`How well retrieval served the planner, last ${days} days — a prompt problem vs. a retrieval problem.`}
    >
      <PanelState loading={loading} error={error} isEmpty={plannerAny === 0 && manualTotal === 0} onRetry={reload} emptyLabel="No planned files in this window.">
        {data && (
          <>
            {/* Planner coverage over EXISTING files — creates are excluded from the
                miss math (new files can't be retrieved) and noted separately. */}
            <div style={{ padding: "8px 14px 2px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>Planner retrieval coverage · edited files</span>
              {data.planner.coverageRate != null && (
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>{data.planner.coverageRate}% surfaced</span>
              )}
            </div>
            {plannerTotal === 0 ? (
              <div style={{ padding: "4px 14px 10px", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>No existing files were edited in this window.</div>
            ) : (
              <>
                <AttrBar count={data.planner.inCandidates} denom={plannerTotal} tone="teal" label="In candidates" hint="Retrieval surfaced the file the planner edited." />
                <AttrBar count={data.planner.missed} denom={plannerTotal} tone="red" label="Retrieval miss — edited anyway" hint="The planner edited an existing file retrieval never surfaced — fix retrieval." />
              </>
            )}
            {data.planner.creates > 0 && (
              <div style={{ padding: "2px 14px 8px", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
                + {data.planner.creates} new file{data.planner.creates === 1 ? "" : "s"} created — not counted (new files can't be retrieved).
              </div>
            )}

            {/* Hand-added files — empty until users edit plans. */}
            <div style={{ padding: "12px 14px 2px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)", borderTop: "1px solid var(--c-border)" }}>
              Files added by hand
            </div>
            {manualTotal === 0 ? (
              <div style={{ padding: "4px 14px 10px", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>No plan files were added by hand in this window.</div>
            ) : (
              <>
                <AttrBar count={data.manual.found} denom={manualTotal} tone="amber" label="Retrieval found it, planner chose badly" hint="The path was in candidates — fix the planner prompt." />
                <AttrBar count={data.manual.missed} denom={manualTotal} tone="red" label="Retrieval never found it" hint="The path wasn't retrieved at all — fix retrieval." />
                {data.manual.topPaths.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ padding: "6px 14px 2px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>
                      Most-added-by-hand paths
                    </div>
                    {data.manual.topPaths.map((p) => (
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

// ── PR 3 shared: a tiny trend chart with gap-aware bars ─────────────────────
// null values render as an empty slot (a data gap), never a zero-height bar —
// so "no data this week" never reads the same as "zero this week".
function TrendBars({ points, color, format, scaleMax }: { points: { label: string; value: number | null }[]; color: string; format: (v: number) => string; scaleMax?: number }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  // `scaleMax` pins the axis — pass it for a percentage, where scaling to the
  // tallest bar in the window would make a small rate look like a large one.
  const max = scaleMax ?? Math.max(...vals, 0.0001);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 44, marginTop: 8 }}>
      {points.map((p, i) => (
        <div key={i} title={`${p.label}: ${p.value != null ? format(p.value) : "no data"}`} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }}>
          {p.value == null ? (
            <div style={{ width: "100%", height: 2, background: "var(--c-border)", borderRadius: 1 }} />
          ) : (
            <div style={{ width: "100%", height: `${Math.max((p.value / max) * 100, 3)}%`, background: color, borderRadius: "3px 3px 0 0" }} />
          )}
        </div>
      ))}
    </div>
  );
}

function DeltaBadge({ delta, unit, invert }: { delta: number | null; unit: string; invert?: boolean }) {
  if (delta == null) return null;
  // invert: for cost/latency, down is good (green).
  const good = invert ? delta < 0 : delta > 0;
  const bad = invert ? delta > 0 : delta < 0;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--fs-sm)", color: good ? "var(--c-green)" : bad ? "var(--c-red)" : "var(--c-ink-4)", paddingBottom: 4 }}>
      {delta > 0 ? <ArrowUpRight size={14} /> : delta < 0 ? <ArrowDownRight size={14} /> : null}
      {Math.abs(delta)}{unit} vs. prior
    </div>
  );
}

const bigNum: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 34, fontWeight: 600, color: "var(--c-ink)", lineHeight: 1 };

// ── 3.1 Throughput ──────────────────────────────────────────────────────────
export function ThroughputPanel({ days, projectId }: { days: number; projectId?: number }) {
  const { data, loading, error, reload } = usePanelData(() => fetchThroughput(days, projectId), [days, projectId]);
  return (
    <ReportPanel title="Throughput" subtitle={`Runs started in the last ${days} days, by trigger.`}>
      <PanelState loading={loading} error={error} isEmpty={!!data && data.total === 0 && data.priorTotal === 0} onRetry={reload} emptyLabel="No runs in this window.">
        {data && (
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div style={bigNum}>{data.total}</div>
              <DeltaBadge delta={data.delta} unit="" />
            </div>
            <div style={{ marginTop: 12, fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
              <b style={{ color: "var(--c-ink)" }}>{data.manual}</b> manual ·{" "}
              <b style={{ color: "var(--c-ink)" }}>{data.scheduled}</b> scheduled
              <span style={{ color: "var(--c-ink-4)" }}> · {data.priorTotal} in the prior {days}d</span>
            </div>
          </div>
        )}
      </PanelState>
    </ReportPanel>
  );
}

// ── 3.2 Time to PR ──────────────────────────────────────────────────────────
export function TimeToPrPanel({ days, projectId }: { days: number; projectId?: number }) {
  const { data, loading, error, reload } = usePanelData(() => fetchTimeToPr(days, projectId), [days, projectId]);
  return (
    <ReportPanel title="Time to PR" subtitle={`Median run start → finish for runs that opened a PR, last ${days} days.`}>
      <PanelState loading={loading} error={error} isEmpty={!!data && data.runsWithPr === 0} onRetry={reload} emptyLabel="No runs opened a PR in this window.">
        {data && (
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div style={bigNum}>{data.medianHours != null ? `${data.medianHours}h` : "—"}</div>
              <DeltaBadge delta={data.delta} unit="h" invert />
            </div>
            <TrendBars points={data.trend.map((t) => ({ label: t.label, value: t.median }))} color="var(--accent-blue)" format={(v) => `${v}h`} />
            <div style={{ marginTop: 8, fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
              Median over {data.runsWithPr} PR run{data.runsWithPr === 1 ? "" : "s"}. Measured run start → finish; a Phase-2 before/after marker is deferred until more data accrues.
            </div>
          </div>
        )}
      </PanelState>
    </ReportPanel>
  );
}

// ── 3.3 Planning-stage cost per run ─────────────────────────────────────────
export function PlanningCostPanel({ days, projectId }: { days: number; projectId?: number }) {
  const { data, loading, error, reload } = usePanelData(() => fetchPlanningCost(days, projectId), [days, projectId]);
  const money = (v: number) => `$${v.toFixed(4)}`;
  return (
    <ReportPanel title="Planning-stage cost per run" subtitle={`Estimated planning-call cost, last ${days} days. Generation-stage tokens aren't instrumented yet.`}>
      <PanelState loading={loading} error={error} isEmpty={!!data && data.runsWithTokens === 0} onRetry={reload} emptyLabel="No planned runs with token data in this window.">
        {data && (
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div style={bigNum}>{data.avgCostUsd != null ? money(data.avgCostUsd) : "—"}</div>
              <DeltaBadge delta={data.delta} unit="" invert />
            </div>
            <TrendBars points={data.trend.map((t) => ({ label: t.label, value: t.cost }))} color="var(--accent-blue)" format={money} />
            <div style={{ marginTop: 8, fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
              Avg {data.avgInputTokens ?? 0} in / {data.avgOutputTokens ?? 0} out tokens over {data.runsWithTokens} run{data.runsWithTokens === 1 ? "" : "s"} · Sonnet 4.5 rates. Planning call only — Raptia/Fovea/Veria/Aegis/Narratia usage not yet counted.
            </div>
          </div>
        )}
      </PanelState>
    </ReportPanel>
  );
}

// ── 3.4 Security posture ────────────────────────────────────────────────────
const SEV_ROWS: { key: keyof SecuritySeverities; label: string; color: string }[] = [
  { key: "critical", label: "Critical", color: SEV_COLOR.Critical },
  { key: "high", label: "High", color: SEV_COLOR.High },
  { key: "medium", label: "Medium", color: SEV_COLOR.Medium },
  { key: "low", label: "Low", color: SEV_COLOR.Low },
  { key: "info", label: "Info", color: "var(--c-ink-4)" },
];

export function SecurityPosturePanel({ days, projectId }: { days: number; projectId?: number }) {
  const { data, loading, error, reload } = usePanelData(() => fetchSecurityPosture(days, projectId), [days, projectId]);
  return (
    <ReportPanel title="Security posture" subtitle={`Aegis findings by severity, last ${days} days.`}>
      <PanelState loading={loading} error={error} isEmpty={!!data && data.scannedRuns === 0} onRetry={reload} emptyLabel="No security scans in this window.">
        {data && (
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {SEV_ROWS.map((s) => (
                <div key={s.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 56, border: "1px solid var(--c-border)", borderRadius: 8, padding: "8px 10px", background: "var(--c-surface)" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-lg)", fontWeight: 600, color: data.severities[s.key] > 0 ? s.color : "var(--c-ink-4)" }}>{data.severities[s.key]}</span>
                  <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-ink-4)" }}>{s.label}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
              <b style={{ color: data.gateBlocked > 0 ? "var(--c-red)" : "var(--c-ink)" }}>{data.gateBlocked}</b> gate-blocked run{data.gateBlocked === 1 ? "" : "s"}
              <span style={{ color: "var(--c-ink-4)" }}> · {data.total} findings across {data.scannedRuns} scanned run{data.scannedRuns === 1 ? "" : "s"}</span>
            </div>
            <TrendBars points={data.trend.map((t) => ({ label: t.label, value: t.count }))} color={SEV_COLOR.High} format={(v) => `${v} findings`} />

            {/* Override rate (0034). A block that was waved through is still a
                block — `gateBlocked` counts what Aegis decided, so overriding
                one never quietly removes it from the denominator. */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--c-border)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>Override rate</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-lg)", fontWeight: 600, color: data.overrides > 0 ? "var(--c-red)" : "var(--c-ink)" }}>
                  {data.overrideRate != null ? `${data.overrideRate}%` : "—"}
                </span>
              </div>
              {data.gateBlocked > 0 ? (
                <>
                  <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 4 }}>
                    <b style={{ color: data.overrides > 0 ? "var(--c-red)" : "var(--c-ink)" }}>{data.overrides}</b> of {data.gateBlocked} blocked run
                    {data.gateBlocked === 1 ? "" : "s"} cleared by an admin override.
                  </div>
                  <TrendBars
                    points={data.overrideTrend.map((t) => ({ label: `${t.label} · ${t.overrides} of ${t.blocked} blocked`, value: t.rate }))}
                    color="var(--c-red)"
                    scaleMax={100}
                    format={(v) => `${v}% overridden`}
                  />
                </>
              ) : (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", marginTop: 4 }}>No gate blocks in this window, so nothing to override.</div>
              )}
            </div>

            {/* Baseline findings (0035), reported beside the gate numbers and
                never added into them. Everything above is about changes stopped
                on their way to merge; this is code that was already there. */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--c-border)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>
                  Existing code · baseline scans
                </span>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>not counted above</span>
              </div>
              {data.baseline.repositoriesScanned === 0 ? (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", marginTop: 4 }}>
                  No codebase has been baseline-scanned yet.
                </div>
              ) : (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 4, lineHeight: 1.6 }}>
                  <b style={{ color: data.baseline.criticalCount > 0 ? "var(--c-red)" : "var(--c-ink)" }}>{data.baseline.criticalCount}</b> critical
                  {" · "}
                  <b style={{ color: data.baseline.highCount > 0 ? "var(--c-amber)" : "var(--c-ink)" }}>{data.baseline.highCount}</b> high
                  {" across "}
                  {data.baseline.repositoriesScanned} scanned {data.baseline.repositoriesScanned === 1 ? "repository" : "repositories"}
                  <div style={{ color: "var(--c-ink-4)" }}>
                    {data.baseline.open} open · {data.baseline.acknowledged} acknowledged · {data.baseline.pushed} filed to the tracker
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </PanelState>
    </ReportPanel>
  );
}
