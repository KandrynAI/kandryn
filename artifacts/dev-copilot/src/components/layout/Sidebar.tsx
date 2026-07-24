import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { useUser, useClerk } from "@clerk/react";
import { useRepo } from "@/context/RepoContext";
import { useTabs } from "@/context/TabsContext";
import { fetchProjects, type Project } from "@/services/api";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface SidebarProps {
  isAzureConnected: boolean;
  isJiraConnected: boolean;
}

/* ---- icons ---- */
const sx = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const TasksIcon = () => (<svg {...sx}><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M5 5h6M5 8h6M5 11h4" /></svg>);
const RepoIcon = () => (<svg {...sx}><path d="M4 2h8a1 1 0 0 1 1 1v10.5a.5.5 0 0 1-.8.4L8 11l-4.2 2.9a.5.5 0 0 1-.8-.4V3a1 1 0 0 1 1-1z" /></svg>);
const DashIcon = () => (<svg {...sx}><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>);
const HistoryIcon = () => (<svg {...sx}><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5l2 2" /></svg>);
const SettingsIcon = () => (<svg {...sx}><circle cx="8" cy="8" r="2.3" /><path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>);
const SearchIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>);
const PlusIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M8 3.5v9M3.5 8h9" /></svg>);
const ChevronIcon = () => (<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>);
const SignOutIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6" /></svg>);

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: DashIcon, match: (l: string) => l === "/dashboard" },
  { href: "/tasks", label: "Tasks", Icon: TasksIcon, match: (l: string) => l === "/tasks" || l.startsWith("/tasks/") || l.startsWith("/workspace") },
  { href: "/repositories", label: "Repositories", Icon: RepoIcon, match: (l: string) => l === "/repositories" || l.startsWith("/repositories/") },
  { href: "/history", label: "History", Icon: HistoryIcon, match: (l: string) => l === "/history" },
];

