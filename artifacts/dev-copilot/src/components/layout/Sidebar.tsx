import { useLocation } from "wouter";
import { useState, useEffect, type ReactElement } from "react";
import { useUser, useClerk } from "@clerk/react";
import { useRepo } from "@/context/RepoContext";
import { useTabs } from "@/context/TabsContext";
import { fetchProjects, type Project } from "@/services/api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface SidebarProps {
  isAzureConnected: boolean;
  isJiraConnected: boolean;
}

/* ---- icons (16×16, stroke currentColor) ---- */
const sx = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const DashIcon = () => (<svg {...sx}><rect x="2" y="2" width="5" height="5" /><rect x="9" y="2" width="5" height="5" /><rect x="2" y="9" width="5" height="5" /><rect x="9" y="9" width="5" height="5" /></svg>);
const BoardIcon = () => (<svg {...sx}><rect x="2" y="2" width="12" height="12" /><path d="M6 2v12M10 2v12" /></svg>);
const RunsIcon = () => (<svg {...sx}><path d="M4 3l9 5-9 5z" /></svg>);
const RepoIcon = () => (<svg {...sx}><path d="M4 2h8a1 1 0 0 1 1 1v10.5a.5.5 0 0 1-.8.4L8 11l-4.2 2.9a.5.5 0 0 1-.8-.4V3a1 1 0 0 1 1-1z" /></svg>);
const HistoryIcon = () => (<svg {...sx}><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5l2 2" /></svg>);
const PlusIcon = () => (<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M8 3.5v9M3.5 8h9" /></svg>);
const SearchIcon = () => (<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>);

export function Sidebar(_props: SidebarProps) {
  const [location] = useLocation();
  const { open } = useTabs();
  const { repos, activeRepository } = useRepo();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  // Presentational "active project": the one in the URL, else the first project.
  const routeMatch = location.match(/\/p\/(\d+)/);
  const routeId = routeMatch ? Number(routeMatch[1]) : null;
  const activeProject = projects.find((p) => p.id === routeId) ?? projects[0] ?? null;

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
    : user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "User";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const nav: { href: string; label: string; Icon: () => ReactElement; active: boolean }[] = [
    { href: "/dashboard", label: "Dashboard", Icon: DashIcon, active: location === "/dashboard" },
    ...(activeProject
      ? [
          { href: `/p/${activeProject.id}/board`, label: "Board", Icon: BoardIcon, active: location === `/p/${activeProject.id}/board` },
          { href: `/p/${activeProject.id}/runs`, label: "Runs", Icon: RunsIcon, active: location.startsWith("/runs") || location === `/p/${activeProject.id}/runs` },
        ]
      : []),
    { href: "/repositories", label: "Repositories", Icon: RepoIcon, active: location === "/repositories" || location.startsWith("/repositories/") },
    { href: "/history", label: "History", Icon: HistoryIcon, active: location === "/history" },
  ];

  return (
    <>
      <style>{`
        .dc-sb {
          width: var(--sidebar-w); min-width: var(--sidebar-w); flex-shrink: 0;
          background: var(--color-bg); border-right: 2px solid var(--color-divider);
          display: flex; flex-direction: column;
          position: sticky; top: var(--header-h); height: calc(100vh - var(--header-h));
          overflow-y: auto; transition: width 200ms ease, min-width 200ms ease;
        }
        .dc-sb-label { font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-neutral-600); padding: 0 16px; margin-bottom: 6px; }
        .dc-sb-top { padding: 16px 0; border-bottom: 1px solid var(--color-neutral-300); }
        .dc-proj { padding: 8px 16px; background: var(--color-accent-100); border-left: 2px solid var(--color-accent-600); }
        .dc-proj-name { font-size: 13px; font-weight: 700; color: var(--color-text); }
        .dc-proj-meta { font-size: 11px; font-family: var(--app-font-mono); color: var(--color-neutral-600); margin-top: 2px; }
        .dc-switch { width: 100%; text-align: left; background: none; border: none; cursor: pointer; font-size: 12px; color: var(--color-neutral-700); padding: 6px 16px; }
        .dc-switch:hover { background: var(--color-neutral-100); }
        .dc-repo { font-size: 12px; font-family: var(--app-font-mono); color: var(--color-neutral-700); padding: 0 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dc-link { font-size: 11px; color: var(--color-accent-700); padding: 0 16px; margin-top: 3px; background: none; border: none; cursor: pointer; text-align: left; }
        .dc-link:hover { text-decoration: underline; }
        .dc-mid { flex: 1; padding: 16px 0; overflow-y: auto; }
        .dc-newitem { margin: 0 16px; width: calc(100% - 32px); }
        .dc-search { display: flex; align-items: center; gap: 8px; width: calc(100% - 32px); margin: 8px 16px 16px; padding: 8px 12px; border: 1px solid var(--color-neutral-300); background: var(--color-bg); color: var(--color-neutral-600); font-size: 12px; cursor: text; }
        .dc-search:hover { border-color: var(--color-neutral-400); }
        .dc-search .kbd { margin-left: auto; font-family: var(--app-font-mono); font-size: 10px; color: var(--color-neutral-500); }
        .dc-nav { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 16px; font-size: 13px; color: var(--color-neutral-700); background: none; border: none; border-left: 2px solid transparent; cursor: pointer; text-align: left; transition: background 110ms ease, color 110ms ease; }
        .dc-nav:hover { background: var(--color-neutral-100); color: var(--color-text); }
        .dc-nav.active { background: var(--color-accent-100); color: var(--color-accent-700); font-weight: 700; border-left-color: var(--color-accent-600); }
        .dc-nav .ico { color: currentColor; flex-shrink: 0; display: inline-flex; }
        .dc-foot { border-top: 1px solid var(--color-neutral-300); padding: 12px 16px; }
        .dc-uname { font-size: 13px; font-weight: 600; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dc-uemail { font-size: 11px; color: var(--color-neutral-600); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dc-signout { font-size: 11px; color: var(--color-neutral-700); margin-top: 8px; background: none; border: none; cursor: pointer; padding: 0; }
        .dc-signout:hover { color: var(--color-danger); }
        @media (max-width: 1100px) {
          .dc-sb { width: var(--sidebar-w-collapsed); min-width: var(--sidebar-w-collapsed); }
          .dc-sb-label, .dc-proj-meta, .dc-repo, .dc-link, .dc-newitem span, .dc-search span:not(.kbd), .dc-search .kbd,
          .dc-nav-label, .dc-uname, .dc-uemail, .dc-signout, .dc-proj-name, .dc-switch { display: none !important; }
          .dc-nav { justify-content: center; padding: 10px 0; gap: 0; }
          .dc-search, .dc-newitem { justify-content: center; margin: 8px 6px; width: calc(100% - 12px); padding: 8px 0; }
          .dc-proj { padding: 8px 6px; }
        }
      `}</style>

      <nav className="dc-sb" data-testid="sidebar">
        {/* PROJECTS */}
        <div className="dc-sb-top">
          <div className="dc-sb-label">Projects</div>
          <div className="dc-proj">
            <div className="dc-proj-name">{activeProject ? activeProject.name : "No project"}</div>
            <div className="dc-proj-meta">
              {activeProject
                ? `${activeProject.plmProvider === "jira" ? "jira" : "azure"} · ${activeProject.plmProjectKey ?? "—"}`
                : "Create one to begin"}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="dc-switch" data-testid="project-switcher">Switch project ▾</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {projects.length === 0 && <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>}
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => open(`/p/${p.id}/board`)}>{p.name}</DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => open("/projects/new")} style={{ color: "var(--color-accent-700)" }}>
                New project…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="dc-sb-label" style={{ marginTop: 12 }}>Active repo</div>
          <div className="dc-repo" title={activeRepository?.name ?? "No repository"}>
            {activeRepository?.name ?? repos[0]?.name ?? "No repository"}
          </div>
          <button className="dc-link" onClick={() => open("/repositories")}>Manage ›</button>
        </div>

        {/* MIDDLE */}
        <div className="dc-mid">
          <button className="btn btn-secondary dc-newitem" style={{ justifyContent: "center", padding: "8px 0" }} onClick={() => open("/tasks/new")} data-testid="new-task-cta">
            <PlusIcon /><span>New item</span>
          </button>

          <button className="dc-search" onClick={() => open("/tasks")} data-testid="sidebar-search">
            <SearchIcon /><span>Search tasks</span><span className="kbd">⌘K</span>
          </button>

          <div className="dc-sb-label" style={{ marginTop: 8 }}>Workspace</div>
          {nav.map(({ href, label, Icon, active }) => (
            <button
              key={href + label}
              className={`dc-nav${active ? " active" : ""}`}
              onClick={() => open(href)}
              data-testid={`nav-${label.toLowerCase()}`}
              title={label}
            >
              <span className="ico"><Icon /></span>
              <span className="dc-nav-label">{label}</span>
            </button>
          ))}
        </div>

        {/* BOTTOM */}
        <div className="dc-foot">
          <div className="dc-uname" title={displayName}>{displayName}</div>
          {email && <div className="dc-uemail" title={email}>{email}</div>}
          <button className="dc-signout" onClick={() => signOut()} data-testid="signout">Sign out</button>
        </div>
      </nav>
    </>
  );
}
