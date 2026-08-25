import { useLocation, useParams } from "wouter";
import { ShieldCheck, LineChart } from "lucide-react";
import { useTeam } from "@/context/TeamContext";

// The Reports-specific left sidebar. Rendered by AppShell on the Admin and
// Executive reports screens (/reports/admin, /reports/executive), in place of the
// project-scoped ContextPanel, so it never touches the project sidebar's path.
// Both items are admin-only. The Manager analytics view (/reports) keeps the
// normal ContextPanel and is unchanged.

export function ReportsSidebar() {
  const [, navigate] = useLocation();
  const { isAdmin } = useTeam();
  const params = useParams<{ tab?: string }>();
  const tab = params.tab ?? "";

  const items: { key: string; label: string; href: string; icon: typeof ShieldCheck }[] = isAdmin
    ? [
        { key: "admin", label: "Admin", href: "/reports/admin", icon: ShieldCheck },
        { key: "executive", label: "Executive", href: "/reports/executive", icon: LineChart },
      ]
    : [];

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
      <div style={{ marginTop: "auto", padding: "10px 14px", borderTop: "1px solid var(--c-border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={() => navigate("/reports")}
          style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          ← Delivery analytics
        </button>
        <button
          onClick={() => navigate("/dashboard")}
          style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          ← Back to workspace
        </button>
      </div>
    </div>
  );
}
