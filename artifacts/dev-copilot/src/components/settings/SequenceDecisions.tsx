import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Download, X } from "lucide-react";
import {
  fetchSequenceOverrides,
  fetchSequenceOverride,
  sequenceOverridesCsvUrl,
  type SequenceOverrideRow,
} from "@/services/api";

const REASON_LABELS: Record<string, string> = {
  blocker_lands_separately: "Blocker lands separately",
  urgent_business_need: "Urgent business need",
  dependency_data_wrong: "Dependency data wrong",
  separate_branch_or_environment: "Separate branch or environment",
  other: "Other",
};

/**
 * The decision records: who ran what out of order, what they were shown, and
 * why.
 *
 * Read-only by construction — the rows are immutable in the database, and
 * there is deliberately nothing here that offers to change one.
 */
export default function SequenceDecisions() {
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<SequenceOverrideRow[] | null>(null);
  const [selected, setSelected] = useState<SequenceOverrideRow | null>(null);

  useEffect(() => {
    setRows(null);
    fetchSequenceOverrides({ days })
      .then(setRows)
      .catch(() => setRows([]));
  }, [days]);

  const openDetail = async (id: number) => {
    try {
      setSelected(await fetchSequenceOverride(id));
    } catch {
      /* the row in hand is already most of the record; leave the list alone */
    }
  };

  return (
    <div>
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          style={{ fontSize: "var(--fs-xs)", padding: "2px 6px" }}
          aria-label="Time range"
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
        <a
          href={sequenceOverridesCsvUrl(days)}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: "var(--fs-xs)",
            color: "var(--c-ink-3)",
          }}
        >
          <Download size={12} />
          Export CSV
        </a>
      </header>

      {rows === null ? (
        <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
          No run-order overrides in this period. Runs that were in order, or where the warning was heeded,
          appear in the audit log rather than here.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--c-ink-4)", fontSize: "var(--fs-xs)" }}>
              <th style={th}>When</th>
              <th style={th}>Item</th>
              <th style={th}>Who</th>
              <th style={th}>Reason</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--c-hairline)" }}>
                <td style={td}>{format(new Date(r.createdAt), "d MMM HH:mm")}</td>
                <td style={{ ...td, fontFamily: "var(--mono)" }}>{r.workItemKey}</td>
                <td style={td}>
                  {r.userId}
                  <span style={{ color: "var(--c-ink-4)" }}> · {r.userRole}</span>
                </td>
                <td style={td}>{REASON_LABELS[r.reasonCategory] ?? r.reasonCategory}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => void openDetail(r.id)}
                    style={{ background: "none", border: 0, color: "var(--c-ink-3)", cursor: "pointer", fontSize: "var(--fs-xs)" }}
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected ? <DecisionDetail row={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function DecisionDetail({ row, onClose }: { row: SequenceOverrideRow; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={`Override record for ${row.workItemKey}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 60,
      }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          background: "var(--c-surface, #fff)",
          padding: 20,
          overflowY: "auto",
          borderLeft: "1px solid var(--c-hairline)",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: "var(--fs-base)", fontWeight: 600 }}>
            {row.workItemKey} — ran out of order
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer" }}>
            <X size={14} />
          </button>
        </header>

        <Field label="Decided by">
          {row.userId} ({row.userRole}) on {format(new Date(row.createdAt), "d MMM yyyy HH:mm")}
          {row.ipAddress ? ` from ${row.ipAddress}` : ""}
        </Field>
        <Field label="Work item">{row.workItemTitle}</Field>
        <Field label="Verdict at the time">{row.verdictAtDecision}</Field>
        <Field label="Reason">
          {REASON_LABELS[row.reasonCategory] ?? row.reasonCategory}
          {row.reasonText ? ` — ${row.reasonText}` : ""}
        </Field>

        <Field label="Findings acknowledged">
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {row.findingsAcknowledged.map((f) => (
              <li key={f.id} style={{ fontSize: "var(--fs-xs)" }}>
                <strong style={{ fontWeight: 500 }}>{f.severity}</strong> — {f.summary}
              </li>
            ))}
          </ul>
        </Field>

        {/* The exact text the user read, frozen at decision time. */}
        <Field label={`Impact shown (${row.impactSource === "ai" ? row.impactModel ?? "model" : "standard assessment"})`}>
          <p style={{ margin: 0, fontSize: "var(--fs-xs)" }}>{row.impactShown?.summary}</p>
          {row.impactShown?.risks?.map((risk, i) => (
            <p key={i} style={{ margin: "4px 0 0", fontSize: "var(--fs-xs)" }}>
              <strong style={{ fontWeight: 500 }}>{risk.title}</strong> — {risk.explanation}
            </p>
          ))}
        </Field>

        {row.outcomes && row.outcomes.length > 0 ? (
          <Field label="What happened next">
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {row.outcomes.map((o) => (
                <li key={o.id} style={{ fontSize: "var(--fs-xs)" }}>
                  {String((o.metadata as { outcome?: string } | null)?.outcome ?? "recorded")} ·{" "}
                  {format(new Date(o.createdAt), "d MMM HH:mm")}
                </li>
              ))}
            </ul>
          </Field>
        ) : null}

        <Field label="Run">{row.runId ? `#${row.runId}` : "The run has since been deleted"}</Field>
        <Field label="Record hash">
          <code style={{ fontSize: 10, wordBreak: "break-all" }}>{row.recordHash}</code>
        </Field>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>{children}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "4px 6px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "6px", verticalAlign: "top" };
