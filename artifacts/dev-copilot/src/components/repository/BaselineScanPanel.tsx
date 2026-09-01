import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Loader2, Upload, Check, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  fetchBaselineScans,
  fetchBaselineEstimate,
  fetchBaselineScan,
  startBaselineScan,
  acknowledgeBaselineFinding,
  pushBaselineFindings,
  ApiError,
  type BaselineFinding,
} from "@/services/api";

/**
 * Baseline security scan for an existing codebase.
 *
 * The vocabulary here is deliberately not the runtime scan's. Nothing is being
 * merged, so nothing is blocked and nothing is approved — the panel reports
 * coverage ("scanned 487 of 503 files") and findings, and every action is one
 * the admin takes explicitly. In particular no ticket is ever created by a scan
 * finishing; a baseline scan of a real repository would put dozens on the board
 * at once, unlike the one or two a committed diff produces.
 */

const SEVERITY_STYLE: Record<string, { bg: string; fg: string }> = {
  critical: { bg: "var(--c-red-bg)", fg: "var(--c-red)" },
  high: { bg: "var(--c-red-bg)", fg: "var(--c-red)" },
  medium: { bg: "var(--c-amber-bg)", fg: "var(--c-amber)" },
  low: { bg: "var(--c-raised)", fg: "var(--c-ink-4)" },
  info: { bg: "var(--c-raised)", fg: "var(--c-ink-4)" },
};

