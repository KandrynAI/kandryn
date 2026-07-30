import { useTabs, type TabKind } from "@/context/TabsContext";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

function Icon({ kind }: { kind: TabKind }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "tasks":
    case "task":
      return (<svg {...common}><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M5 5h6M5 8h6M5 11h4" /></svg>);
    case "workspace":
      return (<svg {...common}><path d="M2 4l3 4-3 4M8 12h6" /></svg>);
    case "repositories":
    case "repository":
      return (<svg {...common}><path d="M4 2h8a1 1 0 0 1 1 1v10.5a.5.5 0 0 1-.8.4L8 11l-4.2 2.9a.5.5 0 0 1-.8-.4V3a1 1 0 0 1 1-1z" /></svg>);
    case "dashboard":
      return (<svg {...common}><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>);
    case "history":
      return (<svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5l2 2" /></svg>);
    case "settings":
      return (<svg {...common}><circle cx="8" cy="8" r="2.3" /><path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>);
    default:
      return (<svg {...common}><circle cx="8" cy="8" r="6" /></svg>);
  }
}

function PlusIcon() {
  return (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3.5v9M3.5 8h9" /></svg>);
}
function CloseIcon() {
  return (<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>);
}

const NEW_VIEWS: { path: string; label: string; kind: TabKind }[] = [
  { path: "/tasks", label: "Tasks", kind: "tasks" },
  { path: "/repositories", label: "Repositories", kind: "repositories" },
  { path: "/dashboard", label: "Dashboard", kind: "dashboard" },
  { path: "/history", label: "History", kind: "history" },
  { path: "/settings", label: "Settings", kind: "settings" },
];

export function TabBar() {
  const { tabs, activePath, open, openTab, close } = useTabs();

  return (
    <>
      <style>{`
        .dc-tabbar {
          display: flex; align-items: stretch;
          height: var(--tabbar-h); min-height: var(--tabbar-h);
          background: var(--color-neutral-100);
          border-bottom: 1px solid var(--color-neutral-300);
          overflow-x: auto; overflow-y: hidden;
        }
        .dc-tabbar::-webkit-scrollbar { height: 0; }
        .dc-tab {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 0 10px 0 12px;
          max-width: 220px; min-width: 0;
          font-size: 12px; font-family: var(--app-font-sans);
          color: var(--color-neutral-600);
          background: transparent;
          border: none;
          cursor: pointer; white-space: nowrap;
          position: relative;
          transition: background 120ms ease, color 120ms ease;
        }
        .dc-tab:hover { background: var(--color-neutral-200); color: var(--color-text); }
        .dc-tab.active {
          background: var(--color-bg); color: var(--color-text); font-weight: 700;
          box-shadow: inset 0 -2px 0 var(--color-accent-600);
        }
        .dc-tab-label { overflow: hidden; text-overflow: ellipsis; }
        .dc-tab-close {
          display: inline-flex; align-items: center; justify-content: center;
          width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
          color: var(--text-muted); background: transparent; border: none; cursor: pointer;
          opacity: 0; transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
        }
        .dc-tab:hover .dc-tab-close, .dc-tab.active .dc-tab-close { opacity: 1; }
        .dc-tab-close:hover { background: var(--hairline); color: var(--text-primary); }
        .dc-tab-new {
          display: inline-flex; align-items: center; justify-content: center;
          width: 34px; flex-shrink: 0;
          color: var(--text-muted); background: transparent; border: none;
          border-right: 1px solid var(--hairline); cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
        }
        .dc-tab-new:hover { background: var(--bg-hover); color: var(--text-primary); }
      `}</style>
      <div className="dc-tabbar" data-testid="tabbar" role="tablist">
        {tabs.map((t) => {
          const active = t.path === activePath;
          return (
            <div
              key={t.path}
              className={`dc-tab${active ? " active" : ""}`}
              onClick={() => open(t.path)}
              role="tab"
              aria-selected={active}
              data-testid={`tab-${t.kind}`}
            >
              <Icon kind={t.kind} />
              <span className="dc-tab-label">{t.title}</span>
              <span
                className="dc-tab-close"
                role="button"
                aria-label={`Close ${t.title}`}
                onClick={(e) => { e.stopPropagation(); close(t.path); }}
              >
                <CloseIcon />
              </span>
            </div>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="dc-tab-new" title="Open a view" aria-label="Open a view" data-testid="tab-new">
              <PlusIcon />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {NEW_VIEWS.map((v) => (
              <DropdownMenuItem key={v.path} onSelect={() => openTab(v.path)}>
                <span style={{ display: "inline-flex", marginRight: 8, color: "var(--text-muted)" }}>
                  <Icon kind={v.kind} />
                </span>
                {v.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openTab("/tasks/new")}>
              <span style={{ display: "inline-flex", marginRight: 8, color: "var(--accent-blue)" }}><PlusIcon /></span>
              New task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
