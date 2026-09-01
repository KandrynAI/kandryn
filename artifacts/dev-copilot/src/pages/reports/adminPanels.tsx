import { useLocation } from "wouter";
import { ArrowUpRight, ShieldX } from "lucide-react";
import {
  fetchParkedRuns,
  fetchRepoHealth,
  fetchAegisFailures,
  fetchAegisOverrides,
  fetchBaselineScanReport,
  fetchFailedByStage,
  fetchConfigAudit,
  fetchAccessChanges,
  type RepoHealth,
  type ConfigAuditRepo,
  type AccessChange,
} from "@/services/api";
import type { RangeDays, Scope, Tone } from "@/components/reports/shared";
import { ReportPanel, PanelState, StatusPill, StatusDot, usePanelData, Row, age } from "@/components/reports/shared";

// The four Reporting Phase A diagnostic panels. Each fetches independently and
// wraps its body in PanelState, so one panel failing never blanks the others,
// and "empty" and "broken" always read differently. `scope` is a projectId or
// "all"; time-bounded panels also take `days`. The three-state hook + row/age
// helpers live in components/reports/shared.tsx (shared with the manager panels).

const scopeArg = (scope: Scope): number | undefined => (scope === "all" ? undefined : scope);

// ── 2.1 Stuck & Parked Runs ────────────────────────────────────────────────
export function ParkedRunsPanel({ scope }: { scope: Scope }) {
  const [, navigate] = useLocation();
  const { data, loading, error, reload } = usePanelData(() => fetchParkedRuns(scopeArg(scope)), [scope]);
  const items = data?.items ?? [];

  return (
    <ReportPanel
      title="Stuck & parked runs"
      subtitle="Runs held by the confidence gate, awaiting a human decision — oldest first."
      action={items.length > 0 ? <StatusPill tone="amber" label={`${items.length} waiting`} /> : undefined}
    >
      <PanelState loading={loading} error={error} isEmpty={items.length === 0} onRetry={reload} emptyLabel="Nothing is parked for review.">
        {items.map((r) => (
          <Row key={r.runId}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {r.externalId && <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{r.externalId}</span>}
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.workItemTitle ?? `Run #${r.runId}`}
                </span>
              </div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
                {r.projectName ?? "—"} · {r.triggerContext === "remediation" ? "remediation" : r.trigger} · parked {age(r.createdAt)}
              </div>
            </div>
            <button
              onClick={() => navigate(`/runs/${r.runId}`)}
              className="bm-ghost"
              style={{ fontSize: "var(--fs-xs)", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
            >
              Review <ArrowUpRight size={12} />
            </button>
          </Row>
        ))}
      </PanelState>
    </ReportPanel>
  );
}

// ── 2.2 Repository Health ───────────────────────────────────────────────────
function graphTone(r: RepoHealth): { tone: Tone; label: string } {
  if (r.graphStatus === "succeeded") {
    return r.graphFresh
      ? { tone: "green", label: `Graph fresh · ${r.graphAgeHours ?? 0}h` }
      : { tone: "amber", label: `Graph stale · ${r.graphAgeHours != null ? Math.round(r.graphAgeHours / 24) + "d" : "?"}` };
  }
  if (r.graphStatus === "indexing") return { tone: "amber", label: "Indexing…" };
  if (r.graphStatus === "failed") return { tone: "red", label: "Graph failed" };
  if (r.graphStatus === "stale") return { tone: "red", label: "Graph invalidated" };
  return { tone: "muted", label: "No graph" };
}

export function RepoHealthPanel({ scope }: { scope: Scope }) {
  const { data, loading, error, reload } = usePanelData(() => fetchRepoHealth(scopeArg(scope)), [scope]);
  const items = data?.items ?? [];

  return (
    <ReportPanel title="Repository health" subtitle="Graph freshness, reconfiguration flags, and last security scan per repo.">
      <PanelState loading={loading} error={error} isEmpty={items.length === 0} onRetry={reload} emptyLabel="No repositories connected.">
        {items.map((r) => {
          const g = graphTone(r);
          return (
            <Row key={r.repositoryId}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.name}
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginLeft: 6 }}>{r.provider}</span>
                </div>
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
                  {r.projectName ?? "unbound"} · last scan {r.lastAegisScanAt ? age(r.lastAegisScanAt) : "never"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {r.needsReconfiguration && <StatusPill tone="red" label="Needs reconfig" />}
                {r.needsVerification && <StatusPill tone="amber" label="Unverified" />}
                <StatusPill tone={g.tone} label={g.label} />
              </div>
            </Row>
          );
        })}
      </PanelState>
    </ReportPanel>
  );
}

