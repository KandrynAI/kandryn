import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, ArrowDownRight, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, type Project } from "@/services/api";

// Shared building blocks for the Reports screen. Colors come from the existing
// index.css tokens (--c-green/amber/red + -bg) — no new palette.

/** Fetch-with-retry for a report panel. `deps` drives refetch; retry bumps a
 *  nonce. Shared by the admin diagnostics and manager panels so every panel gets
 *  the same three-state (loading / error / data) behaviour. */
export function usePanelData<T>(fetcher: () => Promise<T>, deps: unknown[]) {
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

/** A single dense list row inside a ReportPanel. */
export function Row({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderTop: "1px solid var(--c-border)" }}>
      {children}
    </div>
  );
}

/** Relative age of an ISO timestamp, e.g. "3 days ago". Empty on bad input. */
export function age(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

export type RangeDays = 7 | 30 | 90;
export const RANGES: RangeDays[] = [7, 30, 90];

/** 7d/30d/90d pills, matching the audit-log / ReportsPage pill pattern exactly. */
export function RangePills({ value, onChange }: { value: RangeDays; onChange: (d: RangeDays) => void }) {
  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      {RANGES.map((d) => {
        const active = d === value;
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            style={{
              fontSize: "var(--fs-xs)",
              padding: "3px 10px",
              borderRadius: 999,
              border: "1px solid var(--c-border)",
              background: active ? "var(--c-blue-bg)" : "transparent",
              color: active ? "var(--c-blue)" : "var(--c-ink-3)",
              fontWeight: active ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {d}d
          </button>
        );
      })}
    </div>
  );
}

export type Scope = number | "all";

/** "All projects ▾" scope selector. Cross-project by design — not tied to the
 *  active-project provider (which resolves a single project). */
export function ReportScope({ projects, value, onChange }: { projects: Project[]; value: Scope; onChange: (s: Scope) => void }) {
  return (
    <select
      value={value === "all" ? "all" : String(value)}
      onChange={(e) => onChange(e.target.value === "all" ? "all" : Number(e.target.value))}
      style={{
        fontSize: "var(--fs-sm)",
        padding: "5px 8px",
        borderRadius: 6,
        border: "1px solid var(--c-border)",
        background: "var(--c-bg)",
        color: "var(--c-ink)",
      }}
    >
      <option value="all">All projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/** Tiny inline sparkline. Empty/1-point series render nothing. */
export function Sparkline({ points, width = 72, height = 20, color = "var(--c-blue)" }: { points: number[]; width?: number; height?: number; color?: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points.map((p, i) => `${i * step},${height - ((p - min) / span) * height}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

/** Stat card: number + label, optional trend arrow + delta, optional sparkline. */
export function StatCard({ label, value, delta, spark }: { label: string; value: string | number; delta?: number | null; spark?: number[] }) {
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  const deltaColor = up ? "var(--c-green)" : down ? "var(--c-red)" : "var(--c-ink-4)";
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 8, background: "var(--c-surface)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xl)", fontWeight: 600, color: "var(--c-ink)" }}>{value}</span>
        {delta != null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: "var(--fs-xs)", color: deltaColor }}>
            {up ? <ArrowUpRight size={12} /> : down ? <ArrowDownRight size={12} /> : null}
            {Math.abs(delta)}
          </span>
        )}
      </div>
      {spark && spark.length > 1 && <Sparkline points={spark} />}
    </div>
  );
}

export type Tone = "green" | "amber" | "red" | "muted";
const TONE: Record<Tone, { fg: string; bg: string }> = {
  green: { fg: "var(--c-green)", bg: "var(--c-green-bg)" },
  amber: { fg: "var(--c-amber)", bg: "var(--c-amber-bg)" },
  red: { fg: "var(--c-red)", bg: "var(--c-red-bg)" },
  muted: { fg: "var(--c-ink-4)", bg: "var(--c-raised)" },
};

export function StatusDot({ tone }: { tone: Tone }) {
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: TONE[tone].fg, display: "inline-block", flexShrink: 0 }} />;
}

export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const t = TONE[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--fs-xs)", fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: t.bg, color: t.fg }}>
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

/** A titled report panel card. `action` is an optional right-aligned node. */
export function ReportPanel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ border: "1px solid var(--c-border)", borderRadius: 8, background: "var(--c-surface)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--c-border)" }}>
        <div>
          <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-ink)" }}>{title}</div>
          {subtitle && <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{subtitle}</div>}
        </div>
        {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
      </div>
      <div style={{ padding: "8px 0" }}>{children}</div>
    </section>
  );
}

/**
 * The three-state wrapper: skeleton while loading, a red retry banner on error,
 * an illustrated empty state when there's no data, else the children. Every
 * report panel uses this so "empty" and "broken" never look the same.
 */
export function PanelState({
  loading,
  error,
  isEmpty,
  onRetry,
  emptyLabel = "Nothing to show.",
  children,
}: {
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  onRetry: () => void;
  emptyLabel?: string;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ margin: "8px 14px", border: "1px solid var(--c-red)", background: "var(--c-red-bg)", borderRadius: 6, padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--c-red)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>
          <AlertTriangle size={14} /> Couldn't load this panel
        </div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", margin: "4px 0 8px" }}>{error}</div>
        <button className="bm-ghost" onClick={onRetry} style={{ fontSize: "var(--fs-xs)" }}>
          <RotateCcw size={12} /> Retry
        </button>
      </div>
    );
  }
  if (isEmpty) {
    return <div style={{ padding: "20px 14px", textAlign: "center", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>{emptyLabel}</div>;
  }
  return <>{children}</>;
}
