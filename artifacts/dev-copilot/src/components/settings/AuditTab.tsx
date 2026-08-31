import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Download, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useTeam } from "@/context/TeamContext";
import {
  fetchAuditLog,
  fetchAuditActions,
  fetchTeamMembers,
  verifyAuditIntegrity,
  auditLogCsvUrl,
  type AuditLogItem,
  type AuditIntegrity,
  type TeamMemberRow,
} from "@/services/api";

const ACTION_LABELS: Record<string, string> = {
  "user.signed_in": "Sign in",
  "user.signed_out": "Sign out",
  "team.created": "Team created",
  "member.invited": "Member invited",
  "member.joined": "Member joined",
  "member.removed": "Member removed",
  "member.role_changed": "Role changed",
  "invite.canceled": "Invite canceled",
  "credential.set": "Credential saved",
  "credential.deleted": "Credential deleted",
  "team_credential.set": "Team credential saved",
  "team_credential.deleted": "Team credential deleted",
  "project.created": "Project created",
  "project.updated": "Project settings changed",
  "project.deleted": "Project deleted",
  "project.synced": "Board synced",
  "repository.connected": "Repository connected",
  "repository.deleted": "Repository removed",
  "run.triggered": "Run triggered",
  "run.scheduled": "Run scheduled",
  "run.committed": "Suggestion committed",
  "run.override_committed": "Committed past coherence gate",
  "run.canceled": "Run canceled",
  "run.failed": "Run failed",
  "plan.generated": "Plan generated",
  "plan.edited": "Plan edited",
  "plan.file_removed": "Plan file removed",
  "plan.file_added": "Plan file added",
  "plan.regenerated": "Plan regenerated",
  "plan.failed": "Planning failed",
  "aegis.scan_run": "Aegis security scan",
  "aegis.finding_pushed": "Security finding pushed",
  "aegis.remediation_started": "Remediation started",
  "narratia.runbook_generated": "Runbook generated",
  "narratia.runbook_pushed": "Runbook pushed",
  "veria.review_run": "Veria review",
  "tests.generated": "Tests generated",
  "tests.committed": "Tests committed",
  "tests.pushed_to_plm": "Tests pushed to PLM",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Coloured dot by category (first dot-segment of the action). */
function categoryColor(action: string): string {
  if (action.startsWith("user.")) return "var(--c-ink-4)";
  if (action.startsWith("team") || action.startsWith("member") || action.startsWith("invite")) return "var(--c-blue)";
  if (action.includes("credential")) return "#d97706";
  if (action.startsWith("project") || action.startsWith("repository")) return "#0d9488";
  if (action === "run.override_committed") return "#d97706"; // amber — a gate override stands out
  if (action.startsWith("run.")) return action === "run.failed" || action === "run.canceled" ? "#dc2626" : "#16a34a";
  if (action.startsWith("plan.")) return action === "plan.failed" ? "#dc2626" : "#6366f1";
  if (action.startsWith("aegis") || action.startsWith("narratia") || action.startsWith("veria") || action.startsWith("tests")) return "#7c3aed";
  return "var(--c-ink-4)";
}

function baseName(v: unknown): string {
  const s = String(v ?? "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

function formatMetadata(action: string, meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  switch (action) {
    case "run.committed":
      return `${meta.agent ?? ""}${meta.score ? ` · score ${meta.score}` : ""}${meta.prUrl ? " · PR opened" : ""}`;
    case "run.override_committed":
      return `suggestion #${meta.suggestionId ?? "?"} · ${meta.findingsSummary ?? "coherence override"}`;
    case "project.updated":
      return meta.confidenceThreshold && typeof meta.confidenceThreshold === "object"
        ? `confidence threshold ${(meta.confidenceThreshold as { from?: unknown }).from ?? "?"} → ${(meta.confidenceThreshold as { to?: unknown }).to ?? "?"}`
        : "settings changed";
    case "member.invited":
      return `${meta.email ?? ""} as ${meta.role ?? ""}`;
    case "member.role_changed":
      return `→ ${meta.newRole ?? ""}`;
    case "member.removed":
      return `${meta.removedUserId ?? ""}`;
    case "credential.set":
    case "credential.deleted":
    case "team_credential.set":
      return `key: ${meta.key ?? ""}`;
    case "project.synced":
      return `${meta.itemsSynced ?? 0} items synced`;
    case "project.created":
    case "project.deleted":
    case "repository.connected":
    case "repository.deleted":
      return `${meta.name ?? ""}`;
    case "aegis.scan_run":
      return `gate: ${meta.gateDecision ?? ""}${meta.highCount ? ` · ${meta.highCount} high` : ""}`;
    case "narratia.runbook_generated":
      return `target: ${meta.target ?? ""}${meta.pushedUrl ? " · pushed" : ""}`;
    case "plan.generated":
      return `${meta.fileCount ?? 0} files · ${meta.candidateCount ?? 0} candidates · ${meta.retrievalMode ?? "?"} · ${meta.planningMs ?? 0}ms · ${Number(meta.inputTokens ?? 0) + Number(meta.outputTokens ?? 0)} tok`;
    case "plan.file_removed":
      return `removed ${baseName(meta.filePath)} · ${meta.inCandidates ? "was retrieved" : "not retrieved"}`;
    case "plan.file_added":
      return `added ${baseName(meta.filePath)} · ${meta.addedSource ?? "manual"} · ${meta.inCandidates ? "retrieval hit" : "retrieval miss"}`;
    case "plan.edited":
      return `revision ${meta.revision ?? ""} · ${meta.fileCount ?? 0} files`;
    case "plan.regenerated":
      return `revision ${meta.revision ?? ""}`;
    case "plan.failed":
      return `${meta.error ?? "no plan produced"}`;
    default:
      return Object.entries(meta)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
  }
}

const cell: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--c-ink-3)",
  padding: "8px 12px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const mono: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 11, color: "var(--c-ink-4)" };
const groupLabel: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--c-ink-4)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  marginBottom: 10,
};

