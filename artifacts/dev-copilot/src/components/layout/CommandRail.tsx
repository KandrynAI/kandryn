import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { LayoutDashboard, Kanban, Play, GitBranch, History, BarChart2, Settings } from "lucide-react";
import { fetchProjects, type Project } from "@/services/api";
import { useTeam } from "@/context/TeamContext";

/** The Blue Mantis mark — a simple geometric "claw" V, no wordmark. */
function MantisMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3 3.5 L9 13.5 L15 3.5"
        stroke="var(--c-blue)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface RailIcon {
  key: string;
  title: string;
  href: string;
  active: boolean;
  Icon: typeof LayoutDashboard;
}

export function CommandRail() {
  const [location, navigate] = useLocation();
  const { user } = useUser();
  const { team } = useTeam();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  const routeMatch = location.match(/\/p\/(\d+)/);
  const routeId = routeMatch ? Number(routeMatch[1]) : null;
  const activeId = routeId ?? projects[0]?.id ?? null;

  const boardHref = activeId ? `/p/${activeId}/board` : "/projects/new";
  const runsHref = activeId ? `/p/${activeId}/runs` : "/projects/new";

  const nav: RailIcon[] = [
    { key: "dashboard", title: "Dashboard", href: "/dashboard", Icon: LayoutDashboard, active: location === "/dashboard" },
    { key: "board", title: "Board", href: boardHref, Icon: Kanban, active: location.includes("/board") },
    { key: "runs", title: "Runs", href: runsHref, Icon: Play, active: location.includes("/runs") },
    { key: "repositories", title: "Repositories", href: "/repositories", Icon: GitBranch, active: location.startsWith("/repositories") },
    { key: "history", title: "History", href: "/history", Icon: History, active: location === "/history" },
    { key: "reports", title: "Reports", href: "/reports", Icon: BarChart2, active: location === "/reports" },
  ];

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initial = (email || user?.username || "?").charAt(0).toUpperCase();

  return (
    <>
      <style>{`
        .cr-root {
          width: var(--rail-w); min-width: var(--rail-w); flex-shrink: 0;
          height: 100vh; background: var(--c-surface);
          border-right: 1px solid var(--c-border);
          display: flex; flex-direction: column; align-items: center;
          padding: 8px 0; gap: 2px;
        }
        .cr-logo {
          width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer; margin-bottom: 6px;
        }
        .cr-icon {
          width: 32px; height: 32px; border-radius: 6px; border: none;
          background: transparent; color: var(--c-ink-4); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 100ms ease, color 100ms ease;
        }
        .cr-icon:hover { background: var(--c-raised); color: var(--c-ink-2); }
        .cr-icon.active { background: var(--c-blue-bg); color: var(--c-blue); }
        .cr-spacer { flex: 1; }
        .cr-avatar {
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--c-raised); border: 1px solid var(--c-border-s);
          color: var(--c-ink-2); font-size: 10px; font-weight: 600;
          display: flex; align-items: center; justify-content: center;
          margin-top: 4px; user-select: none;
        }
      `}</style>
      <nav className="cr-root" data-testid="command-rail">
        <button className="cr-logo" onClick={() => navigate("/dashboard")} title="Blue Mantis" aria-label="Blue Mantis — Dashboard">
          <MantisMark />
        </button>

        {nav.map(({ key, title, href, active, Icon }) => (
          <button
            key={key}
            className={`cr-icon${active ? " active" : ""}`}
            title={title}
            aria-label={title}
            data-testid={`rail-${key}`}
            onClick={() => navigate(href)}
          >
            <Icon size={16} strokeWidth={1.5} />
          </button>
        ))}

        <div className="cr-spacer" />

        <button
          className={`cr-icon${location === "/settings" ? " active" : ""}`}
          title="Settings"
          aria-label="Settings"
          data-testid="rail-settings"
          onClick={() => navigate("/settings")}
        >
          <Settings size={16} strokeWidth={1.5} />
        </button>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div className="cr-avatar" title={email || "Account"}>{initial}</div>
          {team && (
            <div style={{ fontSize: 8, fontWeight: 700, color: "var(--c-ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>
              {team.plan}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
