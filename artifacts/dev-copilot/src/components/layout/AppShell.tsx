import type { ReactNode } from "react";
import { CommandRail } from "./CommandRail";
import { ContextPanel } from "./ContextPanel";
import { TopBar } from "./TopBar";
import { TabsProvider } from "@/context/TabsContext";
import { TopBarSlotProvider } from "@/context/TopBarContext";
import { Toaster } from "@/components/ui/toaster";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  // TabsProvider stays mounted because other components still read useTabs();
  // the TabBar itself is no longer rendered (navigation is via the rail/panel).
  return (
    <TabsProvider>
      <TopBarSlotProvider>
        <div style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "var(--sans)" }}>
          <CommandRail />
          <ContextPanel />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <TopBar />
            <main
              data-testid="app-main"
              style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--c-bg)" }}
            >
              {children}
            </main>
          </div>
        </div>
        <Toaster />
      </TopBarSlotProvider>
    </TabsProvider>
  );
}
