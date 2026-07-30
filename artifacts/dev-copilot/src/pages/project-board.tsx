import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, ExternalLink, Plus, Play, History, Clock, Sparkles } from "lucide-react";
import { RunPanel } from "@/components/runs/RunPanel";
import { NewItemDialog } from "@/components/workitems/NewItemDialog";
import { BreakdownDialog } from "@/components/workitems/BreakdownDialog";
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

export default function ProjectBoard() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [epicFilter, setEpicFilter] = useState<number | null>(null);
  const [runPanelItem, setRunPanelItem] = useState<WorkItem | null>(null);
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

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 px-5 py-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid flex-1 grid-cols-4 gap-3">
          {COLUMNS.map((c) => (
            <Skeleton key={c.key} className="h-full w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">{error ?? "Project not found."}</p>
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
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, padding: "20px 32px", borderBottom: "2px solid var(--color-divider)" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>{project.name}</h1>
          <p style={{ fontSize: 12, fontFamily: "var(--app-font-mono)", color: "var(--color-neutral-600)", marginTop: 4 }}>
            {project.plmProvider === "jira" ? "jira" : "azure-devops"}
            {project.plmProjectKey ? ` · ${project.plmProjectKey}` : ""} · {all.length} items
            {project.lastSyncedAt ? ` · synced ${new Date(project.lastSyncedAt).toLocaleString()}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Link href={`/p/${projectId}/runs`} className="btn btn-ghost btn-sm"><History className="h-3.5 w-3.5" />Runs</Link>
          <button className="btn btn-ghost btn-sm" onClick={onSync} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing…" : "Sync"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setNewItemOpen(true)}><Plus className="h-3.5 w-3.5" />New item</button>
        </div>
      </div>

      {/* Epic filter */}
      {epics.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 32px", borderBottom: "1px solid var(--color-neutral-300)" }}>
          <button className={epicFilter == null ? "tag tag-accent" : "tag tag-outline"} style={{ cursor: "pointer", padding: "7px 12px", fontSize: 12, letterSpacing: "0.06em" }} onClick={() => setEpicFilter(null)}>
            ALL EPICS
          </button>
          {epics.map((e) => (
            <button key={e.id} className={epicFilter === e.id ? "tag tag-accent" : "tag tag-outline"} style={{ cursor: "pointer", padding: "7px 12px", fontSize: 12, letterSpacing: "0.06em" }} onClick={() => setEpicFilter(e.id)} title={e.title}>
              {e.title.length > 28 ? `${e.title.slice(0, 28)}…` : e.title}
            </button>
          ))}
        </div>
      )}

      {/* Board */}
      {all.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: "var(--color-neutral-600)" }}>No items yet</p>
          <p style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>
            Click Sync to pull your {project.plmProvider === "jira" ? "Jira" : "Azure DevOps"} board.
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={onSync} disabled={syncing}>Sync now</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: "2px solid var(--color-divider)", flex: 1, overflowY: "auto" }}>
          {COLUMNS.map((col) => {
            const colItems = visible.filter((it) => col.statuses.includes(it.status));
            return (
              <div key={col.key} style={{ borderRight: "2px solid var(--color-divider)", padding: "14px 16px", minHeight: "calc(100vh - 260px)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{col.label}</span>
                  <span style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{colItems.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {colItems.map((it) => (
                    <WorkItemCard
                      key={it.id}
                      item={it}
                      scheduled={scheduledItems.has(it.id)}
                      onRun={() => setRunPanelItem(it)}
                      onBreakdown={() => setBreakdownItem(it)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RunPanel
        item={runPanelItem}
        open={runPanelItem !== null}
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

function WorkItemCard({
  item,
  scheduled,
  onRun,
  onBreakdown,
}: {
  item: WorkItem;
  scheduled: boolean;
  onRun: () => void;
  onBreakdown: () => void;
}) {
  // Epics group their children — they aren't run directly, but can be broken down.
  const runnable = item.itemType !== "epic";
  const breakable = item.itemType === "epic" || item.itemType === "story";
  return (
    <div className="bm-card group" style={{ background: "var(--color-neutral-100)", border: "1px solid var(--color-neutral-300)", boxShadow: "var(--shadow-sm)", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span className="tag tag-neutral">{item.itemType.replace("_", " ").toUpperCase()}</span>
        {item.externalId && (
          <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "var(--color-neutral-600)" }}>{item.externalId}</span>
        )}
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, textWrap: "pretty" }}>{item.title}</p>
      <div style={{ fontSize: 11, color: "var(--color-neutral-600)", marginTop: 6 }}>{item.plmStatus ?? item.status}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {item.plmUrl && (
            <a href={item.plmUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-accent-700)", display: "inline-flex" }} title="Open in PLM">
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {scheduled && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--color-accent-700)" }}>
              <Clock className="h-2.5 w-2.5" />21:00
            </span>
          )}
        </div>
        <div className="bm-card-actions" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {breakable && (
            <button className="btn btn-ghost btn-xs" onClick={onBreakdown} title="AI breakdown"><Sparkles className="h-3 w-3" />Break down</button>
          )}
          {runnable && (
            <button className="bm-run-btn" onClick={onRun} title="Run agents"><Play className="h-3 w-3" style={{ marginRight: 4 }} />RUN</button>
          )}
        </div>
      </div>
    </div>
  );
}
