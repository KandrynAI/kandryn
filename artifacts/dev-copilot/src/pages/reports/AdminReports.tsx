import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTeam } from "@/context/TeamContext";
import type { Project } from "@/services/api";
import { RangePills, ReportScope, type RangeDays, type Scope } from "@/components/reports/shared";

/**
 * Admin reports (Reporting Phase A). PR 1 lays out the shell — role gate, the
 * cross-project scope selector, and the time-range pills — plus the shared
 * component kit. The six diagnostic panels (Stuck & Parked, Repository Health,
 * Aegis Gate Failures, Failed Runs by Stage, Configuration Audit, Access &
 * Change Audit) are filled in PR 2/PR 3, each reading `scope` + `days`.
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
        {/* PR 2/PR 3 mount the panels here, each scoped to `scope` + `days`. */}
        <div style={{ border: "1px dashed var(--c-border)", borderRadius: 8, padding: "28px 16px", textAlign: "center", color: "var(--c-ink-4)", fontSize: "var(--fs-sm)" }}>
          Diagnostic panels load here.
        </div>
      </div>
    </div>
  );
}
