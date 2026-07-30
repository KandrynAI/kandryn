import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { TabsProvider } from "@/context/TabsContext";
import { useConfig } from "@/context/ConfigContext";
import { Toaster } from "@/components/ui/toaster";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { isAzureConnected, isJiraConnected } = useConfig();

  return (
    <TabsProvider>
      <div
        className="app-root"
        style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "var(--app-font-sans)" }}
      >
        <AppHeader isAzureConnected={isAzureConnected} isJiraConnected={isJiraConnected} />
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <Sidebar isAzureConnected={isAzureConnected} isJiraConnected={isJiraConnected} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <TabBar />
            <main
              data-testid="app-main"
              style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--color-bg)" }}
            >
              {children}
            </main>
          </div>
        </div>
        <Toaster />
      </div>
    </TabsProvider>
  );
}
