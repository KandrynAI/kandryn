import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ArrowRight, ExternalLink } from "lucide-react";
import { overrideReady, MIN_OVERRIDE_REASON } from "@/lib/overrideReady";
import {
  fetchImpact,
  postSequenceEvent,
  type ImpactAnalysis,
  type SequenceCheck,
  type SequenceFinding,
} from "@/services/api";

/**
 * The run-order dialog.
 *
 * Built on the Radix dialog so focus trapping, the Esc key and the aria
 * wiring come from a primitive that already gets them right, rather than from
 * a hand-rolled modal that gets them nearly right.
 *
 * Severity is always stated in words as well as colour, and warnings use the
 * amber token rather than red: this is a caution about ordering, not a
 * failure, and spending red here would devalue it where it actually matters.
 */

const REASON_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "blocker_lands_separately", label: "The blocker lands separately and will not conflict" },
  { value: "urgent_business_need", label: "Urgent business need" },
  { value: "dependency_data_wrong", label: "The dependency data is wrong" },
  { value: "separate_branch_or_environment", label: "This targets a separate branch or environment" },
  { value: "other", label: "Other" },
];

export interface SequenceConfirmation {
  checkId: number;
  decision: "override";
  reasonCategory: string;
  reasonText?: string;
  acknowledgedFindingIds: string[];
  acknowledgedImpact: true;
}

