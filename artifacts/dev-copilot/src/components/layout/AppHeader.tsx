import { useUser, useClerk } from "@clerk/react";
import { useTabs } from "@/context/TabsContext";

interface AppHeaderProps {
  isAzureConnected: boolean;
  isJiraConnected: boolean;
}

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="2.3" /><path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </svg>
);
const SignOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6" />
  </svg>
);

export function AppHeader({ isAzureConnected, isJiraConnected }: AppHeaderProps) {
  const { open } = useTabs();
  const { user } = useUser();
  const { signOut } = useClerk();

  const initials = user
    ? ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? user.username?.[0] ?? "")).toUpperCase() || "BM"
    : "BM";

  const dot = (connected: boolean, label: string) => (
    <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span
        style={{
          width: 7, height: 7, display: "block",
          background: connected ? "var(--color-success)" : "var(--color-neutral-400)",
        }}
      />
      <span style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{label}</span>
    </span>
  );

  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 20, height: "var(--header-h)",
        background: "var(--color-bg)", borderBottom: "2px solid var(--color-divider)",
        display: "flex", alignItems: "center", gap: 20, padding: "0 24px",
        overflowX: "auto", flexShrink: 0,
      }}
    >
      {/* Brand */}
      <button
        onClick={() => open("/dashboard")}
        style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}
        aria-label="Blue Mantis"
      >
        <img src={`${import.meta.env.BASE_URL}bluemantis-mark.png`} alt="" style={{ height: 24, width: "auto" }} />
        <span style={{ fontSize: 16, fontWeight: 800, color: "var(--color-text)" }}>Blue Mantis</span>
      </button>

      {/* Right */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        {dot(isJiraConnected, "Jira")}
        {dot(isAzureConnected, "Azure")}
        <span
          style={{
            width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--color-accent-100)", border: "1px solid var(--color-neutral-300)",
            color: "var(--color-accent-700)", fontSize: 11, fontWeight: 800,
          }}
        >
          {initials}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => open("/settings")} aria-label="Settings" title="Settings" style={{ padding: 6 }}>
          <SettingsIcon />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => signOut()} aria-label="Sign out" title="Sign out" style={{ padding: 6 }}>
          <SignOutIcon />
        </button>
      </div>
    </header>
  );
}
