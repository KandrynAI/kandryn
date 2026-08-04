import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles } from "lucide-react";
import {
  breakdownWorkItem,
  createWorkItem,
  ApiError,
  type WorkItem,
  type Project,
  type BreakdownChild,
} from "@/services/api";

type Row = BreakdownChild & { selected: boolean };

const CHILD_TYPES: BreakdownChild["itemType"][] = ["story", "task", "bug"];

export function BreakdownDialog({
  project,
  parent,
  open,
  onOpenChange,
  onCreated,
}: {
  project: Project;
  parent: WorkItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushToPlm, setPushToPlm] = useState(false);
  const [creating, setCreating] = useState(false);

  const providerLabel = project.plmProvider === "jira" ? "Jira" : "Azure DevOps";

  useEffect(() => {
    if (!open || !parent) return;
    setRows([]);
    setError(null);
    setPushToPlm(false);
    setLoading(true);
    breakdownWorkItem(parent.id)
      .then((res) => setRows(res.children.map((c) => ({ ...c, selected: true }))))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not generate a breakdown."))
      .finally(() => setLoading(false));
  }, [open, parent]);

  const patchRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const selectedCount = rows.filter((r) => r.selected).length;

  const create = async () => {
    if (!parent) return;
    const chosen = rows.filter((r) => r.selected && r.title.trim());
    if (chosen.length === 0) {
      toast({ title: "Select at least one item", variant: "destructive" });
      return;
    }
    setCreating(true);
    let ok = 0;
    let failed = 0;
    // Sequential so PLM rate limits and ordering stay sane.
    for (const row of chosen) {
      try {
        await createWorkItem(project.id, {
          itemType: row.itemType,
          title: row.title.trim(),
          description: row.description || undefined,
          acceptanceCriteria: row.acceptanceCriteria.length ? row.acceptanceCriteria.join("\n") : undefined,
          parentId: parent.id,
          pushToPlm,
        });
        ok++;
      } catch {
        failed++;
      }
    }
    setCreating(false);
    toast({
      title: `Created ${ok} item${ok === 1 ? "" : "s"}`,
      description: failed ? `${failed} failed — check your PLM connection and try again.` : undefined,
      variant: failed ? "destructive" : undefined,
    });
    if (ok > 0) {
      onCreated();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            Break down “{parent?.title}”
          </DialogTitle>
          <DialogDescription>
            Raptia proposed these child items. Edit, deselect, and create the ones you want.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-2 overflow-y-auto py-1">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Decomposing…</p>
            </div>
          )}
          {error && !loading && (
            <div className="rounded-md border border-red-600/30 bg-red-50 p-4 text-center text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading &&
            !error &&
            rows.map((row, i) => (
              <div key={i} className="flex items-start gap-3 rounded-md border border-border p-3">
                <Checkbox
                  checked={row.selected}
                  onCheckedChange={(v) => patchRow(i, { selected: v === true })}
                  className="mt-2"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex gap-2">
                    <Select value={row.itemType} onValueChange={(v) => patchRow(i, { itemType: v as Row["itemType"] })}>
                      <SelectTrigger className="h-8 w-28 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHILD_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={row.title}
                      onChange={(e) => patchRow(i, { title: e.target.value })}
                      className="h-8"
                    />
                  </div>
                  {row.description && <p className="text-xs text-muted-foreground">{row.description}</p>}
                  {row.acceptanceCriteria.length > 0 && (
                    <ul className="ml-4 list-disc space-y-0.5 text-xs text-muted-foreground">
                      {row.acceptanceCriteria.map((ac, j) => (
                        <li key={j}>{ac}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
        </div>

        {!loading && !error && rows.length > 0 && (
          <div className="flex items-center gap-3 border-t border-border pt-3">
            <Checkbox id="bd-push" checked={pushToPlm} onCheckedChange={(v) => setPushToPlm(v === true)} />
            <Label htmlFor="bd-push" className="cursor-pointer text-sm">
              Also create in {providerLabel}
            </Label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={create} disabled={creating || loading || selectedCount === 0}>
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create {selectedCount > 0 ? selectedCount : ""} item{selectedCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
