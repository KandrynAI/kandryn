import type { ReportData } from "@/services/api";

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h}h`;
}

export function KpiRow({ kpis }: { kpis: ReportData["kpis"] }) {
  const cells: { label: string; value: string | number }[] = [
    { label: "Total runs", value: kpis.totalRuns },
    { label: "Success rate", value: `${kpis.successRate}%` },
    { label: "PRs opened", value: kpis.prsOpened },
    { label: "Commits", value: kpis.committedRuns },
    { label: "Avg time to PR", value: fmtHours(kpis.avgTimeToPrHours) },
    { label: "Security findings", value: kpis.securityFindings },
  ];
  return (
    <div
      className="report-section"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        border: "1px solid var(--c-border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--c-surface)",
      }}
    >
      {cells.map((c, i) => (
        <div key={c.label} style={{ padding: "14px 16px", borderLeft: i === 0 ? "none" : "1px solid var(--c-border)" }}>
          <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 600, color: "var(--c-ink)", fontFamily: "var(--mono)", lineHeight: 1 }}>
            {c.value}
          </div>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
}
