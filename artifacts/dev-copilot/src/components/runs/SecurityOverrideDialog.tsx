import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ShieldX, Loader2, AlertTriangle } from "lucide-react";
import { overrideSecurityGate, ApiError, type AegisScanResult, type OverridePolicy } from "@/services/api";

/**
 * The deliberate second step in front of clearing a blocked security gate.
 *
 * Everything here is calibrated to make the override feel like what it is. It
 * states the exact findings being waved through rather than a generic warning,
 * the reason is mandatory (and enforced again by the API and a column CHECK),
 * and the confirm button stays disabled until one is typed — there is no path
 * through this dialog that produces an unexplained override.
 */

interface Props {
  runId: number;
  scan: AegisScanResult;
  policy: OverridePolicy;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}

export function SecurityOverrideDialog({ runId, scan, policy, open, onOpenChange, onDone }: Props) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // A reason is per-override, never carried between attempts.
  useEffect(() => {
    if (open) {
      setReason("");
      setSaving(false);
    }
  }, [open]);

  const unscanned = scan.unscannedFiles ?? [];
  const severe = scan.criticalCount + scan.highCount;
  const counts = [
    scan.criticalCount ? `${scan.criticalCount} Critical` : null,
    scan.highCount ? `${scan.highCount} High` : null,
  ].filter(Boolean) as string[];

  // Name the specific thing being waved through. "Security issues found" is the
  // kind of warning people click past; "2 Critical findings" is not.
  const parts: string[] = [];
  if (counts.length > 0) parts.push(`${counts.join(" and ")} finding${severe === 1 ? "" : "s"}`);
  if (unscanned.length > 0) parts.push(`${unscanned.length} file${unscanned.length === 1 ? "" : "s"} Aegis could not scan`);
  const headline = parts.length > 0 ? `This run has ${parts.join(", and ")}.` : scan.gateReason;

  const submit = async () => {
    setSaving(true);
    try {
      const res = await overrideSecurityGate(runId, reason);
      toast({
        title: "Security gate overridden",
        description: res.statusReposted
          ? "The security check on the pull request now passes."
          : "Recorded — but the check on the pull request could not be updated, so branch protection may still block the merge.",
      });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast({
        title: "Override refused",
        description: err instanceof ApiError ? err.message : "Try again.",
        variant: "destructive",
      });
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 560 }}>
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldX size={16} style={{ color: "var(--c-red)" }} />
            Override the security gate
          </DialogTitle>
        </DialogHeader>

        {/* What is actually being waved through — specific, not a generic warning. */}
        <div style={{ background: "var(--c-red-bg)", border: "1px solid var(--c-red)", borderRadius: 4, padding: "10px 14px" }}>
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-red)" }}>{headline}</div>
          {parts.length > 0 && scan.gateReason && (
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-red)", marginTop: 4 }}>{scan.gateReason}</div>
          )}
          {unscanned.length > 0 && (
            <div style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-red)", marginTop: 6, wordBreak: "break-all" }}>
              {unscanned.join(", ")}
            </div>
          )}
        </div>

        <p style={{ fontSize: "var(--fs-base)", color: "var(--c-ink-2)", lineHeight: 1.55, margin: 0 }}>
          Overriding marks the Kandryn security check on this pull request as passing, so the code can merge despite
          the gate blocking it. The findings are not fixed and the pull request is not re-scanned.
        </p>

        <p style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-ink)", lineHeight: 1.55, margin: 0 }}>
          This action is logged and visible to your team's admins.
        </p>

        {/* The sole-operator case. Permitted, but never quietly. */}
        {policy.sameActor === true && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              background: "var(--c-amber-bg)",
              border: "1px solid var(--c-amber)",
              borderRadius: 4,
              padding: "10px 14px",
            }}
          >
            <AlertTriangle size={14} style={{ color: "var(--c-amber)", flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-amber)", lineHeight: 1.5 }}>
              You triggered this run. Clearing its gate yourself is recorded as a <strong>self-override</strong> and is
              flagged for review in your team's governance report.
            </span>
          </div>
        )}

        <label style={{ display: "block" }}>
          <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-ink)" }}>
            Why is this override necessary?
          </span>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Required. Recorded permanently against this run, with your name."
            style={{ marginTop: 6, fontSize: "var(--fs-base)" }}
          />
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={saving || reason.trim().length === 0}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldX size={14} />}
            {saving ? "Overriding…" : "Override gate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
