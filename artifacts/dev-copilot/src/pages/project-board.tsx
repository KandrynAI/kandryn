import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, ExternalLink, Plus, Clock, GitFork } from "lucide-react";
import { RunPanel } from "@/components/runs/RunPanel";
import { NewItemDialog } from "@/components/workitems/NewItemDialog";
import { BreakdownDialog } from "@/components/workitems/BreakdownDialog";
import { WorkItemPanel } from "@/components/board/WorkItemPanel";
import { useTopBarActions } from "@/context/TopBarContext";
import {
  fetchProject,
  fetchProjectWorkItems,
  fetchRuns,
  syncProject,
  ApiError,
  type Project,
  type WorkItem,
} from "@/services/api";

const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: "open", label: "Open", statuses: ["open", "blocked"] },
  { key: "in-progress", label: "In progress", statuses: ["in-progress"] },
  { key: "review", label: "Review", statuses: ["review"] },
  { key: "done", label: "Done", statuses: ["done"] },
];

const COL_PARAM_TO_KEY: Record<string, string> = {
  open: "open",
  progress: "in-progress",
  review: "review",
  done: "done",
};

export default function ProjectBoard() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const { toast } = useToast();
  const search = useSearch();
  // ContextPanel deep-links here with ?col=open|progress|review|done to
  // highlight a column.
  const highlightKey = COL_PARAM_TO_KEY[new URLSearchParams(search).get("col") ?? ""] ?? null;

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [epicFilter, setEpicFilter] = useState<number | null>(null);
  const [runPanelItem, setRunPanelItem] = useState<WorkItem | null>(null);
  const [runPanelSchedule, setRunPanelSchedule] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [breakdownItem, setBreakdownItem] = useState<WorkItem | null>(null);
  // Work item ids that currently have a scheduled (not-yet-run) run.
  const [scheduledItems, setScheduledItems] = useState<Set<number>>(new Set());

  const loadScheduled = useCallback(() => {
    if (!Number.isFinite(projectId)) return;
    fetchRuns({ projectId, status: "scheduled" })
      .then((rs) => setScheduledItems(new Set(rs.map((r) => r.workItemId))))
      .catch(() => {
        /* badge is best-effort */
      });
  }, [projectId]);

  const load = useCallback(() => {
    if (!Number.isFinite(projectId)) return;
    setLoading(true);
    setError(null);
    Promise.all([fetchProject(projectId), fetchProjectWorkItems(projectId)])
      .then(([p, it]) => {
        setProject(p);
        setItems(it);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the project."))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
    loadScheduled();
  }, [load, loadScheduled]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const s = await syncProject(projectId);
      toast({
        title: "Sync complete",
        description: `${s.created} added, ${s.updated} updated, ${s.unchanged} unchanged${s.conflicts ? `, ${s.conflicts} run(s) canceled` : ""}.`,
      });
      const it = await fetchProjectWorkItems(projectId);
      setItems(it);
    } catch (err) {
      toast({
        title: "Sync failed",
        description: err instanceof ApiError ? err.message : "Could not sync from the PLM.",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }, [projectId, toast]);

  const openRun = (item: WorkItem, schedule: boolean) => {
    // Never show the detail panel and the run panel at once.
    setSelectedItem(null);
    setRunPanelSchedule(schedule);
    setRunPanelItem(item);
  };

  // Board actions live in the TopBar (shell). Registered here so their
  // handlers stay wired to this page's state.
  useTopBarActions(
    <>
      <Link href={`/p/${projectId}/runs`} className="bm-ghost">Runs</Link>
      <button className="bm-ghost" onClick={onSync} disabled={syncing}>
        <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
        {syncing ? "Syncing…" : "Sync"}
      </button>
      <button className="bm-ghost" onClick={() => setNewItemOpen(true)}>
        <Plus size={12} />New item
      </button>
    </>,
    [projectId, syncing],
  );

  if (loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", height: "100%", borderTop: "1px solid var(--c-border)" }}>
        {COLUMNS.map((c) => (
          <div key={c.key} style={{ borderRight: "1px solid var(--c-border)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 68, border: "1px solid var(--c-border)" }} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p style={{ fontSize: "var(--fs-lg)", color: "var(--c-ink-3)" }}>{error ?? "Project not found."}</p>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  const all = items ?? [];
  const epics = all.filter((it) => it.itemType === "epic");
  const parentOf = new Map(all.map((it) => [it.id, it.parentId]));
  const inEpic = (it: WorkItem, epicId: number): boolean => {
    let cur: number | null | undefined = it.id;
    const seen = new Set<number>();
    while (cur != null && !seen.has(cur)) {
      if (cur === epicId) return true;
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };
  const visible = epicFilter == null ? all : all.filter((it) => inEpic(it, epicFilter));

  return (
    <div style={{ display: "flex", height: "100%", flexDirection: "column" }}>
      {/* Epic filter */}
      {epics.length > 0 && (
        <div style={{ display: "flex", gap: 6, padding: "8px 20px", borderBottom: "1px solid var(--c-border)", overflowX: "auto" }}>
          <FilterPill active={epicFilter == null} onClick={() => setEpicFilter(null)}>All</FilterPill>
          {epics.map((e) => (
            <FilterPill key={e.id} active={epicFilter === e.id} onClick={() => setEpicFilter(e.id)} title={e.title}>
              {e.title.length > 28 ? `${e.title.slice(0, 28)}…` : e.title}
            </FilterPill>
          ))}
        </div>
      )}

      {/* Board */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", flex: 1, overflow: "hidden", borderTop: "1px solid var(--c-border)" }}>
        {COLUMNS.map((col, colIdx) => {
          const colItems = visible.filter((it) => col.statuses.includes(it.status));
          const highlighted = col.key === highlightKey;
          return (
            <div key={col.key} style={{ borderRight: "1px solid var(--c-border)", display: "flex", flexDirection: "column", overflow: "hidden", background: highlighted ? "var(--c-blue-bg)" : undefined }}>
              <div style={{ padding: "8px 12px", borderBottom: highlighted ? "1px solid var(--c-blue)" : "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: highlighted ? "var(--c-blue-bg)" : "var(--c-surface)", flexShrink: 0 }}>
                <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: highlighted ? "var(--c-blue)" : "var(--c-ink-4)" }}>{col.label}</span>
                <span style={{ fontSize: "var(--fs-xs)", color: highlighted ? "var(--c-blue)" : "var(--c-ink-4)", fontFamily: "var(--mono)" }}>{colItems.length}</span>
              </div>
              <div style={{ padding: 8, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                {colIdx === 0 && all.length === 0 && (
                  <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-4)", padding: "8px 2px" }}>
                    No items. Click Sync to load your board.
                  </p>
                )}
                {colItems.map((it) => (
                  <WorkItemCard
                    key={it.id}
                    item={it}
                    scheduled={scheduledItems.has(it.id)}
                    onOpen={() => setSelectedItem(it)}
                    onRun={() => openRun(it, false)}
                    onSchedule={() => openRun(it, true)}
                    onBreakdown={() => setBreakdownItem(it)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <WorkItemPanel
        item={selectedItem}
        projectId={projectId}
        onClose={() => setSelectedItem(null)}
        onRun={(it) => openRun(it, false)}
        onSchedule={(it) => openRun(it, true)}
      />

      <RunPanel
        item={runPanelItem}
        open={runPanelItem !== null}
        scheduleDefault={runPanelSchedule}
        onOpenChange={(o) => {
          if (!o) setRunPanelItem(null);
        }}
        onScheduled={loadScheduled}
      />

      <NewItemDialog
        project={project}
        parents={all}
        open={newItemOpen}
        onOpenChange={setNewItemOpen}
        onCreated={load}
      />

      <BreakdownDialog
        project={project}
        parent={breakdownItem}
        open={breakdownItem !== null}
        onOpenChange={(o) => {
          if (!o) setBreakdownItem(null);
        }}
        onCreated={load}
      />
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        fontSize: "var(--fs-sm)",
        fontWeight: 500,
        padding: "3px 10px",
        border: `1px solid ${active ? "var(--c-blue)" : "var(--c-border)"}`,
        borderRadius: 3,
        background: active ? "var(--c-blue)" : "transparent",
        color: active ? "#fff" : "var(--c-ink-3)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function WorkItemCard({
  item,
  scheduled,
  onOpen,
  onRun,
  onSchedule,
  onBreakdown,
}: {
  item: WorkItem;
  scheduled: boolean;
  onOpen: () => void;
  onRun: () => void;
  onSchedule: () => void;
  onBreakdown: () => void;
}) {
  // Epics group their children — they aren't run directly, but can be broken down.
  const runnable = item.itemType !== "epic";
  const breakable = item.itemType === "epic" || item.itemType === "story";
  const typeClass = `bm-type bm-type-${item.itemType}`;
  // Buttons stop propagation so they don't also open the detail panel.
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className="bm-board-card" onClick={onOpen} role="button">
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
        {item.title?.startsWith("[SECURITY]") && (
          <span title="Aegis security finding" style={{ width: 6, height: 6, borderRadius: 1, background: "var(--c-red)", flexShrink: 0 }} />
        )}
        <span className={typeClass}>{item.itemType.replace("_", " ")}</span>
        {item.externalId && (
          <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>{item.externalId}</span>
        )}
      </div>

      <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink)", lineHeight: 1.35, textWrap: "pretty", marginBottom: 6 }}>{item.title}</p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {item.plmUrl && (
            <a href={item.plmUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--c-ink-4)", display: "inline-flex" }} title="Open in PLM">
              <ExternalLink size={12} />
            </a>
          )}
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.plmStatus ?? item.status}
          </span>
        </div>

        {scheduled ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-amber)", flexShrink: 0 }}>
            <Clock size={10} />Scheduled
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {breakable && (
              <button className="bm-icon-btn" onClick={stop(onBreakdown)} title="Break down">
                <GitFork size={12} />
              </button>
            )}
            {runnable && (
              <>
                <button className="bm-icon-btn" onClick={stop(onSchedule)} title="Schedule run">
                  <Clock size={12} />
                </button>
                <button className="bm-run" onClick={stop(onRun)} title="Run agents">Run</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
