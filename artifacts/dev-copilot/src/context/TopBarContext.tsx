import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface TopBarSlotValue {
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
}

const TopBarSlotContext = createContext<TopBarSlotValue | null>(null);

/**
 * Presentational slot so a page can render its own action buttons into the
 * shared TopBar (which lives in AppShell). This is additive UI plumbing —
 * it does not alter any existing context or data flow.
 */
export function TopBarSlotProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <TopBarSlotContext.Provider value={{ actions, setActions }}>
      {children}
    </TopBarSlotContext.Provider>
  );
}

export function useTopBarSlot(): TopBarSlotValue {
  const ctx = useContext(TopBarSlotContext);
  if (!ctx) throw new Error("useTopBarSlot must be used inside TopBarSlotProvider");
  return ctx;
}

/**
 * Register top-bar action buttons for the current page. The `node` is a
 * snapshot of the page's buttons; pass anything the buttons close over
 * (busy flags, ids) in `deps` so the snapshot refreshes. Cleared on unmount.
 */
export function useTopBarActions(node: ReactNode, deps: unknown[]) {
  const { setActions } = useTopBarSlot();
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
