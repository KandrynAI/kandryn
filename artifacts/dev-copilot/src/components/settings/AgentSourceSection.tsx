import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ApiError, fetchAgentKeySource, saveAgentKeySource, type AgentKeySourceState } from "@/services/api";
import {
  AGENT_SOURCE_HELP,
  AGENT_SOURCE_LABEL,
  canSelect,
  kandrynBlockedReason,
  type AgentSource,
} from "@/lib/agentSource";

/**
 * Whose credentials Raptia and Fovea run on.
 *
 * Sits above the two credential cards rather than inside either, because one
 * choice covers both agents: the screen has never had a per-agent option, and
 * a user whose Raptia was funded by Kandryn and Fovea by themselves would get
 * a run that silently drops to one candidate.
 *
 * All logic worth testing lives in lib/agentSource.ts (a .tsx cannot be tested
 * here). This file owns markup, the fetch and the four states it can be in.
 */
export function AgentSourceSection({ onChanged }: { onChanged?: (source: AgentSource) => void }) {
  const [state, setState] = useState<AgentKeySourceState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState<AgentSource | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchAgentKeySource()
      .then((s) => { if (live) { setState(s); onChanged?.(s.source); } })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
    // Once on mount: the value only changes through this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (next: AgentSource) => {
    if (!state || state.source === next) return;
    setSaving(next);
    setSaveError(null);
    try {
      await saveAgentKeySource(next);
      const updated = { ...state, source: next };
      setState(updated);
      onChanged?.(next);
    } catch (err) {
      // The server refuses what this screen disables, so a failure here is
      // either a race with an environment change or a network problem. Show
      // the server's sentence when there is one; it is already plain.
      setSaveError(err instanceof ApiError ? err.message : "That did not save. Try again.");
    } finally {
      setSaving(null);
    }
  };

  const blocked = kandrynBlockedReason(state);

  return (
    <>
      <style>{`
        .as-wrap { border: 1px solid var(--c-border); border-radius: 6px;
          background: var(--c-surface); padding: 12px 14px; margin-bottom: 12px; }
        .as-opt { display: flex; gap: 9px; align-items: flex-start; padding: 7px 0; }
        .as-opt + .as-opt { border-top: 1px solid var(--c-border); }
        .as-opt input { margin-top: 2px; accent-color: var(--c-blue); }
        .as-opt label { font-size: 13px; color: var(--c-ink); cursor: pointer; }
        .as-opt.is-off label, .as-opt.is-off .as-help { opacity: 0.6; cursor: default; }
        .as-help { display: block; font-size: var(--fs-sm); color: var(--c-ink-4);
          margin-top: 2px; line-height: 1.5; }
        .as-note { margin-top: 10px; padding: 8px 11px; border-radius: 5px;
          background: var(--c-amber-bg); border: 1px solid var(--c-amber);
          font-size: var(--fs-sm); line-height: 1.5; color: var(--c-ink-2); }
        .as-kept { margin-top: 10px; font-size: var(--fs-sm); color: var(--c-ink-4); line-height: 1.5; }
        .as-skel { height: 58px; border-radius: 5px; background: var(--c-raised);
          animation: dc-pulse 1.5s ease-in-out infinite; }
      `}</style>

      <div className="as-wrap" data-testid="agent-source">
        {loadError ? (
          <div className="as-note">
            Could not load your agent credentials setting. The credential cards below still work.
          </div>
        ) : !state ? (
          <div className="as-skel" aria-busy="true" aria-label="Loading" />
        ) : (
          <>
            {(["own", "kandryn"] as AgentSource[]).map((opt) => {
              const selectable = canSelect(opt, state, saving !== null);
              return (
                <div key={opt} className={`as-opt${selectable ? "" : " is-off"}`}>
                  <input
                    type="radio"
                    id={`agent-source-${opt}`}
                    name="agent-source"
                    checked={state.source === opt}
                    disabled={!selectable}
                    onChange={() => void choose(opt)}
                  />
                  <div>
                    <label htmlFor={`agent-source-${opt}`}>
                      {AGENT_SOURCE_LABEL[opt]}
                      {saving === opt && <Loader2 size={12} className="animate-spin" style={{ marginLeft: 6, display: "inline" }} />}
                    </label>
                    <span className="as-help">{AGENT_SOURCE_HELP[opt]}</span>
                  </div>
                </div>
              );
            })}

            {blocked && <div className="as-note">{blocked}</div>}
            {saveError && <div className="as-note">{saveError}</div>}
            {state.source === "kandryn" && (
              <div className="as-kept">Your own credentials are saved and will be used again if you switch back.</div>
            )}
          </>
        )}
      </div>
    </>
  );
}
