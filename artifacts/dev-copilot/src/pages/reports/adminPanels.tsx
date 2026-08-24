import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight } from "lucide-react";
import {
  ApiError,
  fetchParkedRuns,
  fetchRepoHealth,
  fetchAegisFailures,
  fetchFailedByStage,
  type RepoHealth,
} from "@/services/api";
import type { RangeDays, Scope, Tone } from "@/components/reports/shared";
import { ReportPanel, PanelState, StatusPill } from "@/components/reports/shared";

// The four Reporting Phase A diagnostic panels. Each fetches independently and
// wraps its body in PanelState, so one panel failing never blanks the others,
// and "empty" and "broken" always read differently. `scope` is a projectId or
// "all"; time-bounded panels also take `days`.

/** Shared fetch-with-retry for a panel. `deps` drives refetch; retry bumps a nonce. */
function usePanelData<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "Network error — check your connection."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

const scopeArg = (scope: Scope): number | undefined => (scope === "all" ? undefined : scope);

/** A single dense list row. */
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderTop: "1px solid var(--c-border)" }}>
      {children}
    </div>
  );
}

function age(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

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
