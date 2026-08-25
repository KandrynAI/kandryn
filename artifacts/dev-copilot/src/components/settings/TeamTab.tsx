import { useEffect, useState } from "react";
import { useTeam } from "@/context/TeamContext";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Check, Loader2 } from "lucide-react";
import { SecretInput, StatusPill, isSecret, tone, GREEN, RED } from "@/components/settings/credentials";
import {
  fetchTeamIntegrations,
  setTeamIntegration,
  fetchTeamMembers,
  fetchInvites,
  createTeamInvite,
  cancelInvite,
  removeTeamMember,
  updateMemberRole,
  updateTeamSettings,
  ApiError,
  type TeamIntegrationRow,
  type TeamMemberRow,
  type TeamInviteRow,
} from "@/services/api";

const CRED_GROUPS: { label: string; note: string; testKey: string; fields: { key: string; label: string }[] }[] = [
  {
    label: "Jira",
    note: "Shared across all team members",
    testKey: "jira",
    fields: [
      { key: "JIRA_DOMAIN", label: "Domain" },
      { key: "JIRA_EMAIL", label: "Account email" },
      { key: "JIRA_API_TOKEN", label: "API token" },
    ],
  },
  {
    label: "Azure DevOps",
    note: "Shared across all team members",
    testKey: "azuredevops",
    fields: [
      { key: "AZURE_DEVOPS_ORG", label: "Organisation" },
      { key: "AZURE_DEVOPS_PROJECT", label: "Project" },
      { key: "AZURE_DEVOPS_PAT", label: "Personal Access Token" },
    ],
  },
  {
    label: "Confluence",
    note: "For Narratia runbook push",
    testKey: "confluence",
    fields: [
      { key: "CONFLUENCE_DOMAIN", label: "Domain" },
      { key: "CONFLUENCE_EMAIL", label: "Account email" },
      { key: "CONFLUENCE_API_TOKEN", label: "API token" },
      { key: "CONFLUENCE_SPACE_KEY", label: "Space key" },
    ],
  },
  {
    label: "Notion",
    note: "For Narratia runbook push",
    testKey: "notion",
    fields: [
      { key: "NOTION_API_TOKEN", label: "Integration token" },
      { key: "NOTION_PARENT_PAGE", label: "Parent page ID" },
    ],
  },
];

const groupLabel: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--c-ink-4)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  marginBottom: 10,
};

function initials(id: string): string {
  return id.replace(/^user_/, "").slice(0, 2).toUpperCase();
}

