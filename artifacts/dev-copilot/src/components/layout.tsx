import { Link, useLocation } from "wouter";
import {
  Database,
  CheckSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal,
  Layers,
  Server,
  HardDrive,
  Code2,
  RefreshCw,
  LayoutDashboard,
  Plus,
  RotateCcw,
  ChevronDown,
  X,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useHealthCheck, useGetRepository, useDetectRepositoryStack, getGetRepositoryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRepository, type Repository } from "@/context/RepositoryContext";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [syncingTasks, setSyncingTasks] = useState(false);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const { data: health } = useHealthCheck();

  const repoMatch = location.match(/^\/repositories\/(\d+)/);
  const activeRepoId = repoMatch ? parseInt(repoMatch[1], 10) : null;

  const handleSyncTasks = async () => {
    setSyncingTasks(true);
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const tasks = await res.json() as unknown[];
        setTaskCount(tasks.length);
        setTimeout(() => setTaskCount(null), 3000);
      }
    } finally {
      setSyncingTasks(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground selection:bg-primary/20">
      {/* Sidebar */}
      <div
        className={cn(
          "flex flex-col border-r bg-card/50 backdrop-blur-xl transition-all duration-300 relative z-20",
          collapsed ? "w-[60px]" : "w-64",
        )}
      >
        <div className="flex h-14 items-center border-b px-4 justify-between shrink-0">
          {!collapsed && (
            <div className="flex items-center gap-2 font-mono font-bold tracking-tight">
              <Terminal className="h-5 w-5 text-primary" />
              <span>Blue Mantis</span>
            </div>
          )}
          {collapsed && <Terminal className="h-5 w-5 text-primary mx-auto" />}
          <button
            data-testid="button-toggle-sidebar"
            onClick={() => setCollapsed(!collapsed)}
            className="text-muted-foreground hover:text-foreground transition-colors absolute -right-3 top-4 bg-background border rounded-full p-0.5 z-30"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-3 w-3" />
            ) : (
              <PanelLeftClose className="h-3 w-3" />
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 px-2">
          <NavItem
            href="/"
            icon={CheckSquare}
            label="Tasks"
            collapsed={collapsed}
            active={location === "/" || location.startsWith("/workspace")}
          />
          <NavItem
            href="/dashboard"
            icon={LayoutDashboard}
            label="Dashboard"
            collapsed={collapsed}
            active={location === "/dashboard"}
          />
          <NavItem
            href="/repositories"
            icon={Database}
            label="Repositories"
            collapsed={collapsed}
            active={location.startsWith("/repositories")}
          />
          <NavItem
            href="/tasks"
            icon={CheckSquare}
            label="All Tasks"
            collapsed={collapsed}
            active={location.startsWith("/tasks")}
          />

          {activeRepoId != null && !collapsed && (
            <StackProfilePanel repoId={activeRepoId} />
          )}
        </div>

        <div className="p-4 border-t shrink-0 flex flex-col gap-2">
          <div
            className={cn(
              "flex items-center gap-2 text-xs",
              collapsed ? "justify-center" : "",
            )}
          >
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                health?.status === "ok"
                  ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                  : "bg-yellow-500 animate-pulse",
              )}
            />
            {!collapsed && (
              <span className="text-muted-foreground font-mono">
                System {health?.status === "ok" ? "Online" : "Checking"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Top Navbar */}
        <Navbar
          syncingTasks={syncingTasks}
          taskCount={taskCount}
          onSyncTasks={() => void handleSyncTasks()}
        />

        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-[1400px] mx-auto h-full flex flex-col">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ─── Navbar ─────────────────────────────────────────────────────────────── */

function Navbar({
  syncingTasks,
  taskCount,
  onSyncTasks,
}: {
  syncingTasks: boolean;
  taskCount: number | null;
  onSyncTasks: () => void;
}) {
  const { repos, selectedRepo, setSelectedRepo, refetch, loading } = useRepository();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const stack = selectedRepo?.stackProfile as Record<string, string> | null | undefined;
  const stackBadges = stack
    ? Object.entries(stack).filter(([, v]) => v && v !== "none" && v !== "unknown")
    : [];

  return (
    <>
      <header
        data-testid="navbar"
        className="h-12 border-b bg-card/60 backdrop-blur-sm flex items-center px-4 gap-3 shrink-0"
      >
        {/* Repo selector */}
        <div className="relative flex-shrink-0" ref={dropdownRef}>
          <button
            data-testid="repo-selector-btn"
            onClick={() => setDropdownOpen((o) => !o)}
            className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-background text-xs font-mono hover:bg-muted transition-colors"
          >
            <Database className="h-3 w-3 text-muted-foreground" />
            {loading ? (
              <span className="text-muted-foreground">Loading…</span>
            ) : selectedRepo ? (
              <span className="max-w-[140px] truncate">{selectedRepo.name}</span>
            ) : (
              <span className="text-muted-foreground">No repo</span>
            )}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>

          {dropdownOpen && (
            <div className="absolute left-0 top-full mt-1 w-64 rounded-md border border-border bg-card shadow-xl z-50 py-1 overflow-hidden">
              {repos.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs font-mono text-muted-foreground">
                  No repositories connected
                </div>
              ) : (
                repos.map((r) => (
                  <button
                    key={r.id}
                    data-testid={`repo-option-${r.id}`}
                    onClick={() => { setSelectedRepo(r); setDropdownOpen(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-xs font-mono hover:bg-muted transition-colors flex items-center justify-between gap-2",
                      selectedRepo?.id === r.id && "bg-primary/5 text-primary",
                    )}
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{r.provider}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Stack badges */}
        {stackBadges.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            {stackBadges.map(([key, value]) => (
              <span
                key={key}
                title={key}
                className="inline-flex shrink-0 items-center px-2 py-0.5 rounded border border-primary/20 bg-primary/5 text-[10px] font-mono text-primary"
              >
                {value}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* Add repository */}
        <button
          data-testid="btn-add-repository"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-mono hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add repository
        </button>

        {/* Sync tasks */}
        <button
          data-testid="btn-sync-tasks"
          onClick={onSyncTasks}
          disabled={syncingTasks}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <RotateCcw className={cn("h-3 w-3", syncingTasks && "animate-spin")} />
          {syncingTasks ? "Syncing…" : taskCount !== null ? `${taskCount} tasks` : "Sync tasks"}
        </button>
      </header>

      {/* Add repository modal */}
      {showModal && (
        <AddRepositoryModal
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); refetch(); }}
        />
      )}
    </>
  );
}

/* ─── Add Repository Modal ────────────────────────────────────────────────── */

interface NewRepo {
  url: string;
  provider: string;
  name: string;
  defaultBranch: string;
}

function AddRepositoryModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<NewRepo>({ url: "", provider: "github", name: "", defaultBranch: "main" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedStack, setDetectedStack] = useState<Record<string, string> | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.url.trim() || !form.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json() as { error?: string; stackProfile?: Record<string, string> };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const stack = body.stackProfile as Record<string, string> | null | undefined;
      if (stack) {
        const badges = Object.entries(stack).filter(([, v]) => v && v !== "none" && v !== "unknown");
        if (badges.length) {
          setDetectedStack(stack);
          return;
        }
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect repository");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-bold text-sm">Connect Repository</h2>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">Link a Git repository to DevCopilot</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {detectedStack ? (
          /* Success — show detected stack */
          <div className="px-6 py-6 flex flex-col items-center gap-4 text-center">
            <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm">Repository connected!</p>
              <p className="text-xs text-muted-foreground mt-1">Detected stack:</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {Object.entries(detectedStack)
                .filter(([, v]) => v && v !== "none" && v !== "unknown")
                .map(([key, value]) => (
                  <span key={key} className="inline-flex items-center px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-xs font-mono text-primary">
                    {value}
                  </span>
                ))}
            </div>
            <button
              onClick={onSuccess}
              className="mt-2 w-full py-2 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          /* Form */
          <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
                Repository URL
              </label>
              <input
                data-testid="input-repo-url"
                type="url"
                placeholder="https://github.com/org/repo"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                required
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
                Display Name
              </label>
              <input
                data-testid="input-repo-name"
                type="text"
                placeholder="my-repo"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
                  Provider
                </label>
                <select
                  data-testid="select-repo-provider"
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="github">GitHub</option>
                  <option value="azure-repos">Azure Repos</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
                  Default Branch
                </label>
                <input
                  data-testid="input-repo-branch"
                  type="text"
                  placeholder="main"
                  value={form.defaultBranch}
                  onChange={(e) => setForm((f) => ({ ...f, defaultBranch: e.target.value }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-destructive font-mono bg-destructive/10 px-3 py-2 rounded-md">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-9 rounded-md border border-border text-xs font-mono hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !form.url.trim() || !form.name.trim()}
                className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="h-3 w-3 rounded-full border border-primary-foreground border-t-transparent animate-spin" />
                    Connecting…
                  </>
                ) : (
                  "Connect"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ─── Sidebar helpers ─────────────────────────────────────────────────────── */

function StackProfilePanel({ repoId }: { repoId: number }) {
  const queryClient = useQueryClient();

  const { data: repo } = useGetRepository(repoId, undefined, {
    query: { queryKey: getGetRepositoryQueryKey(repoId) },
  });

  const { refetch: refetchStack, isFetching: detecting } = useDetectRepositoryStack(repoId, {
    query: {
      enabled: false,
      queryKey: [`/api/repositories/${repoId}/stack`] as const,
    },
  });

  const stack = repo?.stackProfile as Record<string, string> | null | undefined;
  if (!stack) return null;

  return (
    <div
      data-testid="sidebar-stack-profile"
      className="mt-4 mx-1 rounded-md border border-border bg-muted/40 p-3 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Stack
        </span>
        <button
          data-testid="button-redetect-stack"
          onClick={() => void refetchStack().then(() => queryClient.invalidateQueries({ queryKey: getGetRepositoryQueryKey(repoId) }))}
          disabled={detecting}
          title="Re-detect stack"
          className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3 w-3", detecting && "animate-spin")} />
        </button>
      </div>

      <StackRow icon={Layers} label="Frontend" value={stack.frontend} />
      <StackRow icon={Server} label="Backend" value={stack.backend} />
      <StackRow icon={HardDrive} label="Database" value={stack.database} />
      <StackRow icon={Code2} label="Language" value={stack.language} />
    </div>
  );
}

function StackRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value?: string;
}) {
  if (!value || value === "none") return null;
  return (
    <div
      data-testid={`stack-${label.toLowerCase()}`}
      className="flex items-center gap-2"
    >
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-[10px] text-muted-foreground font-mono w-14 shrink-0">
        {label}
      </span>
      <span className="text-[10px] font-mono font-medium text-foreground truncate">
        {value}
      </span>
    </div>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  collapsed,
  active,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  collapsed: boolean;
  active: boolean;
}) {
  return (
    <Link href={href} className="block">
      <div
        data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 group relative",
          active
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        title={collapsed ? label : undefined}
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            active ? "scale-110" : "group-hover:scale-110",
          )}
        />
        {!collapsed && <span className="text-sm tracking-wide">{label}</span>}
      </div>
    </Link>
  );
}
