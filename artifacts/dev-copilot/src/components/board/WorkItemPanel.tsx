import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { X, ExternalLink, ChevronRight, Play, Clock } from "lucide-react";
import { fetchRunsForItem, type WorkItem, type Run } from "@/services/api";

interface WorkItemPanelProps {
  item: WorkItem | null;
  projectId: number;
  onClose: () => void;
  onRun: (item: WorkItem) => void;
  onSchedule: (item: WorkItem) => void;
}

// priority is stored as a string; map to the P-scale the panel shows.
const PRIORITY: Record<string, { label: string; high: boolean }> = {
  critical: { label: "Priority 1", high: true },
  high: { label: "Priority 2", high: true },
  medium: { label: "Priority 3", high: false },
  low: { label: "Priority 4", high: false },
};

function runBadge(status: Run["status"]): { label: string; bg: string; fg: string } {
  switch (status) {
    case "succeeded":
      return { label: "DONE", bg: "var(--c-green-bg)", fg: "var(--c-green)" };
    case "running":
    case "queued":
      return { label: "RUNNING", bg: "var(--c-blue-bg)", fg: "var(--c-blue)" };
    case "failed":
      return { label: "FAILED", bg: "var(--c-red-bg)", fg: "var(--c-red)" };
    case "scheduled":
      return { label: "SCHED", bg: "var(--c-raised)", fg: "var(--c-ink-3)" };
    default:
      return { label: "CANCELED", bg: "var(--c-raised)", fg: "var(--c-ink-4)" };
  }
}

function plmStatusStyle(raw: string): { bg: string; fg: string } {
  const s = raw.toLowerCase();
  if (s.includes("progress")) return { bg: "var(--c-blue-bg)", fg: "var(--c-blue)" };
  if (s.includes("review")) return { bg: "var(--c-amber-bg)", fg: "var(--c-amber)" };
  if (s.includes("done") || s.includes("closed")) return { bg: "var(--c-green-bg)", fg: "var(--c-green)" };
  return { bg: "var(--c-raised)", fg: "var(--c-ink-3)" };
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const PROVIDER_LABEL: Record<string, string> = { jira: "Jira", "azure-devops": "Azure DevOps" };

const labelStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--c-ink-4)",
  fontWeight: 600,
  marginBottom: 8,
};
const hr = <div style={{ height: 1, background: "var(--c-border)", margin: "14px 0" }} />;

export function WorkItemPanel(props: WorkItemPanelProps) {
  if (!props.item) return null;
  return <PanelInner {...props} item={props.item} />;
}

function PanelInner({ item, onClose, onRun, onSchedule }: WorkItemPanelProps & { item: WorkItem }) {
  const [, navigate] = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: runs, isLoading, isError } = useQuery({
    queryKey: ["runs", "item", item.id],
    queryFn: () => fetchRunsForItem(item.id),
  });

  const priority = PRIORITY[item.priority] ?? { label: `Priority · ${item.priority}`, high: false };
  const acItems = item.acceptanceCriteria
    ? item.acceptanceCriteria.split(/\n/).map((s) => s.trim()).filter(Boolean)
    : [];
  const plmStatus = item.plmStatus ?? item.status;
  const ps = plmStatusStyle(plmStatus);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(20, 22, 24, 0.25)" }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 440,
          maxWidth: "100vw",
          background: "var(--c-bg)",
          borderLeft: "1px solid var(--c-border-s)",
          boxShadow: "-4px 0 20px rgba(0,0,0,0.08)",
          display: "flex",
          flexDirection: "column",
          zIndex: 41,
          animation: "slideInRight 0.2s ease-out both",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className={`bm-type bm-type-${item.itemType}`}>{item.itemType.replace("_", " ")}</span>
              {item.externalId && (
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>{item.externalId}</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: priority.high ? "var(--c-amber)" : "var(--c-border-s)" }} />
              <span style={{ fontSize: "var(--fs-xs)", color: priority.high ? "var(--c-ink-3)" : "var(--c-ink-4)" }}>{priority.label}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            style={{ width: 28, height: 28, flexShrink: 0, border: "1px solid var(--c-border)", borderRadius: 3, background: "transparent", color: "var(--c-ink-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <h2 style={{ fontSize: "var(--fs-xl)", fontWeight: 600, color: "var(--c-ink)", lineHeight: 1.3, marginBottom: 12, textWrap: "pretty" }}>
            {item.title}
          </h2>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
            <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, padding: "2px 7px", borderRadius: 3, background: ps.bg, color: ps.fg }}>{plmStatus}</span>
            {item.plmUrl && (
              <a
                onClick={() => item.plmUrl && window.open(item.plmUrl, "_blank")}
                style={{ fontSize: "var(--fs-xs)", color: "var(--c-blue)", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, textDecoration: "none" }}
              >
                <ExternalLink size={11} />Open in {PROVIDER_LABEL[item.source] ?? "PLM"}
              </a>
            )}
          </div>

          {hr}

          {/* Description */}
          <div style={labelStyle}>Description</div>
          {item.description ? (
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{item.description}</p>
          ) : (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", fontStyle: "italic" }}>No description provided.</p>
          )}

          {hr}

          {/* Acceptance criteria */}
          <div style={labelStyle}>Acceptance criteria</div>
          {acItems.length > 0 ? (
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {acItems.map((c, i) => (
                <li key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid var(--c-border)" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", width: 16, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.5, textWrap: "pretty" }}>{c}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", fontStyle: "italic" }}>No acceptance criteria defined.</p>
          )}

          {hr}

          {/* Run history */}
          <div style={labelStyle}>Run history</div>
          {isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="skeleton" style={{ height: 28, borderRadius: 3 }} />
              <div className="skeleton" style={{ height: 28, borderRadius: 3 }} />
            </div>
          ) : isError ? (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-red)" }}>Could not load run history.</p>
          ) : !runs || runs.length === 0 ? (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>No runs yet for this item.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {runs.slice(0, 10).map((run) => {
                const b = runBadge(run.status);
                return (
                  <div key={run.id} style={{ display: "grid", gridTemplateColumns: "48px 1fr 80px 32px", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--c-border)" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>#{run.id}</span>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{relTime(run.createdAt)}</span>
                    <span style={{ justifySelf: "start", fontSize: "var(--fs-xs)", fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: b.bg, color: b.fg }}>{b.label}</span>
                    <button
                      onClick={() => navigate(`/runs/${run.id}`)}
                      title="View run"
                      style={{ justifySelf: "end", background: "none", border: "none", cursor: "pointer", color: "var(--c-blue)", display: "inline-flex", padding: 0 }}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--c-border)", background: "var(--c-surface)", display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => {
              onClose();
              onRun(item);
            }}
            style={{ flex: 1, background: "var(--c-blue)", color: "#fff", border: "none", fontSize: "var(--fs-base)", fontWeight: 600, padding: "9px 0", borderRadius: 3, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            <Play size={13} />Run now
          </button>
          <button
            onClick={() => {
              onClose();
              onSchedule(item);
            }}
            style={{ background: "transparent", color: "var(--c-ink-2)", border: "1px solid var(--c-border)", borderRadius: 3, fontSize: "var(--fs-base)", fontWeight: 500, padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Clock size={13} />Schedule
          </button>
        </div>
      </aside>
    </div>
  );
}
