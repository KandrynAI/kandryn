import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileSearch, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  ApiError,
  acknowledgeReviewFinding,
  fetchCodeReview,
  fetchCodeReviews,
  fetchReviewEstimate,
  startCodeReview,
  type CodeReviewFinding,
} from "@/services/api";
import {
  canAcknowledge,
  categoryLabel,
  groupFindings,
  isReviewInFlight,
  openCount,
  reviewCostLine,
  reviewStatusLine,
  severityColor,
} from "@/lib/reviewView";

const AMBER = "var(--c-amber, #b4802a)";

/**
 * The whole-repository code review (0051).
 *
 * Shaped on the baseline security scan's panel so an admin learns one flow:
 * estimate, confirm, wait, triage. It gates nothing and files nothing. All of
 * its display logic lives in lib/reviewView.ts, because a `.tsx` cannot be
 * tested here.
 */
export function ReviewScanPanel({ repoId }: { repoId: number }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["repo", repoId, "review"],
    queryFn: () => fetchCodeReviews(repoId),
    // While a batch is in flight the cron collects it out of band, so the page
    // has to ask again rather than wait on anything.
    refetchInterval: (q) => ((q.state.data?.scans ?? []).some(isReviewInFlight) ? 30_000 : false),
  });

  const scans = data?.scans ?? [];
  const latest = scans[0] ?? null;
  const inFlight = isReviewInFlight(latest);

  const start = async (fileCount: number, pathPrefix: string | null) => {
    setStarting(true);
    try {
      await startCodeReview(repoId, fileCount, pathPrefix);
      toast({
        title: "Code review started",
        description: "It runs in the background. This page updates as it progresses.",
      });
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["repo", repoId, "review"] });
    } catch (err) {
      toast({
        title: "Could not start the review",
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
          <FileSearch className="h-4 w-4" />
          Code review
        </CardTitle>
        {data?.canReview && !inFlight && (
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            {scans.length > 0 ? "Review again" : "Review this codebase"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
          Veria reads the repository as it stands today and reports the defects a reviewer would raise:
          correctness, error handling, resource and concurrency problems, misleading signatures. Security is
          not covered here, because the baseline security scan already reads every file. Nothing is blocked
          and no tickets are created.
        </p>

        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading…</div>
        ) : error ? (
          <div className="text-sm" style={{ color: AMBER }}>
            {error instanceof ApiError ? error.message : "The reviews could not be loaded."}
          </div>
        ) : !data?.canReview && scans.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            {data?.reason ?? "You cannot start a code review here."}
          </div>
        ) : scans.length === 0 ? (
          <div className="text-muted-foreground text-sm">This codebase has not been reviewed yet.</div>
        ) : inFlight ? (
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{reviewStatusLine(latest)}</span>
          </div>
        ) : (
          <ReviewDetail scanId={latest!.id} repoId={repoId} />
        )}
      </CardContent>

      <ReviewEstimateDialog
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
 * The pre-flight estimate. Real money is spent the moment this is confirmed,
 * so the numbers are shown before the button is live, and the count is sent
 * back to the API, which refuses if the repository has changed size since.
 */
function ReviewEstimateDialog({
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
  onConfirm: (fileCount: number, pathPrefix: string | null) => void;
}) {
  // `typed` is what is in the field, `scope` what has been committed and
  // priced: an estimate costs a git call, so it is not issued per keystroke.
  const [typed, setTyped] = useState("");
  const [scope, setScope] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["repo", repoId, "review", "estimate", scope],
    queryFn: () => fetchReviewEstimate(repoId, scope),
    enabled: open,
    staleTime: 0,
  });
  const commitScope = () => setScope(typed.trim() === "" ? null : typed.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 520 }}>
        <DialogHeader>
          <DialogTitle>Review this codebase</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="text-muted-foreground py-6 text-sm">Counting files…</div>
        ) : error || !data ? (
          <div className="text-sm" style={{ color: AMBER }}>
            {error instanceof ApiError ? error.message : "Could not size this repository."}
          </div>
        ) : data.overCap ? (
          <div
            className="rounded p-3 text-sm"
            style={{ border: `1px solid ${AMBER}`, color: AMBER }}
          >
            <strong>
              {data.filesTotal.toLocaleString()} reviewable files
              {scope ? ` under ${scope}` : ""}, above the {data.maxFiles.toLocaleString()}-file limit for one
              review.
            </strong>
            <div className="mt-1">Review a folder at a time instead. Enter one below and the estimate updates.</div>
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
              The review runs in the background and you do not need to keep this page open.
            </p>
            <p className="text-sm font-medium">
              The estimate is a ceiling, not a quote. You are billed for what the review actually reads.
            </p>
          </>
        )}

        <div className="space-y-1.5 border-t pt-3" style={{ borderColor: "var(--hairline)" }}>
          <label className="text-xs font-medium" htmlFor="review-folder">
            Folder to review (optional)
          </label>
          <Input
            id="review-folder"
            value={typed}
            placeholder="whole repository"
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(e) => setTyped(e.target.value)}
            onBlur={commitScope}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitScope();
              }
            }}
          />
          <p className="text-muted-foreground text-xs">
            A path inside the repository, like <span className="font-mono">src/api</span>. Leave it empty to
            review everything. Press Enter to re-price.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={starting}>
            Cancel
          </Button>
          <Button
            onClick={() => data && onConfirm(data.filesTotal, scope)}
            disabled={starting || isLoading || !data || data.overCap}
          >
            {starting ? "Starting…" : "Start review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

/** A finished review: coverage, cost, and the findings grouped by severity. */
function ReviewDetail({ scanId, repoId }: { scanId: number; repoId: number }) {
  const [ackTarget, setAckTarget] = useState<CodeReviewFinding | null>(null);
  const { data } = useQuery({ queryKey: ["code-review", scanId], queryFn: () => fetchCodeReview(scanId) });

  if (!data) return <div className="text-muted-foreground text-sm">Loading…</div>;
  const { scan, findings } = data;
  const cost = reviewCostLine(scan);
  const groups = groupFindings(findings);
  const open = openCount(findings);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>{reviewStatusLine(scan)}</span>
        {cost && <span className="text-muted-foreground text-xs">{cost}</span>}
        {scan.model && <span className="text-muted-foreground text-xs">Veria</span>}
        <span className="text-muted-foreground text-xs">
          {scan.finishedAt ? formatDistanceToNow(new Date(scan.finishedAt), { addSuffix: true }) : ""}
        </span>
      </div>

      {findings.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No findings. Every reviewed file came back clean.
        </div>
      ) : (
        <>
          <div className="text-muted-foreground mb-3 text-xs">
            {open} of {findings.length} still need a decision.
          </div>
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.severity}>
                <div
                  className="mb-1.5 text-xs font-medium uppercase tracking-wide"
                  style={{ color: severityColor(group.severity) }}
                >
                  {group.severity} ({group.findings.length})
                </div>
                <div className="space-y-2">
                  {group.findings.map((f) => (
                    <FindingRow key={f.id} finding={f} onAcknowledge={() => setAckTarget(f)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <AcknowledgeReviewDialog
        finding={ackTarget}
        onOpenChange={(v) => !v && setAckTarget(null)}
        onDone={() => setAckTarget(null)}
        scanId={scanId}
        repoId={repoId}
      />
    </div>
  );
}

function FindingRow({
  finding,
  onAcknowledge,
}: {
  finding: CodeReviewFinding;
  onAcknowledge: () => void;
}) {
  const dismissed = finding.status === "acknowledged";
  return (
    <div
      className="rounded-md border p-3"
      style={{ borderColor: "var(--hairline)", opacity: dismissed ? 0.65 : 1 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{finding.title}</div>
          <div className="text-muted-foreground mt-0.5 font-mono text-xs">
            {finding.filePath}
            {finding.lineRef ? `:${finding.lineRef}` : ""}
            {" · "}
            {categoryLabel(finding.category)}
          </div>
          {finding.detail && (
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">{finding.detail}</p>
          )}
          {finding.remediation && (
            <p className="mt-1.5 text-xs leading-relaxed">{finding.remediation}</p>
          )}
          {dismissed && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Dismissed{finding.acknowledgeReason ? `: ${finding.acknowledgeReason}` : ""}
            </p>
          )}
        </div>
        {!dismissed && (
          <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={onAcknowledge}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A reason is mandatory, here, on the server, and in a database CHECK.
 *
 * A dismissal with no stated reason is indistinguishable from a finding nobody
 * looked at, and it is carried forward silently into every later review. The
 * confirm button is neutral rather than red: dismissing is a normal decision,
 * not a destructive one.
 */
function AcknowledgeReviewDialog({
  finding,
  onOpenChange,
  onDone,
  scanId,
  repoId,
}: {
  finding: CodeReviewFinding | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
  scanId: number;
  repoId: number;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const save = async () => {
    if (!finding) return;
    setSaving(true);
    try {
      await acknowledgeReviewFinding(finding.id, reason);
      qc.invalidateQueries({ queryKey: ["code-review", scanId] });
      qc.invalidateQueries({ queryKey: ["repo", repoId, "review"] });
      setReason("");
      onDone();
    } catch (err) {
      toast({
        title: "Could not dismiss the finding",
        description: err instanceof ApiError ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={finding != null} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 480 }}>
        <DialogHeader>
          <DialogTitle>Dismiss this finding</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Say why. The reason is kept with the finding and carried forward, so a later review does not raise
          it again as new.
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Known, tracked elsewhere."
          aria-label="Why this finding is being dismissed"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !canAcknowledge(reason)}>
            {saving ? "Saving…" : "Dismiss"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
