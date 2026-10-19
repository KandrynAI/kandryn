import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Play, CalendarClock, Loader2 } from "lucide-react";
import {
  createRun,
  checkSequence,
  sequenceRefusal,
  ApiError,
  type RunDetail,
  type SequenceCheck,
} from "@/services/api";
import { SequenceDialog, type SequenceConfirmation } from "@/components/sequence/SequenceDialog";

/**
 * Convert a `datetime-local` value (local wall-clock, no zone) to an ISO UTC
 * string the API accepts. Returns null for an empty/invalid value.
 */
function localInputToIsoUtc(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Default the schedule picker to one hour out, in the browser's local zone. */
function defaultScheduleValue(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  // Trim to minutes and render as the `datetime-local` expects (local time).
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RunPanel({
  item,
  open,
  onOpenChange,
  onScheduled,
  scheduleDefault = false,
  initialPrompt,
  parentRunId,
  triggerContext,
}: {
  // Only id + title are used, so the full board WorkItem also satisfies this.
  item: { id: number; title: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
  /** Presentational: pre-check "Schedule for later" when the panel opens. */
  scheduleDefault?: boolean;
  /** Pre-fill the refinement box (e.g. a drafted remediation prompt); editable. */
  initialPrompt?: string;
  /** Remediation re-run: link the new run to its source and tag its context. */
  parentRunId?: number;
  triggerContext?: "remediation";
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [refinePrompt, setRefinePrompt] = useState("");
  const [autoCommit, setAutoCommit] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue);
  const [busy, setBusy] = useState<"run" | "schedule" | null>(null);
  // Run-order gate (0038). `pending` remembers what the user asked for so the
  // same request can be replayed with the override attached once confirmed.
  const [seqCheck, setSeqCheck] = useState<SequenceCheck | null>(null);
  const [seqNotice, setSeqNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ mode: "run" | "schedule"; iso: string | null } | null>(null);

  // Reflect the requested default and any pre-filled prompt when opened. The
  // prompt stays fully editable — this only seeds it.
  useEffect(() => {
    if (open) {
      setScheduleOn(scheduleDefault);
      setRefinePrompt(initialPrompt ?? "");
    }
  }, [open, scheduleDefault, initialPrompt]);

  const reset = () => {
    setRefinePrompt("");
    setAutoCommit(false);
    setScheduleOn(false);
    setScheduleAt(defaultScheduleValue());
    setBusy(null);
  };

  const close = () => {
    onOpenChange(false);
    // Give the sheet time to animate out before clearing.
    setTimeout(reset, 200);
  };

  /**
   * Start (or schedule) a run, handling the run-order gate.
   *
   * The check is asked for up front so a clear item never sees a dialog — the
   * common case stays one click. The server recomputes it anyway, so a refusal
   * on the actual request is still handled here: that is the path where the
   * world moved while the dialog was open.
   */
  const submit = async (mode: "run" | "schedule", iso: string | null, sequence?: SequenceConfirmation) => {
    if (!item) return;
    setBusy(mode);
    try {
      const result = await createRun(item.id, {
        refinePrompt: refinePrompt.trim() || undefined,
        autoCommit,
        scheduledAt: iso ?? undefined,
        parentRunId,
        triggerContext,
        sequence,
      });
      setSeqCheck(null);
      setSeqNotice(null);
      setPending(null);
      if (mode === "schedule") {
        toast({
          title: "Run scheduled",
          description: `${item.title} will run ${new Date(iso!).toLocaleString()}.`,
        });
        close();
        onScheduled?.();
        return;
      }
      const runId = (result as RunDetail).run?.id;
      close();
      if (runId) navigate(`/runs/${runId}`);
    } catch (err) {
      setBusy(null);
      const refusal = sequenceRefusal(err);
      if (refusal) {
        // Always re-render against the check the server just computed, not the
        // one the dialog was holding.
        setSeqCheck(refusal.check);
        setPending({ mode, iso });
        setSeqNotice(
          refusal.code === "SEQUENCE_STALE" ? "Things changed while this was open. Review again." : null,
        );
        return;
      }
      toast({
        title: mode === "run" ? "Run failed to start" : "Could not schedule run",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  /** Ask first, so a clear item never pays for a dialog it does not need. */
  const start = async (mode: "run" | "schedule", iso: string | null) => {
    if (!item) return;
    setBusy(mode);
    try {
      const check = await checkSequence(item.id);
      if (check.verdict !== "clear") {
        setBusy(null);
        setSeqCheck(check);
        setSeqNotice(null);
        setPending({ mode, iso });
        return;
      }
    } catch {
      // The check is advisory on the client; the server enforces it regardless.
      // A failure here must not stop someone running their work.
    }
    await submit(mode, iso);
  };

  const runNow = () => void start("run", null);

  const schedule = () => {
    if (!item) return;
    const iso = localInputToIsoUtc(scheduleAt);
    if (!iso) {
      toast({ title: "Pick a valid date & time", variant: "destructive" });
      return;
    }
    if (new Date(iso).getTime() <= Date.now()) {
      toast({ title: "Scheduled time must be in the future", variant: "destructive" });
      return;
    }
    void start("schedule", iso);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Run agents</SheetTitle>
          <SheetDescription>
            {item ? item.title : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto py-4">
          <div className="space-y-2">
            <Label htmlFor="refine">Refinement (optional)</Label>
            <Textarea
              id="refine"
              placeholder="Ask Raptia and Fovea to adjust the approach…"
              value={refinePrompt}
              onChange={(e) => setRefinePrompt(e.target.value)}
              rows={4}
            />
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border p-3">
            <Checkbox
              id="auto-commit"
              checked={autoCommit}
              onCheckedChange={(v) => setAutoCommit(v === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="auto-commit" className="cursor-pointer">
                Auto-commit the top suggestion
              </Label>
              <p className="text-xs text-muted-foreground">
                Opens a branch and PR automatically once the run finishes. Off by default — you'll
                normally review first.
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="schedule-on"
                checked={scheduleOn}
                onCheckedChange={(v) => setScheduleOn(v === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="schedule-on" className="cursor-pointer">
                  Schedule for later
                </Label>
                <p className="text-xs text-muted-foreground">
                  Runs in the background at the time you pick (up to 30 days out). We'll email you
                  when it finishes.
                </p>
              </div>
            </div>
            {scheduleOn && (
              <Input
                type="datetime-local"
                value={scheduleAt}
                min={defaultScheduleValue()}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
            )}
          </div>
        </div>

        <SheetFooter className="flex-row gap-2 sm:justify-end">
          {scheduleOn ? (
            <Button onClick={schedule} disabled={busy !== null} className="flex-1 sm:flex-none">
              {busy === "schedule" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarClock className="mr-2 h-4 w-4" />
              )}
              Schedule run
            </Button>
          ) : (
            <Button onClick={runNow} disabled={busy !== null} className="flex-1 sm:flex-none">
              {busy === "run" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {busy === "run" ? "Running…" : "Run now"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>

      {/* The run-order gate. Rendered alongside the sheet rather than inside
          it so the two modals do not fight over focus. */}
      <SequenceDialog
        open={seqCheck !== null}
        check={seqCheck}
        itemKey={seqCheck?.itemKey ?? ""}
        itemTitle={seqCheck?.itemTitle ?? item?.title ?? ""}
        staleNotice={seqNotice}
        busy={busy !== null}
        onOpenChange={(next) => {
          if (!next) {
            setSeqCheck(null);
            setSeqNotice(null);
            setPending(null);
          }
        }}
        onOpenItem={(itemId) => {
          close();
          navigate(`/tasks/${itemId}`);
        }}
        onConfirm={(confirmation) => {
          if (!pending) return;
          void submit(pending.mode, pending.iso, confirmation);
        }}
      />
    </Sheet>
  );
}
