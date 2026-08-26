import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Printer, ShieldCheck, LineChart } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiRow } from "@/components/reports/KpiRow";
import { ChartsGrid } from "@/components/reports/ChartsGrid";
import { AdminReports } from "@/pages/reports/AdminReports";
import { ExecutiveReports } from "@/pages/reports/ExecutiveReports";
import {
  PlanAcceptancePanel,
  RetrievalAttributionPanel,
  CoherencePanel,
  ConfidenceDistributionPanel,
  AgentWinPanel,
  ThroughputPanel,
  TimeToPrPanel,
  PlanningCostPanel,
  SecurityPosturePanel,
} from "@/pages/reports/managerPanels";
import { useTeam } from "@/context/TeamContext";
import { fetchReportSummary, fetchProjects, type ReportData, type Project } from "@/services/api";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function ReportSkeleton() {
  return (
    <div>
      <Skeleton className="h-[76px] w-full rounded-lg" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginTop: 16 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-[260px] w-full rounded-lg" style={i === 2 || i === 5 ? { gridColumn: "1 / -1" } : undefined} />
        ))}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const params = useParams<{ tab?: string }>();
  const [, navigate] = useLocation();
  const { isAdmin } = useTeam();
  const [days, setDays] = useState(30);
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (params.tab === "admin" || params.tab === "executive") return; // those tabs fetch their own data
    setLoading(true);
    setError(false);
    fetchReportSummary(days, projectId)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [days, projectId, params.tab]);

  // Admin/Executive tabs (role-gated inside their pages) fetch their own data.
  // The default (no tab) keeps the Manager analytics view.
  if (params.tab === "admin") return <AdminReports projects={projects} />;
  if (params.tab === "executive") return <ExecutiveReports projects={projects} />;

  const activeProject = projects.find((p) => p.id === projectId);

  return (
    <div style={{ padding: "20px 24px 40px" }}>
      <style>{`
        .rp-pill {
          font-size: var(--fs-sm); font-weight: 500; padding: 5px 12px; border-radius: 6px;
          border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-ink-3);
          cursor: pointer; transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
        }
        .rp-pill:hover { background: var(--c-raised); }
        .rp-pill.active { background: var(--c-blue-bg); color: var(--c-blue); border-color: var(--c-blue); }
        .rp-select {
          height: 30px; font-size: var(--fs-sm); border: 1px solid var(--c-border); border-radius: 6px;
          background: var(--c-surface); color: var(--c-ink-2); padding: 0 8px;
        }
        .rp-export {
          display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
          font-size: var(--fs-sm); font-weight: 600; border-radius: 6px; cursor: pointer;
          border: 1px solid var(--c-blue); background: var(--c-blue); color: #fff;
        }
        .rp-export:hover { background: var(--c-blue-strong, #1741b0); }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-xl)", fontWeight: 700, color: "var(--c-ink)", margin: 0, letterSpacing: "-0.01em" }}>Reports</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", margin: "4px 0 0" }}>
            {data?.scope === "team" ? "Team-wide delivery metrics" : "Your delivery metrics"}
            {activeProject ? ` · ${activeProject.name}` : ""}
          </p>
        </div>

        <div className="screen-only" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {RANGES.map((r) => (
              <button key={r.days} className={`rp-pill${days === r.days ? " active" : ""}`} onClick={() => setDays(r.days)}>
                {r.label}
              </button>
            ))}
          </div>
          <select
            className="rp-select"
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="rp-export" onClick={() => window.print()} title="Export as PDF">
            <Printer size={14} /> Export PDF
          </button>
          {isAdmin && (
            <>
              <button
                className="rp-pill"
                onClick={() => navigate("/reports/admin")}
                title="Admin diagnostics"
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <ShieldCheck size={13} /> Admin reports
              </button>
              <button
                className="rp-pill"
                onClick={() => navigate("/reports/executive")}
                title="Executive summary"
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <LineChart size={13} /> Executive
              </button>
            </>
          )}
        </div>
      </div>

      {/* Print header (only in the PDF) */}
      <div className="print-only" style={{ marginBottom: 16, fontSize: 12, color: "#334155" }}>
        Blue Mantis — Delivery Report · Last {days} days
        {activeProject ? ` · ${activeProject.name}` : " · All projects"}
      </div>

      <div className="report-content" style={{ marginTop: 18 }}>
        {loading ? (
          <ReportSkeleton />
        ) : error ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--c-ink-4)", fontSize: "var(--fs-base)" }}>
            Couldn't load reports. Try again.
          </div>
        ) : data && data.kpis.totalRuns === 0 && data.charts.workItemsByType.data.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--c-ink-4)", fontSize: "var(--fs-base)" }}>
            No activity in the last {days} days. Run the pipeline on a work item to start collecting metrics.
          </div>
        ) : data ? (
          <>
            <KpiRow kpis={data.kpis} />
            <ChartsGrid data={data} />
          </>
        ) : null}
      </div>

      {/* Delivery quality — Manager panels (Phase B). Independent of the summary
          fetch above; each panel manages its own three-state and reads the same
          range + project scope. */}
      {!error && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--c-ink)", margin: "0 0 12px" }}>Delivery quality</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <PlanAcceptancePanel days={days} projectId={projectId} />
            <RetrievalAttributionPanel days={days} projectId={projectId} />
            <CoherencePanel days={days} projectId={projectId} />
            <ConfidenceDistributionPanel days={days} projectId={projectId} />
            <AgentWinPanel days={days} projectId={projectId} />
            <ThroughputPanel days={days} projectId={projectId} />
            <TimeToPrPanel days={days} projectId={projectId} />
            <PlanningCostPanel days={days} projectId={projectId} />
            <SecurityPosturePanel days={days} projectId={projectId} />
          </div>
        </div>
      )}

      {/* Print footer */}
      <div className="print-only" style={{ marginTop: 20, paddingTop: 10, borderTop: "1px solid #cbd5e1", fontSize: 10, color: "#64748b", display: "flex", justifyContent: "space-between" }}>
        <span>Generated {new Date().toLocaleString()}</span>
        <span>kandryn.com</span>
      </div>
    </div>
  );
}