// ── 2.3 Aegis Gate Failures ─────────────────────────────────────────────────
export function AegisFailuresPanel({ scope, days }: { scope: Scope; days: RangeDays }) {
  const [, navigate] = useLocation();
  const { data, loading, error, reload } = usePanelData(() => fetchAegisFailures(scopeArg(scope), days), [scope, days]);
  const items = data?.items ?? [];

  return (
    <ReportPanel
      title="Aegis gate failures"
      subtitle={`Security gate blocks in the last ${days} days — findings or unscanned files.`}
      action={items.length > 0 ? <StatusPill tone="red" label={`${items.length} blocked`} /> : undefined}
    >
      <PanelState loading={loading} error={error} isEmpty={items.length === 0} onRetry={reload} emptyLabel="No gate failures in this window.">
        {items.map((f, i) => (
          <Row key={`${f.runId}-${i}`}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>
                {f.projectName ?? "—"} {f.runId != null && <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>· run #{f.runId}</span>}
              </div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
                {f.criticalCount > 0 && <span style={{ color: "var(--c-red)" }}>{f.criticalCount} critical </span>}
                {f.highCount > 0 && <span style={{ color: "var(--c-amber)" }}>{f.highCount} high </span>}
                {f.unscannedFiles.length > 0 && <span>· {f.unscannedFiles.length} unscanned </span>}
                · {age(f.createdAt)}
              </div>
            </div>
            {f.runId != null && (
              <button
                onClick={() => navigate(`/runs/${f.runId}`)}
                className="bm-ghost"
                style={{ fontSize: "var(--fs-xs)", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
              >
                Open <ArrowUpRight size={12} />
              </button>
            )}
          </Row>
        ))}
      </PanelState>
    </ReportPanel>
  );
}

// ── 2.3b Aegis Gate Overrides (0034) ────────────────────────────────────────

/**
 * Every security gate an admin cleared, with the reason they gave.
 *
 * A self-override — the same person triggered the run and cleared its gate — is
 * flagged rather than hidden. It is legitimate for a sole operator, which is
 * precisely why an admin needs to be able to see how often it happens and on
 * what grounds. The panel's header pill counts them.
 */
export function AegisOverridesPanel({ scope, days }: { scope: Scope; days: RangeDays }) {
  const [, navigate] = useLocation();
  const { data, loading, error, reload } = usePanelData(() => fetchAegisOverrides(scopeArg(scope), days), [scope, days]);
  const items = data?.items ?? [];
  const selfOverrides = data?.selfOverrides ?? 0;

  return (
    <ReportPanel
      title="Security gate overrides"
      subtitle={`Blocked gates cleared by an admin in the last ${days} days, and why.`}
      action={
        items.length > 0 ? (
          <StatusPill
            tone={selfOverrides > 0 ? "red" : "amber"}
            label={selfOverrides > 0 ? `${items.length} overridden · ${selfOverrides} self` : `${items.length} overridden`}
          />
        ) : undefined
      }
    >
      <PanelState loading={loading} error={error} isEmpty={items.length === 0} onRetry={reload} emptyLabel="No gates were overridden in this window.">
        {items.map((o) => (
          <Row key={o.id}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {o.projectName ?? "—"}
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>· run #{o.runId}</span>
                {o.sameActor && (
                  <span
                    title="The same person triggered this run and cleared its security gate."
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-xs)", fontWeight: 600, padding: "1px 7px", borderRadius: 999, background: "var(--c-red-bg)", color: "var(--c-red)" }}
                  >
                    <ShieldX size={11} />
                    Self-override
                  </span>
                )}
              </div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 2 }}>
                <span style={{ fontFamily: "var(--mono)" }}>{o.overriddenBy}</span>
                {o.criticalCount > 0 && <span style={{ color: "var(--c-red)" }}> · {o.criticalCount} critical</span>}
                {o.highCount > 0 && <span style={{ color: "var(--c-amber)" }}> · {o.highCount} high</span>}
                {o.unscannedCount > 0 && <span> · {o.unscannedCount} unscanned</span>}
                {!o.statusReposted && <span> · check not re-posted</span>}
                {" · "}{age(o.createdAt)}
              </div>
              {/* The reason verbatim — the whole point of the record. */}
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", marginTop: 3, lineHeight: 1.5 }}>“{o.reason}”</div>
            </div>
            <button
              onClick={() => navigate(`/runs/${o.runId}`)}
              className="bm-ghost"
              style={{ fontSize: "var(--fs-xs)", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
            >
              Open <ArrowUpRight size={12} />
            </button>
          </Row>
        ))}
      </PanelState>
    </ReportPanel>
  );
}

// ── 2.3c Baseline scans (0035) ──────────────────────────────────────────────

/**
 * Baseline scans per repository — the latest scan of each, its coverage, and
 * how much of what it found has been triaged.
 *
 * A separate panel on purpose. A baseline finding is pre-existing code; a
 * gate-blocked run is a change stopped on its way to merge. They answer
 * different questions, and merging them would quietly inflate the gate numbers
 * with things that blocked nothing.
 */
export function BaselineScansPanel({ scope, days }: { scope: Scope; days: RangeDays }) {
  const [, navigate] = useLocation();
  const { data, loading, error, reload } = usePanelData(() => fetchBaselineScanReport(scopeArg(scope), days), [scope, days]);
  const items = data?.items ?? [];
  const openTotal = items.reduce((n, i) => n + i.triage.open, 0);

  return (
    <ReportPanel
      title="Baseline scans"
      subtitle="Existing code scanned at connection time. Separate from the merge-path gate numbers above."
      action={items.length > 0 ? <StatusPill tone={openTotal > 0 ? "amber" : "green"} label={`${openTotal} untriaged`} /> : undefined}
    >
      <PanelState loading={loading} error={error} isEmpty={items.length === 0} onRetry={reload} emptyLabel="No codebase has been baseline-scanned yet.">
        {items.map((s) => (
          <Row key={s.id}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>
                {s.repositoryName}
                {s.projectName && <span style={{ color: "var(--c-ink-4)" }}> · {s.projectName}</span>}
              </div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 2 }}>
                {s.status === "succeeded" ? (
                  <>
                    scanned {s.filesScanned}/{s.filesTotal} files
                    {s.criticalCount > 0 && <span style={{ color: "var(--c-red)" }}> · {s.criticalCount} critical</span>}
                    {s.highCount > 0 && <span style={{ color: "var(--c-amber)" }}> · {s.highCount} high</span>}
                    {" · "}
                    {s.triage.open} open · {s.triage.acknowledged} acknowledged · {s.triage.pushed} filed
                  </>
                ) : (
                  <span style={{ color: s.status === "failed" ? "var(--c-red)" : "var(--c-ink-4)" }}>{s.status}</span>
                )}
                {" · "}{age(s.finishedAt ?? s.createdAt)}
              </div>
            </div>
            <button
              onClick={() => navigate(`/repositories/${s.repositoryId}`)}
              className="bm-ghost"
              style={{ fontSize: "var(--fs-xs)", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
            >
              Open <ArrowUpRight size={12} />
            </button>
          </Row>
        ))}
      </PanelState>
    </ReportPanel>
  );
}

// ── 2.4 Failed Runs by Stage ────────────────────────────────────────────────
const STAGE_META: { key: "planning" | "commit" | "coherenceExcluded" | "aegisBlocked"; label: string; hint: string }[] = [
  { key: "planning", label: "Planning", hint: "plan generation failed" },
  { key: "commit", label: "Generation / commit", hint: "failed after planning" },
  { key: "coherenceExcluded", label: "Coherence-excluded", hint: "a suggestion failed the coherence gate" },
  { key: "aegisBlocked", label: "Aegis-blocked", hint: "security gate blocked" },
];

export function FailedByStagePanel({ scope, days }: { scope: Scope; days: RangeDays }) {
  const { data, loading, error, reload } = usePanelData(() => fetchFailedByStage(scopeArg(scope), days), [scope, days]);
  const stages = data?.stages;

  return (
    <ReportPanel
      title="Failed runs by stage"
      subtitle={`Where runs fell over in the last ${days} days${data ? ` · ${data.totalRuns} runs total` : ""}. Buckets are derived signals and may overlap.`}
    >
      <PanelState loading={loading} error={error} isEmpty={!stages} onRetry={reload}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, padding: "6px 14px 10px" }}>
          {STAGE_META.map((s) => (
            <div key={s.key} style={{ border: "1px solid var(--c-border)", borderRadius: 8, background: "var(--c-surface)", padding: "12px 14px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>{s.label}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xl)", fontWeight: 600, color: "var(--c-ink)" }}>
                {stages?.[s.key].count ?? 0}
              </div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{s.hint}</div>
            </div>
          ))}
        </div>
      </PanelState>
    </ReportPanel>
  );
}

