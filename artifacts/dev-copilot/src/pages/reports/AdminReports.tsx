import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTeam } from "@/context/TeamContext";
import type { Project } from "@/services/api";
import { RangePills, ReportScope, type RangeDays, type Scope } from "@/components/reports/shared";
import {
  ParkedRunsPanel,
  RepoHealthPanel,
  AegisFailuresPanel,
  AegisOverridesPanel,
  BaselineScansPanel,
  FailedByStagePanel,
  ConfigAuditPanel,
  AccessChangePanel,
} from "@/pages/reports/adminPanels";

/**
 * Admin reports (Reporting Phase A). PR 1 laid out the shell — role gate, the
 * cross-project scope selector, and the time-range pills — plus the shared
 * component kit. PR 2 mounted the four operational panels (Stuck & Parked,
 * Repository Health, Aegis Gate Failures, Failed Runs by Stage). PR 3 adds
 * Configuration Audit + Access & Change Audit below; Security Gate Overrides
 * (0034) sits with the Aegis panels. Each panel reads `scope` +
 * `days` and fetches independently; parked runs — the one with a real action —
 * leads, above the diagnostics.
 */
export function AdminReports({ projects }: { projects: Project[] }) {
  const { isAdmin } = useTeam();
  const [scope, setScope] = useState<Scope>("all");
  const [days, setDays] = useState<RangeDays>(30);

  // Non-admins never see the Admin nav item, but guard the body too.
  if (!isAdmin) {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--c-ink-4)" }}>
        <ShieldAlert size={20} style={{ margin: "0 auto 8px", display: "block" }} />
        Admin reports are available to team admins only.
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-xl)", fontWeight: 700, color: "var(--c-ink)", margin: 0, letterSpacing: "-0.01em" }}>Admin reports</h1>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", margin: "4px 0 0" }}>Operational health across the team's projects.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <ReportScope projects={projects} value={scope} onChange={setScope} />
          <RangePills value={days} onChange={setDays} />
        </div>
      </div>

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Parked runs lead — the one panel with a real action. Then diagnostics. */}
        <ParkedRunsPanel scope={scope} />
        <RepoHealthPanel scope={scope} />
        <AegisFailuresPanel scope={scope} days={days} />
        <AegisOverridesPanel scope={scope} days={days} />
        <BaselineScansPanel scope={scope} days={days} />
        <FailedByStagePanel scope={scope} days={days} />
        <ConfigAuditPanel scope={scope} />
        <AccessChangePanel days={days} />
      </div>
    </div>
  );
}