export function Sidebar({ isAzureConnected, isJiraConnected }: SidebarProps) {
  const [location] = useLocation();
  const { open } = useTabs();
  const { repos, activeRepository, setActiveRepository } = useRepo();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch(() => {
        /* projects are optional in the sidebar */
      });
  }, []);

  const initials = user
    ? ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? user.username?.[0] ?? "")).toUpperCase() || "BM"
    : "BM";
  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
    : user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "User";

  return (
    <>
      <style>{`
        .dc-sb {
          width: var(--sidebar-w); min-width: var(--sidebar-w);
          height: 100vh;
          background: var(--bg-surface);
          border-right: 1px solid var(--hairline);
          display: flex; flex-direction: column;
          transition: width 180ms ease, min-width 180ms ease;
          flex-shrink: 0;
          font-size: var(--fs-sm);
        }
        .dc-sb-head { display: flex; align-items: center; gap: 8px; padding: 11px 12px 9px; flex-shrink: 0; }
        .dc-sb-word { color: var(--text-primary); font-size: var(--fs-base); font-weight: 600; letter-spacing: -.01em; }
        .dc-sb-sec { padding: 0 8px; }
        .dc-repo-switch {
          display: flex; align-items: center; gap: 8px; width: 100%;
          padding: 6px 8px; border-radius: var(--radius-md);
          background: transparent; border: 1px solid transparent;
          color: var(--text-secondary); cursor: pointer; font-family: var(--app-font-sans);
          transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
        }
        .dc-repo-switch:hover { background: var(--bg-raised); border-color: var(--hairline); color: var(--text-primary); }
        .dc-repo-switch .dc-nav-ico { color: var(--text-muted); }
        .dc-repo-name { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-sm); }
        .dc-cta {
          display: flex; align-items: center; justify-content: flex-start; gap: 8px;
          width: 100%; margin-top: 6px; padding: 6px 8px; border-radius: var(--radius-md);
          background: transparent; color: var(--text-secondary); border: 1px solid var(--hairline); cursor: pointer;
          font-size: var(--fs-sm); font-weight: 500; font-family: var(--app-font-sans);
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .dc-cta:hover { background: var(--bg-raised); border-color: var(--hairline-strong); color: var(--text-primary); }
        .dc-cta svg { color: var(--text-muted); }
        .dc-cta:hover svg { color: var(--text-primary); }
        .dc-search {
          display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px;
          padding: 6px 8px; border-radius: var(--radius-md);
          background: transparent; border: 1px solid transparent;
          color: var(--text-muted); cursor: text; font-size: var(--fs-sm); font-family: var(--app-font-sans);
          transition: border-color 120ms ease, background 120ms ease;
        }
        .dc-search:hover { background: var(--bg-raised); border-color: var(--hairline); }
        .dc-kbd {
          margin-left: auto; font-size: 10px; font-family: var(--app-font-mono);
          color: var(--text-muted); border: 1px solid var(--hairline); border-radius: 4px; padding: 0 4px; line-height: 15px;
        }
        .dc-navlist { flex: 1; overflow-y: auto; padding: 10px 8px; display: flex; flex-direction: column; gap: 1px; }
        .dc-nav {
          display: flex; align-items: center; gap: 9px;
          padding: 5px 8px; border-radius: var(--radius-md);
          font-size: var(--fs-sm); font-family: var(--app-font-sans);
          color: var(--text-secondary); cursor: pointer; position: relative;
          transition: background 110ms ease, color 110ms ease;
        }
        .dc-nav:hover { background: var(--bg-raised); color: var(--text-primary); }
        .dc-nav.active { background: var(--bg-hover); color: var(--text-primary); font-weight: 500; }
        .dc-nav-ico { flex-shrink: 0; display: inline-flex; color: var(--text-muted); transition: color 110ms ease; }
        .dc-nav:hover .dc-nav-ico, .dc-nav.active .dc-nav-ico { color: var(--text-primary); }
        .dc-grouplabel { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; color: var(--text-muted); font-weight: 600; padding: 0 8px; margin-bottom: 5px; }
        .dc-foot { border-top: 1px solid var(--hairline); padding: 7px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
        .dc-statusrow { display: flex; align-items: center; gap: 14px; padding: 4px 8px 6px; }
        .dc-status { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-muted); }
        .dc-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .dc-footrow { display: flex; align-items: center; gap: 4px; }
        .dc-user { display: flex; align-items: center; gap: 8px; padding: 5px 7px; border-radius: var(--radius-md); flex: 1; min-width: 0; }
        .dc-avatar { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; object-fit: cover; border: 1px solid var(--hairline); }
        .dc-avatar-fb { background: var(--bg-raised); color: var(--text-secondary); font-size: 10px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
        .dc-username { flex: 1; min-width: 0; font-size: var(--fs-sm); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dc-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: var(--radius-sm); color: var(--text-muted); background: none; border: none; cursor: pointer; flex-shrink: 0; transition: background 120ms ease, color 120ms ease; }
        .dc-iconbtn:hover { background: var(--bg-hover); color: var(--text-primary); }
        .dc-iconbtn-danger:hover { color: var(--accent-red); }
        @media (max-width: 1100px) {
          .dc-sb { width: var(--sidebar-w-collapsed); min-width: var(--sidebar-w-collapsed); }
          .dc-sb-word, .dc-repo-name, .dc-repo-chev, .dc-cta-label, .dc-search-label, .dc-kbd,
          .dc-nav-label, .dc-grouplabel, .dc-status-label, .dc-username, .dc-theme-label { display: none !important; }
          .dc-sb-sec { padding: 0 8px; }
          .dc-nav { justify-content: center; padding: 8px 0; }
          .dc-cta, .dc-search, .dc-repo-switch { justify-content: center; padding: 8px 0; }
          .dc-statusrow { justify-content: center; gap: 8px; }
          .dc-footrow { flex-direction: column; align-items: center; }
          .dc-user { justify-content: center; flex: none; }
          .dc-theme-toggle span { display: none !important; }
          .dc-theme-toggle { justify-content: center !important; }
        }
      `}</style>

      <nav className="dc-sb" data-testid="sidebar">
        <div className="dc-sb-head">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Blue Mantis" style={{ height: 18, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          <span className="dc-sb-word">Blue Mantis</span>
        </div>

        {/* Project switcher + repo switcher + primary action + search */}
        <div className="dc-sb-sec">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="dc-repo-switch" data-testid="project-switcher" title="Projects" style={{ marginBottom: 8 }}>
                <DashIcon />
                <span className="dc-repo-name">Projects</span>
                <span className="dc-repo-chev" style={{ color: "var(--text-muted)", display: "inline-flex" }}><ChevronIcon /></span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Projects</DropdownMenuLabel>
              {projects.length === 0 && <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>}
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => open(`/p/${p.id}/board`)} style={{ fontSize: "var(--fs-sm)" }}>
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => open("/projects/new")}>New project…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="dc-repo-switch" data-testid="repo-switcher" title={activeRepository?.name ?? "Select repository"}>
                <RepoIcon />
                <span className="dc-repo-name">{activeRepository?.name ?? "Select repository"}</span>
                <span className="dc-repo-chev" style={{ color: "var(--text-muted)", display: "inline-flex" }}><ChevronIcon /></span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Repositories</DropdownMenuLabel>
              {repos.length === 0 && (
                <DropdownMenuItem disabled>No repositories yet</DropdownMenuItem>
              )}
              {repos.map((r) => (
                <DropdownMenuItem
                  key={r.id}
                  onSelect={() => setActiveRepository(r)}
                  style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--fs-sm)" }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", marginRight: 8, background: activeRepository?.id === r.id ? "var(--accent-blue)" : "transparent", border: activeRepository?.id === r.id ? "none" : "1px solid var(--hairline-strong)" }} />
                  {r.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => open("/repositories")}>Manage repositories…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button className="dc-cta" onClick={() => open("/tasks/new")} data-testid="new-task-cta">
            <PlusIcon /><span className="dc-cta-label">New task</span>
          </button>

          <button className="dc-search" onClick={() => open("/tasks")} data-testid="sidebar-search">
            <SearchIcon /><span className="dc-search-label">Search tasks</span><span className="dc-kbd">⌘K</span>
          </button>
        </div>

        {/* Nav */}
        <div className="dc-navlist">
          <div className="dc-grouplabel">Workspace</div>
          {NAV.map(({ href, label, Icon, match }) => (
            <div
              key={href}
              className={`dc-nav${match(location) ? " active" : ""}`}
              onClick={() => open(href)}
              data-testid={`nav-${label.toLowerCase()}`}
              title={label}
            >
              <span className="dc-nav-ico"><Icon /></span>
              <span className="dc-nav-label">{label}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="dc-foot">
          <div className="dc-statusrow">
            <span className="dc-status" title={isAzureConnected ? "Azure DevOps connected" : "Azure DevOps not connected"}>
              <span className="dc-dot" style={{ background: isAzureConnected ? "var(--accent-green)" : "var(--text-muted)" }} />
              <span className="dc-status-label">Azure</span>
            </span>
            <span className="dc-status" title={isJiraConnected ? "Jira connected" : "Jira not connected"}>
              <span className="dc-dot" style={{ background: isJiraConnected ? "var(--accent-green)" : "var(--text-muted)" }} />
              <span className="dc-status-label">Jira</span>
            </span>
          </div>

          <ThemeToggle />

          <div className="dc-footrow">
            <div className="dc-user" title={displayName}>
              {user?.imageUrl
                ? <img className="dc-avatar" src={user.imageUrl} alt={displayName} />
                : <span className="dc-avatar dc-avatar-fb">{initials}</span>}
              <span className="dc-username">{displayName}</span>
            </div>
            <button className="dc-iconbtn" onClick={() => open("/settings")} title="Settings" aria-label="Settings" data-testid="nav-settings">
              <SettingsIcon />
            </button>
            <button className="dc-iconbtn dc-iconbtn-danger" onClick={() => signOut()} title="Sign out" aria-label="Sign out" data-testid="signout">
              <SignOutIcon />
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}