// ── 3.1 Configuration Audit ─────────────────────────────────────────────────
/** A labelled group of config issues sharing one tone + resolution link. */
function IssueGroup({ label, tone, rows }: { label: string; tone: Tone; rows: { key: number; title: string; sub: string; href: string }[] }) {
  const [, navigate] = useLocation();
  if (rows.length === 0) return null;
  return (
    <div>
      <div style={{ padding: "6px 14px 2px" }}>
        <StatusPill tone={tone} label={`${label} · ${rows.length}`} />
      </div>
      {rows.map((r) => (
        <Row key={r.key}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{r.sub}</div>
          </div>
          <button onClick={() => navigate(r.href)} className="bm-ghost" style={{ fontSize: "var(--fs-xs)", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            Fix <ArrowUpRight size={12} />
          </button>
        </Row>
      ))}
    </div>
  );
}

const repoRow = (r: ConfigAuditRepo, sub: string) => ({
  key: r.repositoryId,
  title: r.name,
  sub: `${r.projectName ?? "unbound"} · ${sub}`,
  href: `/repositories/${r.repositoryId}`,
});

export function ConfigAuditPanel({ scope }: { scope: Scope }) {
  const { data, loading, error, reload } = usePanelData(() => fetchConfigAudit(scopeArg(scope)), [scope]);
  const total = data
    ? data.staleGraphs.length + data.unverifiedRepos.length + data.needsReconfigRepos.length + data.projectsWithoutRepo.length
    : 0;

  return (
    <ReportPanel title="Configuration audit" subtitle="Structural drift across repositories and projects that needs attention.">
      <PanelState loading={loading} error={error} isEmpty={total === 0} onRetry={reload} emptyLabel="Configuration looks healthy.">
        {data && (
          <>
            <IssueGroup label="Graph invalidated" tone="red" rows={data.staleGraphs.map((r) => repoRow(r, "URL changed — rebuild the graph"))} />
            <IssueGroup label="Needs reconfiguration" tone="red" rows={data.needsReconfigRepos.map((r) => repoRow(r, "repository URL was cleared"))} />
            <IssueGroup label="Unverified" tone="amber" rows={data.unverifiedRepos.map((r) => repoRow(r, "confirm after migration"))} />
            <IssueGroup
              label="No repository"
              tone="amber"
              rows={data.projectsWithoutRepo.map((p) => ({ key: p.projectId, title: p.name, sub: "project has no repository bound", href: `/p/${p.projectId}/board` }))}
            />
            <div style={{ padding: "10px 14px 4px", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", borderTop: "1px solid var(--c-border)" }}>
              Credential expiry isn't tracked yet — integration health is verified on use (Settings → Integrations).
            </div>
          </>
        )}
      </PanelState>
    </ReportPanel>
  );
}

// ── 3.2 Access & Change Audit ───────────────────────────────────────────────
// A curated slice of the audit log — labels/summaries for just these actions.
// The full log lives in Settings → Audit, which the panel footer links to.
const ACCESS_LABELS: Record<string, string> = {
  "member.invited": "Member invited",
  "member.joined": "Member joined",
  "member.removed": "Member removed",
  "member.role_changed": "Role changed",
  "invite.canceled": "Invite canceled",
  "team.updated": "Team updated",
  "project.updated": "Project settings changed",
  "run.override_committed": "Committed past coherence gate",
  "team_credential.set": "Team credential saved",
  "team_credential.deleted": "Team credential deleted",
};

function accessDot(action: string): Tone {
  if (action.includes("credential")) return "amber";
  if (action === "run.override_committed" || action === "project.updated") return "amber";
  if (action === "member.removed" || action === "invite.canceled") return "red";
  return "muted";
}

function accessSummary(a: AccessChange): string {
  const m = a.metadata ?? {};
  switch (a.action) {
    case "member.invited":
      return `${m.email ?? ""} as ${m.role ?? ""}`;
    case "member.role_changed":
      return `→ ${m.newRole ?? ""}`;
    case "member.removed":
      return String(m.removedUserId ?? "");
    case "project.updated":
      return m.confidenceThreshold && typeof m.confidenceThreshold === "object"
        ? `confidence threshold ${(m.confidenceThreshold as { from?: unknown }).from ?? "?"} → ${(m.confidenceThreshold as { to?: unknown }).to ?? "?"}`
        : "settings changed";
    case "run.override_committed":
      return `suggestion #${m.suggestionId ?? "?"} · ${m.findingsSummary ?? "coherence override"}`;
    case "team_credential.set":
    case "team_credential.deleted":
      return `key: ${m.key ?? ""}`;
    default:
      return "";
  }
}

export function AccessChangePanel({ days }: { days: RangeDays }) {
  const [, navigate] = useLocation();
  const { data, loading, error, reload } = usePanelData(() => fetchAccessChanges(days), [days]);
  const items = data?.items ?? [];

  return (
    <ReportPanel
      title="Access & change audit"
      subtitle={`Membership, role, and governance-sensitive changes in the last ${days} days.`}
      action={
        <button onClick={() => navigate("/settings?tab=audit")} className="bm-ghost" style={{ fontSize: "var(--fs-xs)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          Full audit log <ArrowUpRight size={12} />
        </button>
      }
    >
      <PanelState loading={loading} error={error} isEmpty={items.length === 0} onRetry={reload} emptyLabel="No access or governance changes in this window.">
        {items.map((a) => {
          const summary = accessSummary(a);
          return (
            <Row key={a.id}>
              <StatusDot tone={accessDot(a.action)} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>
                  {ACCESS_LABELS[a.action] ?? a.action}
                  {summary && <span style={{ color: "var(--c-ink-4)", fontWeight: 400 }}> · {summary}</span>}
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--c-ink-4)" }}>{a.userId}</div>
              </div>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", flexShrink: 0 }}>{age(a.createdAt)}</span>
            </Row>
          );
        })}
      </PanelState>
    </ReportPanel>
  );
}
