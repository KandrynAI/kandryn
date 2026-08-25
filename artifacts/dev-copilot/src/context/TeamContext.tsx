import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchMyTeam, type TeamMe } from "@/services/api";

interface TeamContextValue {
  team: TeamMe["team"];
  role: "admin" | "member" | null;
  memberCount: number;
  isAdmin: boolean;
  effectiveAuditRetentionDays: number | null;
  loading: boolean;
  refetch: () => void;
}

const TeamContext = createContext<TeamContextValue>({
  team: null,
  role: null,
  memberCount: 0,
  isAdmin: false,
  effectiveAuditRetentionDays: null,
  loading: true,
  refetch: () => {},
});

export function TeamProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TeamMe | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetchMyTeam()
      .then((result) => setData(result))
      .catch(() => setData({ team: null }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TeamContext.Provider
      value={{
        team: data?.team ?? null,
        role: data?.role ?? null,
        memberCount: data?.memberCount ?? 0,
        isAdmin: data?.role === "admin",
        effectiveAuditRetentionDays: data?.effectiveAuditRetentionDays ?? null,
        loading,
        refetch: load,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTeam = () => useContext(TeamContext);