const GRID = "150px 150px 170px 110px 1fr 110px";

export default function AuditTab() {
  const { team, isAdmin } = useTeam();
  const teamId = team?.id;

  const [days, setDays] = useState(30);
  const [action, setAction] = useState("");
  const [memberId, setMemberId] = useState("");

  const [actions, setActions] = useState<string[]>([]);
  const [members, setMembers] = useState<TeamMemberRow[]>([]);

  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [before, setBefore] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initial, setInitial] = useState(true);

  const [integrity, setIntegrity] = useState<AuditIntegrity | null>(null);
  const [verifying, setVerifying] = useState(false);
  const runVerify = () => {
    setVerifying(true);
    verifyAuditIntegrity()
      .then(setIntegrity)
      .catch(() => setIntegrity(null))
      .finally(() => setVerifying(false));
  };

  useEffect(() => {
    fetchAuditActions().then((r) => setActions(r.actions)).catch(() => {});
    if (teamId != null) fetchTeamMembers(teamId).then(setMembers).catch(() => {});
    if (teamId != null) runVerify();
  }, [teamId]);

  const load = async (reset = false) => {
    setLoading(true);
    try {
      const res = await fetchAuditLog({
        days,
        action: action || undefined,
        userId: memberId || undefined,
        before: reset ? undefined : before,
        limit: 50,
      });
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setHasMore(res.hasMore);
      setBefore(res.nextBefore ?? undefined);
    } catch {
      if (reset) setItems([]);
    } finally {
      setLoading(false);
      setInitial(false);
    }
  };

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, action, memberId]);

  if (!team || !isAdmin) return null;

  const ranges = team.plan === "enterprise" ? [7, 30, 90, 365] : [7, 30, 90];

  return (
    <div>
      <style>{`
        .al-pill { font-size: var(--fs-sm); font-weight: 500; padding: 4px 11px; border-radius: 6px;
          border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-ink-3); cursor: pointer; }
        .al-pill:hover { background: var(--c-raised); }
        .al-pill.active { background: var(--c-blue-bg); color: var(--c-blue); border-color: var(--c-blue); }
        .al-select { height: 30px; font-size: var(--fs-sm); border: 1px solid var(--c-border); border-radius: 6px;
          background: var(--c-surface); color: var(--c-ink-2); padding: 0 8px; max-width: 200px; }
        .al-export { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
          font-size: var(--fs-sm); font-weight: 500; border-radius: 6px; cursor: pointer;
          border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-ink-2); }
        .al-export:hover { background: var(--c-raised); }
        .al-row:hover { background: var(--c-raised); }
        .al-more { font-size: var(--fs-sm); font-weight: 500; padding: 6px 16px; border-radius: 6px;
          border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-ink-2); cursor: pointer; }
        .al-more:hover { background: var(--c-raised); }
      `}</style>

      {/* Free-plan upsell */}
      {team.plan === "free" && (
        <div
          className="mb-4 flex items-center justify-between gap-3 rounded"
          style={{ background: "var(--c-blue-bg)", border: "1px solid var(--c-blue)", padding: "8px 12px", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}
        >
          <span>Free plan retains 30 days of audit history. Upgrade to Pro for 90 days, or Enterprise for 1 year.</span>
          <a href="/contact/" className="al-pill" style={{ whiteSpace: "nowrap" }}>Upgrade →</a>
        </div>
      )}

      {/* Tamper-evidence (governance item 7) */}
      <div
        className="mb-4 flex items-center gap-3 rounded"
        style={{
          border: `1px solid ${integrity && !integrity.ok ? "var(--c-red)" : "var(--c-border)"}`,
          background: integrity && !integrity.ok ? "var(--c-red-bg)" : "var(--c-surface)",
          padding: "8px 12px",
          fontSize: "var(--fs-sm)",
        }}
      >
        {integrity && !integrity.ok ? (
          <ShieldAlert size={15} style={{ color: "var(--c-red)", flexShrink: 0 }} />
        ) : (
          <ShieldCheck size={15} style={{ color: integrity ? "var(--c-green)" : "var(--c-ink-4)", flexShrink: 0 }} />
        )}
        <span style={{ color: "var(--c-ink-2)" }}>
          {verifying
            ? "Verifying audit-log integrity…"
            : integrity == null
              ? "Audit log is hash-chained (tamper-evident)."
              : integrity.ok
                ? `Integrity verified — ${integrity.rowsChecked} chained ${integrity.rowsChecked === 1 ? "entry" : "entries"}, no tampering detected.`
                : `Integrity check FAILED — the chain breaks at entry #${integrity.firstBrokenId}. Contact support.`}
          {integrity && !verifying && (
            <span style={{ color: "var(--c-ink-4)" }}> · checked {new Date(integrity.checkedAt).toLocaleString()}</span>
          )}
        </span>
        <button className="al-export" style={{ marginLeft: "auto" }} onClick={runVerify} disabled={verifying}>
          {verifying ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Re-check
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {ranges.map((d) => (
            <button key={d} className={`al-pill${days === d ? " active" : ""}`} onClick={() => setDays(d)}>
              {d}d
            </button>
          ))}
        </div>
        <select className="al-select" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{actionLabel(a)}</option>
          ))}
        </select>
        <select className="al-select" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.userId}>{m.userId.slice(0, 14)}</option>
          ))}
        </select>
        <button className="al-export" style={{ marginLeft: "auto" }} onClick={() => window.open(auditLogCsvUrl(days), "_blank")}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Table — scrolls horizontally so no column is ever clipped in the
          settings panel; the inner min-width keeps the columns aligned. */}
      <div className="rounded-md border" style={{ borderColor: "var(--c-border)", overflowX: "auto" }}>
        <div style={{ minWidth: 880 }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: GRID, background: "var(--c-surface)", borderBottom: "1px solid var(--c-border)" }}>
          {["Timestamp", "User", "Action", "Entity", "Details", "IP"].map((h) => (
            <div key={h} style={{ ...cell, fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              {h}
            </div>
          ))}
        </div>

        {initial && loading ? (
          [0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 36, borderBottom: "1px solid var(--c-border)", background: "var(--c-surface)", animation: "dc-pulse 1.5s ease-in-out infinite" }} />
          ))
        ) : items.length === 0 ? (
          <div style={{ padding: "40px 16px", textAlign: "center" }}>
            <ShieldCheck size={22} style={{ color: "var(--c-ink-4)", margin: "0 auto 8px" }} />
            <div style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-3)" }}>No audit events in this period.</div>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", marginTop: 2 }}>Events appear as your team uses Kandryn.</div>
          </div>
        ) : (
          items.map((it) => (
            <div key={it.id} className="al-row" style={{ display: "grid", gridTemplateColumns: GRID, borderBottom: "1px solid var(--c-border)", alignItems: "center" }}>
              <div style={{ ...cell, ...mono }} title={it.createdAt}>
                {format(new Date(it.createdAt), "MMM dd · HH:mm")}
              </div>
              <div style={{ ...cell, fontSize: 12, color: "var(--c-ink-2)" }} title={it.userId}>
                {it.userId.length > 16 ? `${it.userId.slice(0, 16)}…` : it.userId}
              </div>
              <div style={{ ...cell, display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: categoryColor(it.action), flexShrink: 0 }} />
                <span style={{ color: "var(--c-ink-2)" }}>{actionLabel(it.action)}</span>
              </div>
              <div style={{ ...cell, ...mono }}>
                {it.entityType ? `${it.entityType}${it.entityId != null ? ` #${it.entityId}` : ""}` : ""}
              </div>
              <div style={cell} title={formatMetadata(it.action, it.metadata)}>
                {formatMetadata(it.action, it.metadata)}
              </div>
              <div style={{ ...cell, ...mono }}>{it.ipAddress ?? ""}</div>
            </div>
          ))
        )}
        </div>
      </div>

      {hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <button className="al-more" onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Load 50 more"}
          </button>
        </div>
      )}
    </div>
  );
}
