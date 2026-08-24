import { useLocation, useParams } from "wouter";
import { BarChart2, ShieldCheck } from "lucide-react";
import { useTeam } from "@/context/TeamContext";

// The Reports-specific left sidebar. Rendered by AppShell in place of the
// project-scoped ContextPanel while on /reports, so it never touches the
// project sidebar's rendering path. Tabs: Overview (the existing analytics) and
// Admin (role-gated). Manager/Executive are intentionally hidden until their
// phases — a disabled/"coming soon" row would just be noise today. Tabs are
// path-based (/reports, /reports/admin) because wouter's location ignores the
// query string and would not re-render on a ?tab change.

export function ReportsSidebar() {
  const [, navigate] = useLocation();
  const { isAdmin } = useTeam();
  const params = useParams<{ tab?: string }>();
  const tab = params.tab ?? "overview";

  const items: { key: string; label: string; href: string; icon: typeof BarChart2 }[] = [
    { key: "overview", label: "Overview", href: "/reports", icon: BarChart2 },
    ...(isAdmin ? [{ key: "admin", label: "Admin", href: "/reports/admin", icon: ShieldCheck }] : []),
  ];

  return (
    <div
      style={{
        width: "var(--panel-w)",
        minWidth: "var(--panel-w)",
        flexShrink: 0,
        height: "100vh",
        background: "var(--c-surface)",
        borderRight: "1px solid var(--c-border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--sans)",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--c-border)" }}>
        <div style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--c-ink)" }}>Reports</div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>Team-wide insights</div>
      </div>
      <nav style={{ padding: "8px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map(({ key, label, href, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => navigate(href)}
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                borderRadius: 6,
                border: "none",
                background: active ? "var(--c-blue-bg)" : "transparent",
                color: active ? "var(--c-blue)" : "var(--c-ink-2)",
                fontSize: "var(--fs-sm)",
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Icon size={14} strokeWidth={1.75} />
              {label}
            </button>
          );
        })}
      </nav>
      <div style={{ marginTop: "auto", padding: "10px 14px", borderTop: "1px solid var(--c-border)" }}>
        <button
          onClick={() => navigate("/dashboard")}
          style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          ← Back to workspace
        </button>
      </div>
    </div>
  );
}
