import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { CommandRail } from "./CommandRail";
import { ContextPanel } from "./ContextPanel";
import { ReportsSidebar } from "./ReportsSidebar";
import { RightPanel } from "./RightPanel";
import { TopBar } from "./TopBar";
import { TabsProvider } from "@/context/TabsContext";
import { TopBarSlotProvider } from "@/context/TopBarContext";
import { RightPanelProvider } from "@/context/RightPanelContext";
import { ActiveProjectProvider } from "@/context/ActiveProjectContext";
import { Toaster } from "@/components/ui/toaster";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation();
  // The Admin and Executive reports screens swap the left sidebar for their own.
  // The Manager analytics view (/reports) keeps the normal ContextPanel —
  // unchanged from before Reporting Phase A. Branching here (not inside
  // ContextPanel) means ContextPanel's project-scoped path is entirely untouched.
  const onReports = location.startsWith("/reports/admin") || location.startsWith("/reports/executive");
  // TabsProvider stays mounted because other components still read useTabs();
  // the TabBar itself is no longer rendered (navigation is via the rail/panel).
  return (
    <TabsProvider>
      <ActiveProjectProvider>
      <TopBarSlotProvider>
        <RightPanelProvider>
          <div data-testid="app-shell" style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "var(--sans)" }}>
            <CommandRail />
            {onReports ? <ReportsSidebar /> : <ContextPanel />}
            <div data-testid="app-main-col" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <TopBar />
              <main
                data-testid="app-main"
                style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--c-bg)" }}
              >
                {children}
              </main>
            </div>
          </div>
          <RightPanel />
          <Toaster />
        </RightPanelProvider>
      </TopBarSlotProvider>
      </ActiveProjectProvider>
    </TabsProvider>
  );
}
