import { useGetDashboardStats, useGetRecentActivity } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { GitCommit, CheckSquare, GitPullRequest } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();

  return (
    <div>
      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <Stat label="Repositories" value={stats?.totalRepositories} loading={statsLoading} testId="total-repositories" first />
        <Stat label="Active tasks" value={(stats?.openTasks || 0) + (stats?.inProgressTasks || 0)} loading={statsLoading} testId="active-tasks" />
        <Stat label="Completed" value={stats?.completedTasks} loading={statsLoading} testId="completed-tasks" />
        <Stat label="Linked commits" value={stats?.linkedCommits} loading={statsLoading} testId="linked-commits" />
      </div>

      {/* Recent activity */}
      <div style={{ padding: "16px 20px" }}>
        <div
          style={{
            fontSize: "var(--fs-xs)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--c-ink-4)",
            marginBottom: 10,
          }}
        >
          Recent activity
        </div>

        {activityLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !activity || activity.length === 0 ? (
          <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-4)" }}>No recent activity yet.</p>
        ) : (
          <div style={{ borderTop: "1px solid var(--c-border)" }}>
            {activity.map((item, i: number) => (
              <div
                key={item.id ?? i}
                data-testid={`activity-item-${item.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 4px",
                  borderBottom: "1px solid var(--c-border)",
                }}
              >
                <span style={{ color: "var(--c-ink-4)", display: "inline-flex" }}>
                  {item.linkedCommit ? <GitCommit size={14} /> : item.status === "done" ? <CheckSquare size={14} /> : <GitPullRequest size={14} />}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-base)", color: "var(--c-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.title}
                </span>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", fontFamily: "var(--mono)", flexShrink: 0 }}>
                  {item.updatedAt ? formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true }) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  testId,
  first,
}: {
  label: string;
  value?: number;
  loading: boolean;
  testId: string;
  first?: boolean;
}) {
  return (
    <div style={{ padding: "14px 20px", borderRight: "1px solid var(--c-border)", borderLeft: first ? "none" : undefined }}>
      {loading ? (
        <Skeleton className="h-6 w-12" />
      ) : (
        <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 600, color: "var(--c-ink)", fontFamily: "var(--mono)", lineHeight: 1 }} data-testid={`stat-${testId}`}>
          {value ?? 0}
        </div>
      )}
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}