function TeamCredField({
  fieldKey,
  label,
  isSet,
  canEdit,
  onSaved,
  teamId,
}: {
  fieldKey: string;
  label: string;
  isSet: boolean;
  canEdit: boolean;
  onSaved: () => void;
  teamId: number;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await setTeamIntegration(teamId, fieldKey, value.trim());
      setValue("");
      toast({ title: `${label} saved` });
      onSaved();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const placeholder = isSet ? "••••••••  (enter a new value to replace)" : "Not set";
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-foreground">
        <span>{label}</span>
        <StatusPill set={isSet} />
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          {isSecret(fieldKey) ? (
            <SecretInput value={value} onChange={setValue} placeholder={placeholder} disabled={!canEdit} />
          ) : (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={!canEdit}
              className="h-9 font-mono text-sm"
              type="text"
              autoComplete="off"
            />
          )}
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" className="h-9" onClick={save} disabled={saving || !value.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** One team integration: its credential fields plus a Test-connection button
 *  that verifies the team's saved credentials (teamId-scoped) via the shared endpoint. */
function TeamCredGroup({
  group,
  setKeys,
  canEdit,
  teamId,
  onSaved,
}: {
  group: (typeof CRED_GROUPS)[number];
  setKeys: Set<string>;
  canEdit: boolean;
  teamId: number;
  onSaved: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/config/test/${group.testKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: "Network error — could not reach the server" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={groupLabel}>
        {group.label}{" "}
        <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--c-ink-4)", fontWeight: 400 }}>· {group.note}</span>
      </div>
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        {group.fields.map((f) => (
          <TeamCredField
            key={f.key}
            fieldKey={f.key}
            label={f.label}
            isSet={setKeys.has(f.key)}
            canEdit={canEdit}
            teamId={teamId}
            onSaved={onSaved}
          />
        ))}

        {testResult && (
          <div className="flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-[13px]" style={tone(testResult.ok ? GREEN : RED)}>
            {testResult.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />} {testResult.message}
          </div>
        )}

        <div>
          <Button variant="outline" size="sm" className="h-9" onClick={handleTest} disabled={testing}>
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function TeamTab() {
  const { team, isAdmin, effectiveAuditRetentionDays, refetch } = useTeam();
  const { toast } = useToast();
  const [integrations, setIntegrations] = useState<TeamIntegrationRow[]>([]);
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [invites, setInvites] = useState<TeamInviteRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [sending, setSending] = useState(false);
  const [retentionInput, setRetentionInput] = useState("");
  const [savingRetention, setSavingRetention] = useState(false);

  const teamId = team?.id;

  useEffect(() => {
    setRetentionInput(team?.auditRetentionDays != null ? String(team.auditRetentionDays) : "");
  }, [team?.auditRetentionDays]);

  const loadIntegrations = () => {
    if (teamId == null) return;
    fetchTeamIntegrations(teamId).then(setIntegrations).catch(() => {});
  };
  const loadMembers = () => {
    if (teamId == null) return;
    fetchTeamMembers(teamId).then(setMembers).catch(() => {});
  };
  const loadInvites = () => {
    if (teamId == null || !isAdmin) return;
    fetchInvites(teamId).then(setInvites).catch(() => {});
  };

  useEffect(() => {
    loadIntegrations();
    loadMembers();
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, isAdmin]);

  if (!team || teamId == null) return null;

  const setKeys = new Set(integrations.map((i) => i.key));

  const sendInvite = async () => {
    if (!email.trim()) return;
    setSending(true);
    try {
      await createTeamInvite(teamId, email.trim(), role);
      toast({ title: `Invite sent to ${email.trim()}` });
      setEmail("");
      loadInvites();
    } catch (err) {
      toast({
        title: err instanceof ApiError && err.status === 409 ? "Could not invite" : "Invite failed",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const saveRetention = async () => {
    const trimmed = retentionInput.trim();
    let value: number | null;
    if (trimmed === "") {
      value = null; // reset to plan default
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        toast({ title: "Enter 1–3650 days, or blank for the plan default", variant: "destructive" });
        return;
      }
      value = n;
    }
    setSavingRetention(true);
    try {
      await updateTeamSettings(teamId, { auditRetentionDays: value });
      toast({ title: "Audit retention updated" });
      refetch();
    } catch (err) {
      toast({ title: "Could not update retention", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingRetention(false);
    }
  };

  // Aegis "security finding type" preference (Jira only). Hidden for ADO-only teams.
  const aegisPref = (integrations.find((i) => i.key === "AEGIS_JIRA_ISSUE_TYPE")?.value ?? "smart") as
    | "bug"
    | "subtask"
    | "smart";
  const isAdoOnly = setKeys.has("AZURE_DEVOPS_ORG") && !setKeys.has("JIRA_DOMAIN");
  const saveAegisPref = async (value: "bug" | "subtask" | "smart") => {
    try {
      await setTeamIntegration(teamId, "AEGIS_JIRA_ISSUE_TYPE", value);
      toast({ title: "Security finding type updated" });
      loadIntegrations();
    } catch (err) {
      toast({ title: "Could not save", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div>
      {!isAdmin && (
        <div className="mb-5 rounded-md border px-3.5 py-2.5 text-[13px]" style={{ color: "var(--c-amber)", background: "var(--c-amber-bg)", borderColor: "var(--c-amber)" }}>
          Team credentials can only be changed by an admin. Contact your team owner to update these.
        </div>
      )}

      {/* Team credentials */}
      {CRED_GROUPS.map((group) => (
        <TeamCredGroup
          key={group.label}
          group={group}
          setKeys={setKeys}
          canEdit={isAdmin}
          teamId={teamId}
          onSaved={loadIntegrations}
        />
      ))}

      {/* Aegis security-finding type (Jira only) */}
      {!isAdoOnly && (
        <div style={{ marginBottom: 24 }}>
          <div style={groupLabel}>
            Security finding type{" "}
            <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--c-ink-4)", fontWeight: 400 }}>
              · How Aegis findings are created in Jira
            </span>
          </div>
          <div className="flex flex-col gap-2.5 rounded-md border bg-card p-4">
            {([
              ["bug", "Bug", "Standalone issue on the board (recommended for High/Critical)"],
              ["subtask", "Sub-task", "Child of the original story (recommended for Medium/Low)"],
              ["smart", "Smart", "Bug for High/Critical, Sub-task for Medium/Low (default)"],
            ] as const).map(([value, label, desc]) => (
              <label
                key={value}
                style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: isAdmin ? "pointer" : "default", opacity: isAdmin ? 1 : 0.7 }}
              >
                <input
                  type="radio"
                  name="aegis-issue-type"
                  checked={aegisPref === value}
                  disabled={!isAdmin}
                  onChange={() => saveAegisPref(value)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span className="text-xs font-medium text-foreground">{label}</span>
                  <span className="block text-[11px] text-muted-foreground">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Audit-log retention */}
      <div style={{ marginBottom: 24 }}>
        <div style={groupLabel}>
          Audit-log retention{" "}
          <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--c-ink-4)", fontWeight: 400 }}>
            · How long audit history is kept
          </span>
        </div>
        <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Currently retaining audit history for{" "}
            <strong>{effectiveAuditRetentionDays ?? "—"} days</strong>
            {team.auditRetentionDays == null ? ` (your ${team.plan} plan default)` : " (custom)"}. Set a custom number of
            days to retain longer — regulated teams often keep multi-year history. Leave blank to use the plan default.
          </p>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={3650}
                value={retentionInput}
                onChange={(e) => setRetentionInput(e.target.value)}
                placeholder={`${effectiveAuditRetentionDays ?? ""} (default)`}
                className="h-9 w-32"
              />
              <span className="text-xs text-muted-foreground">days</span>
              <Button
                size="sm"
                className="h-9"
                onClick={saveRetention}
                disabled={savingRetention || retentionInput === (team.auditRetentionDays != null ? String(team.auditRetentionDays) : "")}
              >
                {savingRetention ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Only a team admin can change retention.</p>
          )}
        </div>
      </div>

      {/* Members */}
      <div style={{ marginBottom: 24 }}>
        <div style={groupLabel}>Team members</div>
        <div className="rounded-md border bg-card overflow-hidden">
          {members.map((m) => {
            const isOwner = m.userId === team.ownerUserId;
            return (
              <div key={m.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
                  {initials(m.userId)}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {m.userId}
                  {isOwner && <span className="ml-2 text-[10px] uppercase text-muted-foreground">owner</span>}
                </span>
                {isAdmin && !isOwner ? (
                  <>
                    <select
                      value={m.role}
                      onChange={async (e) => {
                        try {
                          await updateMemberRole(teamId, m.userId, e.target.value as "admin" | "member");
                          loadMembers();
                        } catch (err) {
                          toast({ title: "Could not change role", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
                        }
                      }}
                      className="h-7 rounded-md border bg-background px-2 text-xs"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={async () => {
                        try {
                          await removeTeamMember(teamId, m.userId);
                          loadMembers();
                        } catch (err) {
                          toast({ title: "Could not remove", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{m.role}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {members.length} member{members.length === 1 ? "" : "s"} · <span className="capitalize">{team.plan}</span> plan
        </div>
      </div>

      {/* Invites (admin only) */}
      {isAdmin && (
        <div style={{ marginBottom: 24 }}>
          <div style={groupLabel}>Invite members</div>
          <div className="flex gap-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" className="h-9" type="email" />
            <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button size="sm" className="h-9" onClick={sendInvite} disabled={sending || !email.trim()}>
              {sending ? "Sending…" : "Send invite"}
            </Button>
          </div>

          {invites.length > 0 && (
            <div className="mt-3 rounded-md border bg-card overflow-hidden">
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 text-xs">
                  <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                  <span className="uppercase text-muted-foreground">{inv.role}</span>
                  {inv.acceptedAt ? (
                    <span className="inline-flex items-center gap-1 text-[var(--c-green)]"><Check className="h-3.5 w-3.5" /> Accepted</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">Expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                      <button
                        title="Cancel invite"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={async () => {
                          try {
                            await cancelInvite(teamId, inv.id);
                            loadInvites();
                          } catch { /* ignore */ }
                        }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
