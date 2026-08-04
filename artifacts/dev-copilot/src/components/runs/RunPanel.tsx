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
import { createRun, ApiError, type WorkItem, type RunDetail } from "@/services/api";

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
}: {
  item: WorkItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
  /** Presentational: pre-check "Schedule for later" when the panel opens. */
  scheduleDefault?: boolean;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [refinePrompt, setRefinePrompt] = useState("");
  const [autoCommit, setAutoCommit] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue);
  const [busy, setBusy] = useState<"run" | "schedule" | null>(null);

  // Reflect the requested default whenever the panel is opened.
  useEffect(() => {
    if (open) setScheduleOn(scheduleDefault);
  }, [open, scheduleDefault]);

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

  const runNow = async () => {
    if (!item) return;
    setBusy("run");
    try {
      const result = await createRun(item.id, {
        refinePrompt: refinePrompt.trim() || undefined,
        autoCommit,
      });
      // Inline runs resolve to a RunDetail.
      const runId = (result as RunDetail).run?.id;
      close();
      if (runId) navigate(`/runs/${runId}`);
    } catch (err) {
      setBusy(null);
      toast({
        title: "Run failed to start",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const schedule = async () => {
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
    setBusy("schedule");
    try {
      await createRun(item.id, {
        refinePrompt: refinePrompt.trim() || undefined,
        autoCommit,
        scheduledAt: iso,
      });
      toast({
        title: "Run scheduled",
        description: `${item.title} will run ${new Date(iso).toLocaleString()}.`,
      });
      close();
      onScheduled?.();
    } catch (err) {
      setBusy(null);
      toast({
        title: "Could not schedule run",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
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
    </Sheet>
  );
}
