import { useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import type { ReportData } from "@/services/api";

/* Palette — fixed hex (the app is light-only) so charts print consistently. */
const C = {
  blue: "#1a4fd6",
  teal: "#0d9488",
  amber: "#d97706",
  green: "#16a34a",
  red: "#dc2626",
  purple: "#7c3aed",
  slate: "#475569",
  gray: "#94a3b8",
};
const PIE = [C.blue, C.teal, C.amber, C.purple, C.green, C.red, C.gray];
const STATUS_COLOR: Record<string, string> = {
  succeeded: C.green,
  failed: C.red,
  canceled: C.gray,
  running: C.blue,
  queued: C.amber,
  scheduled: C.purple,
};
export const SEV_COLOR: Record<string, string> = {
  Critical: "#b91c1c",
  High: "#dc2626",
  Medium: "#f59e0b",
  Low: "#eab308",
};

const TICK = "#64748b";
const GRID = "rgba(15,23,42,0.06)";
const catAxis = { grid: { display: false }, ticks: { color: TICK, font: { size: 10 } } };
const valAxis = { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK, font: { size: 10 }, precision: 0 } };

function prettyStatus(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function prettyType(t: string) {
  return t === "test_case" ? "Test case" : t.charAt(0).toUpperCase() + t.slice(1);
}

/** A single chart card. Renders an empty note instead of the canvas when there's no data. */
function ReportChart({
  id,
  title,
  config,
  empty,
  wide,
}: {
  id: string;
  title: string;
  config: unknown;
  empty: boolean;
  wide?: boolean;
}) {
  const ref = useChart(empty ? null : config);
  return (
    <div
      className="report-section"
      style={{
        gridColumn: wide ? "1 / -1" : undefined,
        border: "1px solid var(--c-border)",
        borderRadius: 8,
        background: "var(--c-surface)",
        padding: "14px 16px 16px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-ink-4)", marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ position: "relative", height: 220 }}>
        {empty ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>
            No data in this range
          </div>
        ) : (
          <canvas id={id} ref={ref} />
        )}
      </div>
    </div>
  );
}

const allZero = (a: (number | null)[]) => a.every((v) => v == null || v === 0);

export function ChartsGrid({ data }: { data: ReportData }) {
  const c = data.charts;

  const runVolumeCfg = useMemo(
    () => ({
      type: "bar",
      data: { labels: c.runVolumeByWeek.labels, datasets: [{ label: "Runs", data: c.runVolumeByWeek.data, backgroundColor: C.blue, borderRadius: 3, maxBarThickness: 34 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: catAxis, y: valAxis } },
    }),
    [c.runVolumeByWeek],
  );

  const outcomesCfg = useMemo(
    () => ({
      type: "doughnut",
      data: { labels: c.outcomes.labels.map(prettyStatus), datasets: [{ data: c.outcomes.data, backgroundColor: c.outcomes.labels.map((s) => STATUS_COLOR[s] ?? C.gray), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "60%", plugins: { legend: { position: "right", labels: { color: TICK, font: { size: 11 }, boxWidth: 10 } } } },
    }),
    [c.outcomes],
  );

  const timeToPrCfg = useMemo(
    () => ({
      type: "line",
      data: { labels: c.timeToPrDaily.labels, datasets: [{ label: "Avg hours", data: c.timeToPrDaily.data, borderColor: C.teal, backgroundColor: "rgba(13,148,136,0.12)", fill: true, tension: 0.3, spanGaps: true, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: catAxis, y: { ...valAxis, ticks: { ...valAxis.ticks, precision: 1 } } } },
    }),
    [c.timeToPrDaily],
  );

  const agentWinCfg = useMemo(
    () => ({
      type: "bar",
      data: { labels: c.agentWinRate.labels, datasets: [{ label: "Commits", data: c.agentWinRate.data, backgroundColor: c.agentWinRate.labels.map((_, i) => PIE[i % PIE.length]), borderRadius: 3, maxBarThickness: 26 }] },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: valAxis, y: catAxis } },
    }),
    [c.agentWinRate],
  );

  const scoreTrendCfg = useMemo(
    () => ({
      type: "line",
      data: { labels: c.scoreTrend.labels, datasets: [{ label: "Avg score", data: c.scoreTrend.data, borderColor: C.blue, backgroundColor: "rgba(26,79,214,0.12)", fill: true, tension: 0.3, spanGaps: true, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: catAxis, y: { suggestedMin: 0, suggestedMax: 100, grid: { color: GRID }, ticks: { color: TICK, font: { size: 10 } } } } },
    }),
    [c.scoreTrend],
  );

  const securityCfg = useMemo(
    () => ({
      type: "bar",
      data: { labels: c.securityByOwasp.labels, datasets: c.securityByOwasp.datasets.map((ds) => ({ label: ds.label, data: ds.data, backgroundColor: SEV_COLOR[ds.label] ?? C.gray })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: TICK, font: { size: 10 }, boxWidth: 10 } } }, scales: { x: { stacked: true, ...catAxis }, y: { stacked: true, ...valAxis } } },
    }),
    [c.securityByOwasp],
  );

  const workItemsCfg = useMemo(
    () => ({
      type: "doughnut",
      data: { labels: c.workItemsByType.labels.map(prettyType), datasets: [{ data: c.workItemsByType.data, backgroundColor: c.workItemsByType.labels.map((_, i) => PIE[i % PIE.length]), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "60%", plugins: { legend: { position: "right", labels: { color: TICK, font: { size: 11 }, boxWidth: 10 } } } },
    }),
    [c.workItemsByType],
  );

  const backlogCfg = useMemo(
    () => ({
      type: "bar",
      data: {
        labels: c.backlogBurn.labels,
        datasets: [
          { label: "Created", data: c.backlogBurn.created, backgroundColor: C.slate, borderRadius: 3, maxBarThickness: 26 },
          { label: "Completed", data: c.backlogBurn.completed, backgroundColor: C.green, borderRadius: 3, maxBarThickness: 26 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: TICK, font: { size: 10 }, boxWidth: 10 } } }, scales: { x: catAxis, y: valAxis } },
    }),
    [c.backlogBurn],
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginTop: 16 }}>
      <ReportChart id="chart-run-volume" title="Run volume by week" config={runVolumeCfg} empty={allZero(c.runVolumeByWeek.data)} />
      <ReportChart id="chart-outcomes" title="Run outcomes" config={outcomesCfg} empty={allZero(c.outcomes.data)} />
      <ReportChart id="chart-time-to-pr" title="Time to PR — daily average (hours)" config={timeToPrCfg} empty={allZero(c.timeToPrDaily.data)} wide />
      <ReportChart id="chart-agent-win" title="Agent win rate (commits)" config={agentWinCfg} empty={allZero(c.agentWinRate.data)} />
      <ReportChart id="chart-score-trend" title="Synthesis score trend" config={scoreTrendCfg} empty={allZero(c.scoreTrend.data)} />
      <ReportChart id="chart-security-owasp" title="Security findings by OWASP category" config={securityCfg} empty={c.securityByOwasp.datasets.every((ds) => allZero(ds.data))} />
      <ReportChart id="chart-work-items" title="Work items by type" config={workItemsCfg} empty={allZero(c.workItemsByType.data)} />
      <ReportChart id="chart-backlog-burn" title="Backlog burn — created vs completed" config={backlogCfg} empty={allZero(c.backlogBurn.created) && allZero(c.backlogBurn.completed)} wide />
    </div>
  );
}
