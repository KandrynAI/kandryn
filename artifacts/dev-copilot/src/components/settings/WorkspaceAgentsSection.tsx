import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ApiError,
  fetchWorkspaceSettings,
  saveWorkspaceSettings,
  type WorkspaceSettingsState,
} from "@/services/api";
import {
  POLICY_OFF_NOTE,
  SOURCE_TAKES_EFFECT_NEXT_RUN,
  WORKSPACE_SOURCE_HELP,
  WORKSPACE_SOURCE_LABEL,
  canSelectWorkspaceSource,
  kandrynBlockedReason,
  type WorkspaceAgentSource,
} from "@/lib/agentSource";

/**
 * The two decisions a workspace admin owns: whose credentials the agents run
 * on, and whether members may override with their own.
 *
 * One choice covers both agents, as it always has: the screen has never been
 * per-agent, and a workspace funded for Raptia but not Fovea would get runs
 * that silently drop to one candidate.
 *
 * `canEdit` comes from the server, not from a role this component read for
 * itself. The server rejects a forged write regardless; this only decides
 * what to render.
 */
export function WorkspaceAgentsSection({
  teamId,
  onChanged,
}: {
  teamId: number;
  onChanged?: (s: WorkspaceSettingsState) => void;
}) {
  const [state, setState] = useState<WorkspaceSettingsState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchWorkspaceSettings(teamId)
      .then((s) => { if (live) { setState(s); onChanged?.(s); } })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const save = async (patch: Partial<WorkspaceSettingsState>, busyKey: string) => {
    setSaving(busyKey);
    setSaveError(null);
    try {
      const next = await saveWorkspaceSettings(teamId, patch);
      setState(next);
      onChanged?.(next);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "That did not save. Try again.");
    } finally {
      setSaving(null);
    }
  };

  const blocked = kandrynBlockedReason(state);

  return (
    <>
      <style>{`
        .wa-wrap { border: 1px solid var(--c-border); border-radius: 6px;
          background: var(--c-surface); padding: 12px 14px; margin-bottom: 16px; }
        .wa-opt { display: flex; gap: 9px; align-items: flex-start; padding: 7px 0; }
        .wa-opt + .wa-opt { border-top: 1px solid var(--c-border); }
        .wa-opt input { margin-top: 2px; accent-color: var(--c-blue); }
        .wa-opt label { font-size: 13px; color: var(--c-ink); cursor: pointer; }
        .wa-opt.is-off label, .wa-opt.is-off .wa-help { opacity: 0.6; cursor: default; }
        .wa-help { display: block; font-size: var(--fs-sm); color: var(--c-ink-4);
          margin-top: 2px; line-height: 1.5; }
        .wa-note { margin-top: 10px; padding: 8px 11px; border-radius: 5px;
          background: var(--c-amber-bg); border: 1px solid var(--c-amber);
          font-size: var(--fs-sm); line-height: 1.5; color: var(--c-ink-2); }
        .wa-meta { font-size: var(--fs-sm); color: var(--c-ink-4); line-height: 1.5; margin-bottom: 10px; }
        .wa-policy { display: flex; gap: 9px; align-items: flex-start;
          border-top: 1px solid var(--c-border); margin-top: 10px; padding-top: 12px; }
        .wa-skel { height: 76px; border-radius: 5px; background: var(--c-raised);
          animation: dc-pulse 1.5s ease-in-out infinite; }
      `}</style>

      <div className="wa-wrap" data-testid="workspace-agents">
        {loadError ? (
          <div className="wa-note">Could not load your workspace agent settings. Try reloading the page.</div>
        ) : !state ? (
          <div className="wa-skel" aria-busy="true" aria-label="Loading" />
        ) : (
          <>
            {!state.canEdit && <div className="wa-note" style={{ marginTop: 0, marginBottom: 10 }}>Only workspace admins can change these settings.</div>}
            <div className="wa-meta">{SOURCE_TAKES_EFFECT_NEXT_RUN}</div>

            {(["kandryn", "workspace_keys"] as WorkspaceAgentSource[]).map((opt) => {
              const selectable = canSelectWorkspaceSource(opt, state, saving !== null);
              return (
                <div key={opt} className={`wa-opt${selectable ? "" : " is-off"}`}>
                  <input
                    type="radio"
                    id={`ws-agent-${opt}`}
                    name="ws-agent-source"
                    checked={state.agentKeySource === opt}
                    disabled={!selectable}
                    onChange={() => void save({ agentKeySource: opt }, opt)}
                  />
                  <div>
                    <label htmlFor={`ws-agent-${opt}`}>
                      {WORKSPACE_SOURCE_LABEL[opt]}
                      {saving === opt && <Loader2 size={12} className="animate-spin" style={{ marginLeft: 6, display: "inline" }} />}
                    </label>
                    <span className="wa-help">{WORKSPACE_SOURCE_HELP[opt]}</span>
                  </div>
                </div>
              );
            })}

            {blocked && <div className="wa-note">{blocked}</div>}

            <div className="wa-policy">
              <input
                type="checkbox"
                id="ws-allow-personal"
                checked={state.allowPersonalCredentials}
                disabled={!state.canEdit || saving !== null}
                onChange={(e) => void save({ allowPersonalCredentials: e.target.checked }, "policy")}
                style={{ marginTop: 2, accentColor: "var(--c-blue)" }}
              />
              <div>
                <label htmlFor="ws-allow-personal" style={{ fontSize: 13, color: "var(--c-ink)", cursor: state.canEdit ? "pointer" : "default" }}>
                  Allow members to use their own credentials
                  {saving === "policy" && <Loader2 size={12} className="animate-spin" style={{ marginLeft: 6, display: "inline" }} />}
                </label>
                <span className="wa-help">{POLICY_OFF_NOTE}</span>
              </div>
            </div>

            {saveError && <div className="wa-note">{saveError}</div>}
          </>
        )}
      </div>
    </>
  );
}
