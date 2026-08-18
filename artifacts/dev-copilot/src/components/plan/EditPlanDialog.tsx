import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { fetchRunTree, reviseRunPlan, ApiError, type RunPlan, type RevisionFileInput } from "@/services/api";

type Row = RevisionFileInput;

const OPS = ["create", "edit", "delete"] as const;

/**
 * Edit-plan flow (Phase 2 PR3, §3.2): remove a planned file, change a rationale,
 * or add a file by path (autocomplete against the repo tree). Saving writes a new
 * plan revision and regenerates — it never mutates the current one.
 */
export function EditPlanDialog({
  runId,
  plan,
  open,
  onOpenChange,
  onSaved,
}: {
  runId: number;
  plan: RunPlan;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [tree, setTree] = useState<string[]>([]);
  const [newPath, setNewPath] = useState("");
  const [newRationale, setNewRationale] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed from the current plan each time the sheet opens; load the tree for
  // autocomplete.
  useEffect(() => {
    if (!open) return;
    setRows(
      plan.files.map((f) => ({
        op: f.op,
        path: f.filePath,
        rationale: f.rationale,
        symbols: f.symbols ?? undefined,
        addedByUser: f.addedByUser,
        addedSource: f.addedSource ?? undefined,
      })),
    );
    setNewPath("");
    setNewRationale("");
    fetchRunTree(runId)
      .then((r) => setTree(r.paths))
      .catch(() => setTree([]));
  }, [open, plan, runId]);

  const treeSet = useMemo(() => new Set(tree), [tree]);
  const suggestions = useMemo(() => {
    const q = newPath.trim().toLowerCase();
    if (!q) return [];
    return tree.filter((p) => p.toLowerCase().includes(q)).slice(0, 50);
  }, [newPath, tree]);

  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const setRationale = (i: number, v: string) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, rationale: v } : row)));

  const addRow = () => {
    const path = newPath.trim();
    if (!path) return;
    if (rows.some((r) => r.path === path)) {
      toast({ title: "That file is already in the plan." });
      return;
    }
    const exists = treeSet.has(path);
    setRows((r) => [
      ...r,
      {
        op: exists ? "edit" : "create",
        path,
        rationale: newRationale.trim() || (exists ? "edit this file" : "create this file"),
        addedByUser: true,
        // An existing path came from the tree (autocomplete); a brand-new path
        // was typed by hand (manual) — the strongest signal retrieval missed it.
        addedSource: exists ? "autocomplete" : "manual",
      },
    ]);
    setNewPath("");
    setNewRationale("");
  };

  const save = async () => {
    if (rows.length === 0) {
      toast({ title: "A plan needs at least one file.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await reviseRunPlan(runId, rows);
      toast({ title: `Plan revision ${res.revision} — regenerating`, description: "The agents are re-running against the edited plan." });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({
        title: "Could not save the plan",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent style={{ display: "flex", flexDirection: "column", width: "min(560px, 100vw)", maxWidth: "100vw" }}>
        <SheetHeader>
          <SheetTitle>Edit plan</SheetTitle>
          <SheetDescription>Saving writes a new plan revision and re-runs generation. The current suggestions are kept as the prior revision.</SheetDescription>
        </SheetHeader>

        <div style={{ flex: 1, overflowY: "auto", margin: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((row, i) => (
            <div key={`${row.path}-${i}`} style={{ border: "1px solid var(--c-border)", borderRadius: 6, padding: "8px 10px", background: "var(--c-bg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <select
                  value={row.op}
                  onChange={(e) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, op: e.target.value as Row["op"] } : x)))}
                  style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink-2)" }}
                >
                  {OPS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={row.path}>
                  {row.path}
                </span>
                {row.addedByUser && <span style={{ fontSize: 10, color: "var(--c-blue)", border: "1px solid var(--c-blue)", borderRadius: 3, padding: "0 4px" }}>added</span>}
                <button onClick={() => removeRow(i)} title="Remove file" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-ink-4)", padding: 2 }}>
                  <Trash2 size={13} />
                </button>
              </div>
              <Input
                value={row.rationale}
                onChange={(e) => setRationale(i, e.target.value)}
                placeholder="One-line rationale"
                style={{ fontSize: "var(--fs-sm)" }}
              />
            </div>
          ))}
          {rows.length === 0 && <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", textAlign: "center", padding: 16 }}>No files — add one below.</div>}
        </div>

        {/* Add a file by path with autocomplete against the repo tree. */}
        <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: 10 }}>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Add a file</div>
          <Input list="bm-plan-tree" value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="path/to/File.cs" style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", marginBottom: 6 }} />
          <datalist id="bm-plan-tree">
            {suggestions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <div style={{ display: "flex", gap: 6 }}>
            <Input value={newRationale} onChange={(e) => setNewRationale(e.target.value)} placeholder="Rationale (optional)" style={{ fontSize: "var(--fs-sm)", flex: 1 }} />
            <Button variant="outline" size="sm" onClick={addRow} disabled={!newPath.trim()}>
              <Plus size={13} />Add
            </Button>
          </div>
          {newPath.trim() && !treeSet.has(newPath.trim()) && (
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-amber)", marginTop: 4 }}>Not in the repository — will be added as a new file (create).</div>
          )}
        </div>

        <SheetFooter style={{ marginTop: 12 }}>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <><Loader2 size={13} className="animate-spin" />Saving…</> : "Save & regenerate"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
