import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTeam } from "@/context/TeamContext";
import type { Project } from "@/services/api";
import { fetchExecutiveSummary } from "@/services/api";
import { ReportScope, StatCard, Sparkline, PanelState, usePanelData, type Scope } from "@/components/reports/shared";

/**
 * Executive summary (Reporting Phase C). Six numbers, no drill-in — the coarsest
 * tier. Admin-only (roles are admin/member; no executive flag exists), defaulting
 * to All projects and month-to-date. Every number rolls up a metric Phase B
 * already computes; deltas compare to last month at the same elapsed point.
 */
export function ExecutiveReports({ projects }: { projects: Project[] }) {
  const { isAdmin } = useTeam();

  if (!isAdmin) {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--c-ink-4)" }}>
        <ShieldAlert size={20} style={{ margin: "0 auto 8px", display: "block" }} />
        Executive reports are available to team admins only.
      </div>
    );
  }

  return <ExecutiveBody projects={projects} />;
}

function ExecutiveBody({ projects }: { projects: Project[] }) {
  const [scope, setScope] = useState<Scope>("all");
  const { data, loading, error, reload } = usePanelData(
    () => fetchExecutiveSummary(scope === "all" ? undefined : scope),
    [scope],
  );

  const t = data?.planAcceptanceTrend;
  const rangeLabel = t && t.first != null && t.last != null ? `${t.first}% → ${t.last}%` : t?.current != null ? `${t.current}%` : "—";

  return (
    <div style={{ padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-xl)", fontWeight: 700, color: "var(--c-ink)", margin: 0, letterSpacing: "-0.01em" }}>Executive summary</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", margin: "4px 0 0" }}>Month to date · deltas vs. last month.</p>
        </div>
        <ReportScope projects={projects} value={scope} onChange={setScope} />
      </div>

      <div style={{ marginTop: 20 }}>
        <PanelState loading={loading} error={error} isEmpty={false} onRetry={reload}>
          {data && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              <StatCard label="Active projects" value={data.activeProjects.value} delta={data.activeProjects.delta} />
              <StatCard label="Runs this month" value={data.runs.value} delta={data.runs.delta} />
              <StatCard
                label="Delivery rate"
                value={data.deliveryRate.value != null ? `${data.deliveryRate.value}%` : "—"}
                delta={data.deliveryRate.delta}
              />
              {/* The headline counts what Aegis blocked. The footnote says how much
                  of that was then waved through — a subset of the same number,
                  so the two never contradict each other. */}
              <StatCard
                label="Findings blocked pre-merge"
                value={data.findingsBlocked.value}
                delta={data.findingsBlocked.delta}
                footnote={
                  data.findingsOverridden.value > 0 ? (
                    <span style={{ color: "var(--c-red)" }}>
                      {data.findingsOverridden.value} of these were overridden by an admin
                    </span>
                  ) : data.findingsBlocked.value > 0 ? (
                    "None overridden"
                  ) : undefined
                }
              />

              {/* Delivery-rate subtext — no "acceptance"/"merge" wording. */}
              <div style={{ gridColumn: "1 / -1", marginTop: -6, fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
                Delivery rate = runs that produced a committed PR, over runs that reached an outcome.
              </div>

              {/* Cost card carries its planning-stage caveat inline — never hidden. */}
              <div style={{ border: "1px solid var(--c-border)", borderRadius: 8, background: "var(--c-surface)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>Est. cost / run</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xl)", fontWeight: 600, color: "var(--c-ink)" }}>
                    {data.costPerRun.valueUsd != null ? `$${data.costPerRun.valueUsd.toFixed(4)}` : "—"}
                  </span>
                  {data.costPerRun.delta != null && (
                    <span style={{ fontSize: "var(--fs-xs)", color: data.costPerRun.delta < 0 ? "var(--c-green)" : data.costPerRun.delta > 0 ? "var(--c-red)" : "var(--c-ink-4)" }}>
                      {data.costPerRun.delta > 0 ? "+" : ""}{data.costPerRun.delta.toFixed(4)}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>Planning-stage only — generation tokens not yet counted.</span>
              </div>

              {/* Plan acceptance trend — the one chart card. */}
              <div style={{ gridColumn: "1 / -1", border: "1px solid var(--c-border)", borderRadius: 8, background: "var(--c-surface)", padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>Plan acceptance trend · 12 weeks</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}>{rangeLabel}</span>
                </div>
                <div style={{ marginTop: 8, overflowX: "auto" }}>
                  {t && t.points.length > 1 ? (
                    <Sparkline points={t.points} width={640} height={48} />
                  ) : (
                    <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>Not enough weekly data to trend yet.</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </PanelState>
      </div>
    </div>
  );
}
