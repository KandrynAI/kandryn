import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { X, Loader2, Check, Clock, ChevronRight } from "lucide-react";
import {
  fetchProjectWorkItems,
  fetchRuns,
  type WorkItem,
  type Run,
} from "@/services/api";
import { WorkItemPanel } from "@/components/board/WorkItemPanel";
import { RunPanel } from "@/components/runs/RunPanel";
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
  const [runs, setRuns] = useState<Run[]>([]);
  const [titles, setTitles] = useState<Map<number, string>>(new Map());
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchProjectWorkItems(view.projectId)
      .then((items) => setTitles(new Map(items.map((it) => [it.id, it.title]))))
      .catch(() => {});
  }, [view.projectId]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchRuns({ projectId: view.projectId, limit: 200 })
        .then((r) => {
          if (!cancelled) setRuns(r);
        })
        .catch(() => {});
    load();
    // Keep the Running list live while the panel is open.
    const iv = open && view.status === "running" ? setInterval(load, 5000) : null;
    return () => {
      cancelled = true;
      if (iv) clearInterval(iv);
    };
  }, [view.projectId, view.status, open]);

  const filtered = runs.filter((r) => {
    if (view.status === "running") return r.status === "running" || r.status === "queued";
    if (view.status === "scheduled") return r.status === "scheduled";
    return r.status === "succeeded"; // "completed"
  });
  const visible = view.status === "completed" ? filtered.slice(0, page * PAGE_SIZE) : filtered;
  const title = view.status === "running" ? "Running runs" : view.status === "scheduled" ? "Scheduled runs" : "Completed runs";

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
          <div className="rp-empty">No {view.status} runs.</div>
        ) : (
          visible.map((run) => (
            <button key={run.id} className="rp-item" onClick={() => openRun(run.id)}>
              {view.status === "running" ? (
                <Loader2 className="animate-spin" size={13} style={{ color: "var(--c-blue)", flexShrink: 0 }} />
              ) : view.status === "scheduled" ? (
                <Clock size={13} style={{ color: "var(--c-amber)", flexShrink: 0 }} />
              ) : (
                <Check size={13} strokeWidth={2.5} style={{ color: "#1a7f4b", flexShrink: 0 }} />
              )}
              <span className="rp-item-title">{runTitle(run)}</span>
              <span className="rp-item-meta">
                {view.status === "running"
                  ? `started ${relativeTime(run.startedAt ?? run.createdAt)}`
                  : view.status === "scheduled"
                    ? relativeTime(run.scheduledAt)
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
      </aside>
    </>
  );
}