export function SequenceDialog({
  open,
  check,
  itemKey,
  itemTitle,
  staleNotice,
  busy,
  onOpenChange,
  onConfirm,
  onOpenItem,
}: {
  open: boolean;
  check: SequenceCheck | null;
  itemKey: string;
  itemTitle: string;
  /** Set when the server rejected a confirmation because the world moved. */
  staleNotice?: string | null;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (confirmation: SequenceConfirmation) => void;
  /** Open a blocker. The caller decides whether that is a tab or a route. */
  onOpenItem?: (itemId: number) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [impact, setImpact] = useState<ImpactAnalysis | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  // A fresh check means a different situation, so the decision restarts. Not
  // doing this would let someone carry an acknowledgement across a change.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setImpact(null);
    setAcknowledged(false);
  }, [open, check?.checkId]);

  if (!check) return null;

  const hasWarning = check.findings.some((f) => f.severity === "warning");
  const reasonOk = !hasWarning || reason.trim().length >= MIN_OVERRIDE_REASON;
  const canConfirm = overrideReady({ category, reason, acknowledged, hasWarning, busy });

  const close = (reason: "canceled" | "silent") => {
    if (reason === "canceled") void postSequenceEvent(check.workItemId, check.checkId, "canceled");
    onOpenChange(false);
  };

  const goToImpact = async () => {
    setStep(2);
    if (impact) return;
    setLoadingImpact(true);
    try {
      setImpact(await fetchImpact(check.workItemId, check.checkId));
    } catch {
      // buildImpact already falls back to the deterministic assessment, so a
      // failure here means the request itself did not land. Say nothing and
      // let the user decide on the findings alone rather than blocking them.
      setImpact(null);
    } finally {
      setLoadingImpact(false);
    }
  };

  const heed = (itemId: number) => {
    void postSequenceEvent(check.workItemId, check.checkId, "heeded");
    onOpenItem?.(itemId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close("canceled"))}>
      <DialogContent className="max-w-2xl" style={{ maxHeight: "85vh", overflowY: "auto" }}>
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle style={{ fontSize: "var(--fs-lg)" }}>
                {itemKey} may need other work first
              </DialogTitle>
              <DialogDescription>{itemTitle}</DialogDescription>
            </DialogHeader>

            {staleNotice ? <Notice>{staleNotice}</Notice> : null}

            <ul style={{ display: "grid", gap: 10, margin: "4px 0 0", padding: 0, listStyle: "none" }}>
              {check.findings.map((f) => (
                <FindingRow key={f.id} finding={f} />
              ))}
            </ul>

            {check.suggestedFirst.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <h3 style={labelStyle}>Do this first</h3>
                <ul style={{ display: "grid", gap: 6, margin: "6px 0 0", padding: 0, listStyle: "none" }}>
                  {check.suggestedFirst.map((s) => (
                    <li key={s.itemId} style={rowStyle}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)" }}>{s.itemKey}</span>
                      <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-xs)", flex: 1 }}>
                        {s.reason}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => heed(s.itemId)}>
                        Open {s.itemKey}
                        <ExternalLink size={12} style={{ marginLeft: 4 }} />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <footer style={footerStyle}>
              <Button onClick={() => close("canceled")}>Go back</Button>
              {check.canOverride ? (
                <button type="button" onClick={goToImpact} style={quietLinkStyle}>
                  Override and run anyway
                  <ArrowRight size={12} style={{ marginLeft: 4, verticalAlign: "-1px" }} />
                </button>
              ) : (
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>
                  Your team policy requires an admin to override this.
                </span>
              )}
            </footer>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle style={{ fontSize: "var(--fs-lg)" }}>What running it now could cause</DialogTitle>
              <DialogDescription>
                {itemKey} · {itemTitle}
              </DialogDescription>
            </DialogHeader>

            {staleNotice ? <Notice>{staleNotice}</Notice> : null}

            {loadingImpact ? (
              <div style={{ display: "grid", gap: 8, padding: "8px 0" }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{ height: 14, borderRadius: 3, background: "var(--bg-hover)" }} />
                ))}
              </div>
            ) : impact ? (
              <ImpactBody impact={impact} />
            ) : (
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-sm)" }}>
                The impact assessment could not be loaded. The findings above still stand.
              </p>
            )}

            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend style={labelStyle}>Why are you running this out of order?</legend>
                <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                  {REASON_CATEGORIES.map((c) => (
                    <label key={c.value} style={radioStyle}>
                      <input
                        type="radio"
                        name="sequence-reason"
                        value={c.value}
                        checked={category === c.value}
                        onChange={() => setCategory(c.value)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="sequence-reason-text" style={labelStyle}>
                  {hasWarning ? "Reason (required)" : "Reason (optional)"}
                </label>
                <Textarea
                  id="sequence-reason-text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="This is stored as a permanent record of the decision."
                />
                {hasWarning ? (
                  <p
                    style={{
                      fontSize: "var(--fs-xs)",
                      color: reasonOk ? "var(--text-muted)" : "var(--c-amber)",
                      marginTop: 4,
                    }}
                  >
                    {reason.trim().length}/{MIN_OVERRIDE_REASON} characters minimum
                  </p>
                ) : null}
              </div>

              <label style={{ ...radioStyle, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>I have read the impact above and I am choosing to run this out of order.</span>
              </label>
            </div>

            <footer style={footerStyle}>
              <button type="button" onClick={() => setStep(1)} style={quietLinkStyle}>
                Back
              </button>
              <Button
                disabled={!canConfirm}
                onClick={() =>
                  onConfirm({
                    checkId: check.checkId,
                    decision: "override",
                    reasonCategory: category,
                    reasonText: reason.trim() || undefined,
                    acknowledgedFindingIds: check.findings.map((f) => f.id),
                    acknowledgedImpact: true,
                  })
                }
              >
                {busy ? <Loader2 size={13} className="animate-spin" style={{ marginRight: 6 }} /> : null}
                Run {itemKey} anyway
              </Button>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FindingRow({ finding }: { finding: SequenceFinding }) {
  const warn = finding.severity === "warning";
  return (
    <li style={{ ...rowStyle, alignItems: "flex-start" }}>
      <span
        aria-hidden
        style={{
          width: 3,
          alignSelf: "stretch",
          borderRadius: 2,
          background: warn ? "var(--c-amber)" : "var(--hairline)",
        }}
      />
      <div style={{ flex: 1 }}>
        {/* The word carries the severity; the colour only reinforces it. */}
        <span style={{ fontSize: "var(--fs-xs)", color: warn ? "var(--c-amber)" : "var(--text-muted)" }}>
          {warn ? "Warning" : "Caution"}
        </span>
        <p style={{ margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>{finding.summary}</p>
        {finding.evidence.files?.length ? (
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-xs)",
              color: "var(--text-muted)",
            }}
          >
            {finding.evidence.files.join(", ")}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function ImpactBody({ impact }: { impact: ImpactAnalysis }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0, fontSize: "var(--fs-sm)" }}>{impact.summary}</p>

      {impact.risks.map((r, i) => (
        <div key={i} style={{ borderLeft: "2px solid var(--hairline)", paddingLeft: 10 }}>
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", fontWeight: 500 }}>{r.title}</p>
          <p style={{ margin: "2px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            {r.severity} severity · {r.likelihood}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)" }}>{r.explanation}</p>
          <p style={{ margin: "4px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-secondary)" }}>
            What to do: {r.mitigation}
          </p>
        </div>
      ))}

      {impact.affectedFiles.length > 0 ? (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-xs)",
            color: "var(--text-muted)",
          }}
        >
          Affected files: {impact.affectedFiles.join(", ")}
        </p>
      ) : null}

      <p style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
        <strong style={{ fontWeight: 500 }}>Instead:</strong> {impact.alternative}
      </p>

      {/* Which layer produced this. "Standard assessment" is not a euphemism
          for a failure — it is the deterministic reading, and it is always
          available whether or not a model answered. */}
      <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
        {impact.source === "ai" ? "Generated from your tracker and run data" : "Standard assessment"}
      </p>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "6px 0 0",
        padding: "6px 8px",
        borderRadius: 4,
        background: "var(--bg-hover)",
        borderLeft: "2px solid var(--c-amber)",
        fontSize: "var(--fs-xs)",
      }}
    >
      {children}
    </p>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const rowStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };
const radioStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  fontSize: "var(--fs-sm)",
  cursor: "pointer",
};
const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginTop: 18,
};
const quietLinkStyle: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  color: "var(--text-secondary)",
  fontSize: "var(--fs-xs)",
  cursor: "pointer",
  textDecoration: "underline",
};
