import { useCallback, useEffect, useState } from "react";
import { Link2Off, Loader2, ShieldAlert } from "lucide-react";
import {
  ApiError,
  completeJiraLink,
  fetchJiraLinks,
  revokeJiraLink,
} from "@/services/api";
import {
  EMPTY_LIST_TEXT,
  TYPED_ONLY_WARNING,
  canSubmit,
  prepareCode,
  siteLabel,
  sortLinks,
  stateFromError,
  submitMessage,
  type JiraLinkRow,
  type ListState,
  type SubmitState,
} from "@/lib/jiraLink";

/**
 * Connect a Jira account to Kandryn (0043, PR-B).
 *
 * Reached from the Kandryn panel inside Jira, not from Kandryn's own
 * navigation — there is no menu entry for it in phase 1, because arriving here
 * without a code in hand is a dead end.
 *
 * The person TYPES the code. This page has no other way to get one: it never
 * reads the query string or the hash, and never prefills the field. That is
 * the point of the whole flow, not a detail — a clickable link would let
 * someone mint a code against their own Jira account, send the URL to a
 * Kandryn user, and have that user's click attach the attacker's Jira account
 * to the victim's data.
 *
 * All display logic lives in `lib/jiraLink.ts` so it can be tested.
 */
export default function JiraLinkPage() {
  const [code, setCode] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [revoking, setRevoking] = useState<number | null>(null);

  const load = useCallback(async () => {
    setList({ kind: "loading" });
    try {
      const res = await fetchJiraLinks();
      setList({ kind: "ready", links: sortLinks(res.links) });
    } catch {
      setList({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit(code, submit)) return;
    setSubmit({ kind: "submitting" });
    try {
      const res = await completeJiraLink(prepareCode(code));
      setSubmit({ kind: "success", siteUrl: res.siteUrl });
      setCode("");
      await load();
    } catch (err) {
      // The status is the only thing read: the server's message is deliberately
      // uniform, and the page must not invent a more specific one.
      setSubmit(stateFromError(err instanceof ApiError ? err.status : undefined));
    }
  }

  async function onDisconnect(id: number) {
    setRevoking(id);
    try {
      await revokeJiraLink(id);
      await load();
    } catch {
      setList({ kind: "error" });
    } finally {
      setRevoking(null);
    }
  }

  const message = submitMessage(submit);
  const links: JiraLinkRow[] = list.kind === "ready" ? list.links : [];

  return (
    <div style={{ padding: "20px 24px", maxWidth: 620 }}>
      <h1 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, color: "var(--c-ink)", margin: 0 }}>
        Connect your Jira account to Kandryn
      </h1>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 6, lineHeight: 1.6 }}>
        Open the Kandryn panel on any Jira issue and choose <strong>Get a code</strong>. Type that code
        below to connect this Kandryn account to your Jira user.
      </p>

      {/* The warning is amber, never red: it is a caution, not a failure. */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          marginTop: 14,
          padding: "9px 11px",
          background: "var(--c-amber-bg)",
          border: "1px solid var(--c-amber)",
          fontSize: "var(--fs-xs)",
          color: "var(--c-amber)",
          lineHeight: 1.55,
        }}
      >
        <ShieldAlert size={14} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{TYPED_ONLY_WARNING}</span>
      </div>

      <form onSubmit={onConnect} style={{ marginTop: 18 }}>
        <label
          htmlFor="jira-code"
          style={{ display: "block", fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", marginBottom: 5 }}
        >
          Code from the Kandryn panel in Jira
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="jira-code"
            data-testid="jira-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCD EFGHJK"
            style={{
              flex: 1,
              padding: "7px 9px",
              fontFamily: "var(--mono)",
              fontSize: "var(--fs-sm)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "var(--c-bg)",
              border: "1px solid var(--c-border-s)",
              color: "var(--c-ink)",
            }}
          />
          <button
            type="submit"
            disabled={!canSubmit(code, submit)}
            data-testid="jira-connect"
            style={{
              padding: "7px 14px",
              fontSize: "var(--fs-sm)",
              fontFamily: "var(--sans)",
              background: "var(--c-raised)",
              border: "1px solid var(--c-border-s)",
              color: canSubmit(code, submit) ? "var(--c-ink)" : "var(--c-ink-4)",
              cursor: canSubmit(code, submit) ? "pointer" : "default",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {submit.kind === "submitting" && <Loader2 size={12} className="animate-spin" />}
            Connect
          </button>
        </div>

        {message && (
          <p
            data-testid="jira-link-message"
            style={{
              marginTop: 10,
              fontSize: "var(--fs-sm)",
              lineHeight: 1.55,
              color: message.tone === "success" ? "var(--c-green)" : message.tone === "caution" ? "var(--c-amber)" : "var(--c-ink-3)",
            }}
          >
            {message.text}
          </p>
        )}
      </form>

      <div style={{ marginTop: 28, borderTop: "1px solid var(--c-border)", paddingTop: 16 }}>
        <h2 style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-ink)", margin: 0 }}>
          Connected Jira accounts
        </h2>

        {list.kind === "loading" && (
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", marginTop: 10 }}>Loading…</p>
        )}

        {list.kind === "error" && (
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 10 }}>
            Could not load your connections.{" "}
            <button
              onClick={() => void load()}
              style={{ background: "none", border: "none", padding: 0, color: "var(--c-blue)", cursor: "pointer", fontSize: "var(--fs-sm)" }}
            >
              Try again
            </button>
          </p>
        )}

        {list.kind === "ready" && links.length === 0 && (
          <p data-testid="jira-links-empty" style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", marginTop: 10 }}>
            {EMPTY_LIST_TEXT}
          </p>
        )}

        {links.map((link) => (
          <div
            key={link.id}
            data-testid="jira-link-row"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "9px 0",
              borderBottom: "1px solid var(--c-border)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", fontFamily: "var(--mono)" }}>
                {siteLabel(link.siteUrl)}
              </div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 2 }}>
                Connected {new Date(link.linkedAt).toLocaleDateString()}
              </div>
            </div>
            <button
              onClick={() => void onDisconnect(link.id)}
              disabled={revoking === link.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 9px",
                fontSize: "var(--fs-xs)",
                fontFamily: "var(--sans)",
                background: "none",
                border: "1px solid var(--c-border-s)",
                color: "var(--c-ink-3)",
                cursor: revoking === link.id ? "default" : "pointer",
                flexShrink: 0,
              }}
            >
              {revoking === link.id ? <Loader2 size={11} className="animate-spin" /> : <Link2Off size={11} strokeWidth={1.75} />}
              Disconnect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
