import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { X, Loader2, Check, Clock, ChevronRight, AlertTriangle } from "lucide-react";
import {
  fetchProjectWorkItems,
  fetchRuns,
  fetchRun,
  ApiError,
  type WorkItem,
  type Run,
  type RunDetail,
} from "@/services/api";
import { WorkItemPanel } from "@/components/board/WorkItemPanel";
import { RunPanel } from "@/components/runs/RunPanel";
import { useToast } from "@/hooks/use-toast";
import { useRightPanel, type RightPanelView } from "@/context/RightPanelContext";

// ── helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) === 1 ? "" : "s"} ago`;
}

function priorityColor(p: string | null | undefined): string {
  switch ((p ?? "").toLowerCase()) {
    case "highest":
    case "critical":
      return "#e11d48";
    case "high":
      return "#f97316";
    case "medium":
      return "#eab308";
    default:
      return "#8a9ab0"; // low / lowest / unset
  }
}

const PAGE_SIZE = 20;

// ── run list view ────────────────────────────────────────────────────────────

function RunListView({
  view,
  open,
  onClose,
}: {
  view: Extract<NonNullable<RightPanelView>, { type: "run-list" }>;
  open: boolean;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [runs, setRuns] = useState<Run[]>([]);
  const [titles, setTitles] = useState<Map<number, string>>(new Map());
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toastedRef = useRef(false);

  useEffect(() => {
    fetchProjectWorkItems(view.projectId)
      .then((items) => setTitles(new Map(items.map((it) => [it.id, it.title]))))
      .catch(() => {});
  }, [view.projectId]);

  useEffect(() => {
    let cancelled = false;
    toastedRef.current = false; // one toast per (project, status, open) cycle
    const load = () =>
      fetchRuns({ projectId: view.projectId, limit: 200 })
        .then((r) => {
          if (cancelled) return;
          setRuns(r);
          setLoadError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          // NEVER swallow: a swallowed 400 here (a validation regression like the
          // limit>50 cap) looked like an empty list for months. Surface the real
          // cause — a 400/500 (ApiError carries status + server message) vs. a
          // network failure — in the console AND as a one-time toast, and mark
          // the panel as errored so it doesn't read as legitimately empty.
          const detail =
            err instanceof ApiError ? `${err.status}: ${err.message}` : err instanceof Error ? err.message : "network error";
          console.error("[RightPanel] run list fetch failed —", detail);
          setLoadError(detail);
          if (!toastedRef.current) {
            toastedRef.current = true;
            toast({ title: "Couldn't load runs", description: detail, variant: "destructive" });
          }
        });
    load();
    // Poll while the panel is open so every list (not just Running) stays live
    // and self-corrects after a transient fetch failure — matching the left
    // panel's polling, so the two never disagree.
    const iv = open ? setInterval(load, 5000) : null;
    return () => {
      cancelled = true;
      if (iv) clearInterval(iv);
    };
  }, [view.projectId, view.status, open, toast]);

  const filtered = runs.filter((r) => {
    if (view.status === "running") return r.status === "running" || r.status === "queued";
    if (view.status === "scheduled") return r.status === "scheduled";
    if (view.status === "awaiting_review") return r.status === "awaiting_review";
    return r.status === "succeeded"; // "completed"
  });
  const visible = view.status === "completed" ? filtered.slice(0, page * PAGE_SIZE) : filtered;
  const title =
    view.status === "running"
      ? "Running runs"
      : view.status === "scheduled"
        ? "Scheduled runs"
        : view.status === "awaiting_review"
          ? "Runs needing review"
          : "Completed runs";

  const runTitle = (run: Run) => titles.get(run.workItemId) ?? `Work item #${run.workItemId}`;

  const openRun = (id: number) => {
    navigate(`/runs/${id}`);
    onClose();
  };

  return (
    <>
      <div className="rp-head">
        <span className="rp-title">{title}</span>
        <button className="rp-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="rp-body">
        {visible.length === 0 ? (
          loadError ? (
            <div className="rp-empty" style={{ color: "var(--c-red)", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={13} /> Couldn't load runs — {loadError}
            </div>
          ) : (
            <div className="rp-empty">No {view.status === "awaiting_review" ? "runs needing review" : `${view.status} runs`}.</div>
          )
        ) : (
          visible.map((run) => (
            <button key={run.id} className="rp-item" onClick={() => openRun(run.id)}>
              {view.status === "running" ? (
                <Loader2 className="animate-spin" size={13} style={{ color: "var(--c-blue)", flexShrink: 0 }} />
              ) : view.status === "scheduled" ? (
                <Clock size={13} style={{ color: "var(--c-amber)", flexShrink: 0 }} />
              ) : view.status === "awaiting_review" ? (
                <AlertTriangle size={13} style={{ color: "var(--c-amber)", flexShrink: 0 }} />
              ) : (
                <Check size={13} strokeWidth={2.5} style={{ color: "#1a7f4b", flexShrink: 0 }} />
              )}
              <span className="rp-item-title">{runTitle(run)}</span>
              <span className="rp-item-meta">
                {view.status === "running"
                  ? `started ${relativeTime(run.startedAt ?? run.createdAt)}`
                  : view.status === "scheduled"
                    ? relativeTime(run.scheduledAt)
                    : view.status === "awaiting_review"
                      ? `${run.trigger === "scheduled" ? "scheduled" : "manual"} · ${relativeTime(run.startedAt ?? run.createdAt)}`
                      : relativeTime(run.finishedAt)}
              </span>
            </button>
          ))
        )}
        {view.status === "completed" && visible.length < filtered.length && (
          <button className="rp-more" onClick={() => setPage((p) => p + 1)}>Load more</button>
        )}
      </div>
    </>
  );
}

// ── bugs view ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  open: { bg: "var(--c-blue-bg)", fg: "var(--c-blue)" },
  "in-progress": { bg: "#fef3c7", fg: "#b45309" },
  review: { bg: "#ede9fe", fg: "#6d28d9" },
  done: { bg: "#dcfce7", fg: "#15803d" },
  blocked: { bg: "#fee2e2", fg: "#b91c1c" },
};

function BugsView({
  view,
  onClose,
}: {
  view: Extract<NonNullable<RightPanelView>, { type: "bugs" }>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [filter, setFilter] = useState<"open" | "all">(view.filter);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [runItem, setRunItem] = useState<WorkItem | null>(null);
  const [runSchedule, setRunSchedule] = useState(false);

  const load = () => {
    fetchProjectWorkItems(view.projectId)
      .then((all) => setItems(all.filter((it) => it.itemType === "bug")))
      .catch(() => {});
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.projectId]);

  const bugs = filter === "open" ? items.filter((b) => b.status === "open") : items;

  return (
    <>
      <div className="rp-head">
        <span className="rp-title">Bugs</span>
        <div className="rp-tabs">
          <button className={`rp-tab${filter === "open" ? " active" : ""}`} onClick={() => setFilter("open")}>Open</button>
          <button className={`rp-tab${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>All</button>
        </div>
        <button className="rp-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="rp-body">
        {bugs.length === 0 ? (
          <div className="rp-empty">No {filter === "open" ? "open " : ""}bugs.</div>
        ) : (
          bugs.map((bug) => {
            const badge = STATUS_BADGE[bug.status] ?? { bg: "var(--c-raised)", fg: "var(--c-ink-3)" };
            return (
              <button key={bug.id} className="rp-item" onClick={() => setSelected(bug)}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: priorityColor(bug.priority), flexShrink: 0 }} />
                <span className="rp-item-title">{bug.title}</span>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: badge.bg, color: badge.fg, textTransform: "capitalize", flexShrink: 0 }}>
                  {bug.status}
                </span>
                <ChevronRight size={13} style={{ color: "var(--c-ink-4)", flexShrink: 0 }} />
              </button>
            );
          })
        )}
      </div>

      {/* Bug detail — the same panel the board uses; the Run button IS shown for bugs. */}
      <WorkItemPanel
        item={selected}
        projectId={view.projectId}
        onClose={() => setSelected(null)}
        onRun={(it) => {
          setRunSchedule(false);
          setRunItem(it);
        }}
        onSchedule={(it) => {
          setRunSchedule(true);
          setRunItem(it);
        }}
      />
      <RunPanel
        item={runItem}
        open={runItem !== null}
        scheduleDefault={runSchedule}
        onOpenChange={(o) => {
          if (!o) setRunItem(null);
        }}
        onScheduled={load}
      />
    </>
  );
}

// ── run detail view ──────────────────────────────────────────────────────────

const RUN_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  running: { label: "Running", bg: "var(--c-blue-bg)", fg: "var(--c-blue)" },
  queued: { label: "Queued", bg: "var(--c-blue-bg)", fg: "var(--c-blue)" },
  succeeded: { label: "Succeeded", bg: "#dcfce7", fg: "#15803d" },
  failed: { label: "Failed", bg: "#fee2e2", fg: "#b91c1c" },
  canceled: { label: "Canceled", bg: "var(--c-raised)", fg: "var(--c-ink-3)" },
  scheduled: { label: "Scheduled", bg: "#fef3c7", fg: "#b45309" },
};

function RunDetailView({ runId, onClose }: { runId: number; onClose: () => void }) {
  const [, navigate] = useLocation();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchRun(runId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [runId]);

  const run = detail?.run ?? null;
  const badge = run ? RUN_BADGE[run.status] ?? { label: run.status, bg: "var(--c-raised)", fg: "var(--c-ink-3)" } : null;
  const rows: [string, string][] = run
    ? [
        ["Trigger", run.trigger],
        ["Started", run.startedAt ? relativeTime(run.startedAt) : "—"],
        ["Finished", run.finishedAt ? relativeTime(run.finishedAt) : "—"],
        ...(run.securityGate ? ([["Security gate", run.securityGate]] as [string, string][]) : []),
      ]
    : [];

  return (
    <>
      <div className="rp-head">
        <span className="rp-title">Run #{runId}</span>
        <button className="rp-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="rp-body" style={{ padding: 14 }}>
        {loading ? (
          <div className="rp-empty">Loading…</div>
        ) : !run ? (
          <div className="rp-empty">Run not found.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {badge && (
              <span style={{ alignSelf: "flex-start", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 3, background: badge.bg, color: badge.fg }}>
                {badge.label}
              </span>
            )}
            <dl style={{ display: "grid", gap: 8, margin: 0 }}>
              {rows.map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <dt style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-ink-4)" }}>{k}</dt>
                  <dd style={{ margin: 0, fontSize: 12, color: "var(--c-ink)", textAlign: "right", textTransform: "capitalize" }}>{v}</dd>
                </div>
              ))}
            </dl>
            {run.error && (
              <div style={{ fontSize: 12, color: "#b91c1c", background: "#fee2e2", padding: "8px 10px", borderRadius: 4, lineHeight: 1.4 }}>{run.error}</div>
            )}
            {run.prUrl && (
              <a href={run.prUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--c-blue)", fontWeight: 500 }}>View pull request →</a>
            )}
            <button className="rp-more" onClick={() => { navigate(`/runs/${runId}`); onClose(); }}>
              Open full run detail →
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── shell ────────────────────────────────────────────────────────────────────

export function RightPanel() {
  const { view, close } = useRightPanel();
  const [rendered, setRendered] = useState<NonNullable<RightPanelView> | null>(view);

  useEffect(() => {
    if (view) setRendered(view);
  }, [view]);

  return (
    <>
      <style>{`
        .rp-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.18); z-index: 40; }
        .rp-root {
          position: fixed; top: 0; right: 0; height: 100vh; width: 380px; max-width: 90vw;
          background: var(--c-bg); border-left: 1px solid var(--c-border);
          box-shadow: -8px 0 24px rgba(0,0,0,0.08); z-index: 41;
          display: flex; flex-direction: column; font-family: var(--sans);
          transition: transform 200ms ease;
        }
        .rp-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px;
          border-bottom: 1px solid var(--c-border); flex-shrink: 0; }
        .rp-title { font-size: var(--fs-base); font-weight: 600; color: var(--c-ink); flex: 1; }
        .rp-x { background: none; border: none; cursor: pointer; color: var(--c-ink-4); display: inline-flex; padding: 2px; }
        .rp-x:hover { color: var(--c-ink); }
        .rp-tabs { display: flex; gap: 2px; }
        .rp-tab { font-size: var(--fs-xs); padding: 3px 10px; border-radius: 4px; border: 1px solid var(--c-border);
          background: none; color: var(--c-ink-3); cursor: pointer; font-family: var(--sans); }
        .rp-tab.active { background: var(--c-blue-bg); border-color: var(--c-blue); color: var(--c-blue); }
        .rp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; }
        .rp-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 8px;
          background: none; border: none; cursor: pointer; text-align: left; border-radius: 4px; color: var(--c-ink); }
        .rp-item:hover { background: var(--c-raised); }
        .rp-item-title { flex: 1; font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rp-item-meta { font-size: var(--fs-xs); color: var(--c-ink-4); flex-shrink: 0; }
        .rp-empty { padding: 24px 12px; font-size: var(--fs-sm); color: var(--c-ink-4); text-align: center; }
        .rp-more { display: block; width: 100%; margin-top: 6px; padding: 8px; font-size: var(--fs-sm);
          background: none; border: 1px solid var(--c-border); border-radius: 4px; color: var(--c-blue); cursor: pointer; font-family: var(--sans); }
        .rp-more:hover { background: var(--c-raised); }
      `}</style>

      {view && <div className="rp-backdrop" onClick={close} />}
      <aside className="rp-root" style={{ transform: view ? "translateX(0)" : "translateX(100%)" }} data-testid="right-panel">
        {rendered?.type === "run-list" && <RunListView view={rendered} open={view !== null} onClose={close} />}
        {rendered?.type === "bugs" && <BugsView view={rendered} onClose={close} />}
        {rendered?.type === "run-detail" && <RunDetailView runId={rendered.runId} onClose={close} />}
      </aside>
    </>
  );
}
