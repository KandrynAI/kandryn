import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Printer, ArrowLeft, ShieldCheck, UserCheck, Clock, Network, Database, Users } from "lucide-react";
import { fetchProject, type Project } from "@/services/api";
import { useTeam } from "@/context/TeamContext";

/**
 * Governance policy (Item 3) — a read-only, screenshot-ready summary of the
 * project's human-in-the-loop and gating controls, compiled from existing
 * settings/behavior (no new config). Copy is deliberately ACCURATE for a
 * customer security questionnaire: the confidence gate is per-project; the Aegis
 * merge-block is a capability that requires branch-protection config; the
 * coherence gate currently covers C#. Items 5/6 append their controls here.
 */

function Control({
  icon: Icon,
  title,
  status,
  statusTone,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  status: string;
  statusTone: "on" | "conditional" | "off";
  children: React.ReactNode;
}) {
  const toneColor = statusTone === "on" ? "var(--c-green)" : statusTone === "conditional" ? "var(--c-amber)" : "var(--c-ink-4)";
  const toneBg = statusTone === "on" ? "var(--c-green-bg)" : statusTone === "conditional" ? "var(--c-amber-bg)" : "var(--c-raised)";
  return (
    <section style={{ border: "1px solid var(--c-border)", borderRadius: 8, background: "var(--c-surface)", padding: "14px 16px", breakInside: "avoid" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon size={16} style={{ color: "var(--c-ink-3)", flexShrink: 0 }} />
        <span style={{ fontSize: "var(--fs-base)", fontWeight: 700, color: "var(--c-ink)" }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", fontWeight: 600, color: toneColor, background: toneBg, padding: "2px 9px", borderRadius: 999 }}>{status}</span>
      </div>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", margin: "8px 0 0", lineHeight: 1.55 }}>{children}</p>
    </section>
  );
}

export default function GovernancePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const { effectiveAuditRetentionDays } = useTeam();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchProject(projectId)
      .then(setProject)
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div style={{ padding: 24, color: "var(--c-ink-4)" }}>Loading…</div>;
  if (!project) return <div style={{ padding: 24, color: "var(--c-ink-4)" }}>Project not found.</div>;

  const thresholdPct = Math.round(Number(project.confidenceThreshold) * 100);
  const gateOn = thresholdPct > 0;

  return (
    <div style={{ padding: "20px 24px 48px", maxWidth: 780 }}>
      <div className="screen-only" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Link href={`/projects/${projectId}/settings`} className="bm-ghost" style={{ border: "none", padding: "2px 0", color: "var(--c-ink-3)" }}>
          <ArrowLeft size={12} />Project settings
        </Link>
        <button className="bm-ghost" onClick={() => window.print()} title="Export as PDF">
          <Printer size={13} />Export PDF
        </button>
      </div>

      <h1 style={{ fontSize: "var(--fs-xl)", fontWeight: 700, color: "var(--c-ink)", margin: 0, letterSpacing: "-0.01em" }}>Governance policy</h1>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", margin: "4px 0 20px" }}>
        {project.name} · human-in-the-loop and safety controls in effect for AI-generated changes.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Control
          icon={UserCheck}
          title="Human review of low-confidence changes"
          status={gateOn ? "Active" : "Off"}
          statusTone={gateOn ? "on" : "off"}
        >
          {gateOn
            ? `Before any code is generated, Blue Mantis scores its confidence in the change plan. Plans scoring below ${thresholdPct}% confidence pause and require explicit human approval before generation proceeds. A reviewer can approve, edit, or reject the plan.`
            : `The confidence gate is disabled for this project (threshold 0%). Change plans generate without a pre-generation review. Set a confidence threshold in project settings to require human approval below it.`}
        </Control>

        <Control
          icon={Clock}
          title="Unattended (scheduled) runs"
          status={gateOn ? "Pauses & notifies" : "Runs unattended"}
          statusTone={gateOn ? "on" : "off"}
        >
          {gateOn
            ? `Scheduled runs are held to the same threshold. A scheduled run whose plan scores below ${thresholdPct}% confidence pauses and notifies the project owner rather than generating code unattended — it waits for a human decision instead of proceeding automatically.`
            : `With the confidence gate off, scheduled runs generate without pausing for review.`}
        </Control>

        <Control
          icon={Users}
          title="Segregation of duties"
          status={project.requireSecondApprover ? "Enforced" : "Off"}
          statusTone={project.requireSecondApprover ? "on" : "off"}
        >
          {project.requireSecondApprover
            ? "When a change plan is paused for review, the person who triggered the run may not approve it — a different team admin must. The trigger-er and the approver are recorded distinctly on every approved run, so separation of duties is an auditable fact."
            : "Not enforced for this project — the person who triggers a run may also approve its paused plan. Enable a second approver in project settings to require separate individuals for trigger and approval."}
        </Control>

        <Control
          icon={ShieldCheck}
          title="Security scanning gate"
          status="Fail-closed, config-gated"
          statusTone="conditional"
        >
          Committed changes can be scanned for security vulnerabilities across every changed file. Any High or Critical
          finding — or a file that cannot be scanned — fails the security check (fail-closed: an unscannable file blocks
          rather than being waved through). When Blue Mantis&#39;s security status check is configured as a{" "}
          <em>required</em> status in the repository&#39;s branch-protection rules, a failing scan blocks the merge.
        </Control>

        <Control
          icon={Network}
          title="Structural coherence gate"
          status="Active (C#)"
          statusTone="on"
        >
          Multi-file changes are statically analyzed for cross-file structural coherence (that interfaces, call sites,
          and type references line up across the changed files). Incoherent changes are excluded from being recommended
          and blocked from automatic commit, so a human reviews them first. This structural analysis currently covers
          C#; changes in other languages pass through to human review without this automated gate.
        </Control>

        <Control
          icon={Database}
          title="Audit-log retention"
          status={effectiveAuditRetentionDays != null ? `${effectiveAuditRetentionDays} days` : "—"}
          statusTone="on"
        >
          Every significant action — sign-ins, credential changes, runs, commits, security scans, membership and role
          changes — is recorded in an append-only audit log. The log cannot be edited or deleted through the application;
          entries age out only by the retention policy.
          {effectiveAuditRetentionDays != null
            ? ` This team retains audit history for ${effectiveAuditRetentionDays} days; admins can extend it for regulated retention (Settings → Team).`
            : ""}
        </Control>
      </div>

      <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 20, lineHeight: 1.5 }}>
        Compiled from this project&#39;s current settings on {new Date().toLocaleDateString()}. The confidence threshold is
        configurable per project; the security and coherence gates are pipeline-wide behaviors.
      </p>
    </div>
  );
}