export function BaselineScanPanel({ repoId }: { repoId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["repo", repoId, "baseline"],
    queryFn: () => fetchBaselineScans(repoId),
    // While a batch is in flight the cron collects it out-of-band, so the page
    // has to ask again rather than wait on anything.
    refetchInterval: (q) =>
      (q.state.data?.scans ?? []).some((s) => s.status === "queued" || s.status === "scanning") ? 30_000 : false,
  });

  const scans = data?.scans ?? [];
  const latest = scans[0] ?? null;
  const inFlight = latest?.status === "queued" || latest?.status === "scanning";

  const start = async (fileCount: number) => {
    setStarting(true);
    try {
      await startBaselineScan(repoId, fileCount);
      toast({
        title: "Baseline scan started",
        description: "It runs in the background. This page updates as it progresses.",
      });
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["repo", repoId, "baseline"] });
    } catch (err) {
      toast({
        title: "Could not start the scan",
        description: err instanceof ApiError ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          Baseline security scan
        </CardTitle>
        {data?.canScan && !inFlight && (
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            {scans.length > 0 ? "Re-scan codebase" : "Scan this codebase"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
          Aegis reads the whole repository as it stands today and reports what it finds. Nothing is blocked and no
          tickets are created — findings are yours to acknowledge or push to the tracker.
        </p>

        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading…</div>
        ) : !data?.canScan && scans.length === 0 ? (
          <div className="text-muted-foreground text-sm">{data?.reason ?? "You cannot run a baseline scan here."}</div>
        ) : scans.length === 0 ? (
          <div className="text-muted-foreground text-sm">This codebase has not been scanned yet.</div>
        ) : (
          <ScanSummary scanId={latest!.id} repoId={repoId} />
        )}
      </CardContent>

      <EstimateDialog
        repoId={repoId}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        starting={starting}
        onConfirm={start}
      />
    </Card>
  );
}

/**
 * The pre-flight estimate. Real money is spent the moment this is confirmed, so
 * the numbers are shown before the button is live and the count is sent back to
 * the API, which refuses if the repository has changed size since.
 */
function EstimateDialog({
  repoId,
  open,
  onOpenChange,
  starting,
  onConfirm,
}: {
  repoId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  starting: boolean;
  onConfirm: (fileCount: number) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["repo", repoId, "baseline", "estimate"],
    queryFn: () => fetchBaselineEstimate(repoId),
    enabled: open,
    staleTime: 0,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 520 }}>
        <DialogHeader>
          <DialogTitle>Scan this codebase</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="text-muted-foreground py-6 text-sm">Counting files…</div>
        ) : error || !data ? (
          <div className="text-sm" style={{ color: "var(--c-red)" }}>
            {error instanceof ApiError ? error.message : "Could not size this repository."}
          </div>
        ) : data.overCap ? (
          <div
            className="rounded p-3 text-sm"
            style={{ background: "var(--c-red-bg)", border: "1px solid var(--c-red)", color: "var(--c-red)" }}
          >
            <strong>
              {data.filesTotal.toLocaleString()} scannable files — above the {data.maxFiles.toLocaleString()}-file
              limit.
            </strong>
            <div className="mt-1">
              A scan this size is not something to start from a dialog. Narrow the repository, or get in touch so we
              can run it deliberately.
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Figure label="Files" value={data.filesTotal.toLocaleString()} />
              <Figure label="Estimated cost" value={`$${data.estimatedCostUsd.toFixed(2)}`} />
              <Figure label="Estimated time" value={`~${data.estimatedMinutes} min`} />
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {data.source === "graph"
                ? "The file list comes from this repository's code index, so documentation and configuration are already excluded."
                : "No code index is available, so the file list comes from the repository tree filtered by extension."}{" "}
              The scan runs in the background — you do not need to keep this page open.
            </p>
            <p className="text-sm font-medium">The estimate is a ceiling, not a quote. You are billed for what the scan actually reads.</p>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={starting}>
            Cancel
          </Button>
          <Button onClick={() => data && onConfirm(data.filesTotal)} disabled={starting || isLoading || !data || data.overCap}>
            {starting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            {starting ? "Starting…" : "Start scan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2" style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--c-ink-4)" }}>
        {label}
      </div>
      <div className="font-mono text-base font-semibold">{value}</div>
    </div>
  );
}

/** The latest scan: coverage, findings, and the two triage actions. */
function ScanSummary({ scanId, repoId }: { scanId: number; repoId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [ackTarget, setAckTarget] = useState<BaselineFinding | null>(null);
  const [pushing, setPushing] = useState(false);

  const { data } = useQuery({
    queryKey: ["baseline-scan", scanId],
    queryFn: () => fetchBaselineScan(scanId),
    refetchInterval: (q) =>
      q.state.data && (q.state.data.scan.status === "queued" || q.state.data.scan.status === "scanning")
        ? 30_000
        : false,
  });

  useEffect(() => setSelected(new Set()), [scanId]);

  const findings = useMemo(() => data?.findings ?? [], [data]);
  const pushable = findings.filter((f) => f.status === "open");

  if (!data) return <div className="text-muted-foreground text-sm">Loading…</div>;
  const { scan } = data;

  if (scan.status === "queued" || scan.status === "scanning") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--c-blue)" }} />
        <span>
          Scanning {scan.filesTotal.toLocaleString()} files. This runs in the background and usually takes under an
          hour — you can leave this page.
        </span>
      </div>
    );
  }

  if (scan.status === "failed") {
    return (
      <div className="text-sm" style={{ color: "var(--c-red)" }}>
        The scan did not complete{scan.error ? `: ${scan.error}` : "."}
      </div>
    );
  }

  const push = async () => {
    setPushing(true);
    try {
      const res = await pushBaselineFindings(scanId, [...selected]);
      toast({
        title: `${res.created.length} of ${res.requested} filed`,
        description: res.created.length < res.requested ? "Some findings could not be filed — check the tracker." : "Appearing on the board.",
      });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["baseline-scan", scanId] });
      qc.invalidateQueries({ queryKey: ["repo", repoId, "baseline"] });
    } catch (err) {
      toast({
        title: "Could not file tickets",
        description: err instanceof ApiError ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div>
      {/* Coverage, never a gate verdict. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>
          Scanned <strong>{scan.filesScanned.toLocaleString()}</strong> of {scan.filesTotal.toLocaleString()} files
          {scan.filesSkipped > 0 ? ` · ${scan.filesSkipped.toLocaleString()} skipped` : ""}
        </span>
        <span className="text-muted-foreground text-xs">
          {scan.finishedAt ? formatDistanceToNow(new Date(scan.finishedAt), { addSuffix: true }) : ""}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["critical", "high", "medium", "low"] as const).map((sev) => {
          const n = scan[`${sev}Count` as const];
          const style = SEVERITY_STYLE[sev];
          return (
            <span
              key={sev}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: n > 0 ? style.bg : "var(--c-raised)", color: n > 0 ? style.fg : "var(--c-ink-4)" }}
            >
              {n} {sev}
            </span>
          );
        })}
      </div>

      {findings.length === 0 ? (
        <div className="text-muted-foreground text-sm">No findings in the files that were scanned.</div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: "var(--c-border)" }}>
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--c-ink-4)" }}>
              {findings.length} finding{findings.length === 1 ? "" : "s"}
            </span>
            {data.canScan && selected.size > 0 && (
              <Button variant="outline" size="sm" onClick={push} disabled={pushing}>
                {pushing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                File {selected.size} as tickets
              </Button>
            )}
          </div>

          <div className="flex flex-col">
            {findings.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                canAct={data.canScan}
                selectable={pushable.some((p) => p.id === f.id)}
                selected={selected.has(f.id)}
                onToggle={(v) =>
                  setSelected((prev) => {
                    const n = new Set(prev);
                    if (v) n.add(f.id);
                    else n.delete(f.id);
                    return n;
                  })
                }
                onAcknowledge={() => setAckTarget(f)}
              />
            ))}
          </div>
        </>
      )}

      <AcknowledgeDialog
        finding={ackTarget}
        onOpenChange={(v) => !v && setAckTarget(null)}
        onDone={() => {
          setAckTarget(null);
          qc.invalidateQueries({ queryKey: ["baseline-scan", scanId] });
        }}
      />
    </div>
  );
}

function FindingRow({
  finding,
  canAct,
  selectable,
  selected,
  onToggle,
  onAcknowledge,
}: {
  finding: BaselineFinding;
  canAct: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: (v: boolean) => void;
  onAcknowledge: () => void;
}) {
  const style = SEVERITY_STYLE[finding.severity] ?? SEVERITY_STYLE.low;
  const acknowledged = finding.status === "acknowledged";
  return (
    <div
      className="flex items-start gap-3 border-b py-2 last:border-b-0"
      style={{ borderColor: "var(--c-border)", opacity: acknowledged ? 0.6 : 1 }}
    >
      <div className="pt-0.5">
        <Checkbox checked={selected} onCheckedChange={onToggle} disabled={!canAct || !selectable} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: style.bg, color: style.fg }}>
            {finding.severity}
          </span>
          <span className="text-sm font-medium">{finding.title}</span>
          {finding.plmTicketKey && (
            <a
              href={finding.plmTicketUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] underline"
              style={{ color: "var(--c-green)" }}
            >
              {finding.plmTicketKey}
            </a>
          )}
        </div>
        <div className="font-mono text-[11px]" style={{ color: "var(--c-ink-4)" }}>
          {finding.filePath}
          {finding.lineRef ? `:${finding.lineRef}` : ""} · {finding.owasp}
        </div>
        <div className="mt-1 text-xs leading-relaxed" style={{ color: "var(--c-ink-2)" }}>
          {finding.detail}
        </div>
        {acknowledged && (
          <div className="mt-1 flex items-start gap-1.5 text-[11px]" style={{ color: "var(--c-ink-4)" }}>
            <Check className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Acknowledged by <span className="font-mono">{finding.acknowledgedBy}</span>
              {finding.acknowledgedAt ? ` on ${new Date(finding.acknowledgedAt).toLocaleDateString()}` : ""} —{" "}
              {finding.acknowledgeReason}
            </span>
          </div>
        )}
      </div>
      {canAct && finding.status === "open" && (
        <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={onAcknowledge}>
          Acknowledge
        </Button>
      )}
    </div>
  );
}

/**
 * Acknowledging is how a team says "we know, and we are not fixing this now".
 * The reason is mandatory — the same discipline as an Aegis gate override —
 * because a finding dismissed without one is indistinguishable from one nobody
 * ever looked at, and it will be carried forward silently into every re-scan.
 */
function AcknowledgeDialog({
  finding,
  onOpenChange,
  onDone,
}: {
  finding: BaselineFinding | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (finding) {
      setReason("");
      setSaving(false);
    }
  }, [finding]);

  const submit = async () => {
    if (!finding) return;
    setSaving(true);
    try {
      await acknowledgeBaselineFinding(finding.id, reason);
      toast({ title: "Finding acknowledged", description: "It will stay acknowledged in future scans of this repository." });
      onDone();
    } catch (err) {
      toast({
        title: "Could not acknowledge",
        description: err instanceof ApiError ? err.message : "Try again.",
        variant: "destructive",
      });
      setSaving(false);
    }
  };

  return (
    <Dialog open={finding != null} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 520 }}>
        <DialogHeader>
          <DialogTitle>Acknowledge this finding</DialogTitle>
        </DialogHeader>
        {finding && (
          <>
            <div className="rounded p-3 text-sm" style={{ background: "var(--c-raised)" }}>
              <div className="font-medium">{finding.title}</div>
              <div className="font-mono text-[11px]" style={{ color: "var(--c-ink-4)" }}>
                {finding.filePath}
              </div>
            </div>
            <div className="flex items-start gap-2 text-sm" style={{ color: "var(--c-ink-2)" }}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--c-amber)" }} />
              <span>
                This does not fix anything. It records that your team has seen this finding and decided not to act on
                it, and it will stay acknowledged when this repository is scanned again.
              </span>
            </div>
            <label className="block">
              <span className="text-sm font-medium">Why is this not being fixed?</span>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Required. Recorded permanently, with your name."
                className="mt-1.5"
              />
            </label>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || reason.trim().length === 0}>
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            {saving ? "Saving…" : "Acknowledge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
