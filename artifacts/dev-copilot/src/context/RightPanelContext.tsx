import { createContext, useContext, useState, type ReactNode } from "react";

/** What the shared right panel is currently showing. */
export type RightPanelView =
  | { type: "run-list"; status: "running" | "completed" | "scheduled" | "awaiting_review"; projectId: number }
  | { type: "bugs"; filter: "open" | "all"; projectId: number }
  | { type: "run-detail"; runId: number }
  | null;

interface RightPanelContextValue {
  view: RightPanelView;
  open: (v: NonNullable<RightPanelView>) => void;
  close: () => void;
}

const RightPanelContext = createContext<RightPanelContextValue>({
  view: null,
  open: () => {},
  close: () => {},
});

export function RightPanelProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RightPanelView>(null);
  return (
    <RightPanelContext.Provider value={{ view, open: setView, close: () => setView(null) }}>
      {children}
    </RightPanelContext.Provider>
  );
}

export function useRightPanel() {
  return useContext(RightPanelContext);
}
