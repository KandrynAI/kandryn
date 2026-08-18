import { useState } from "react";
import { Plus, Pencil, Minus, ChevronDown, ChevronRight, ListChecks, Pencil as EditIcon } from "lucide-react";
import type { RunPlan, RunPlanFile } from "@/services/api";

const OP_ICON = { create: Plus, edit: Pencil, delete: Minus } as const;
const OP_COLOR = { create: "var(--c-green)", edit: "var(--c-ink-3)", delete: "var(--c-red)" } as const;

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
function dirName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i + 1) : "";
}

function PlanRow({ f, appear }: { f: RunPlanFile; appear: number }) {
  const Icon = OP_ICON[f.op];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "18px minmax(0, 1fr) minmax(0, 1.1fr)",
        gap: 10,
        alignItems: "start",
        padding: "8px 0",
        borderTop: "1px solid var(--c-border)",
        animation: "bmrise 0.3s ease-out both",
        animationDelay: `${appear * 60}ms`,
      }}
    >
      <Icon size={14} style={{ color: OP_COLOR[f.op], marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {baseName(f.filePath)}
          </span>
          {f.addedByUser && (
            <span style={{ fontSize: 10, color: "var(--c-blue)", border: "1px solid var(--c-blue)", borderRadius: 3, padding: "0 4px" }}>added</span>
          )}
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {dirName(f.filePath) || "(repo root)"}
        </div>
      </div>
      <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.5, alignSelf: "center" }}>{f.rationale}</div>
    </div>
  );
}

/**
 * The change plan display (Phase 2 PR3, §3.1). `mode="full"` gives it real
 * presence during planning/generation; `mode="summary"` collapses it to a
 * one-liner during review, expandable on click. `onEdit` opens the Edit-plan
 * flow.
 */
export function PlanPanel({
  plan,
  mode,
  onEdit,
  editable = true,
}: {
  plan: RunPlan;
  mode: "full" | "summary";
  onEdit?: () => void;
  editable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const files = plan.files;
  const count = files.length;

  const editButton = editable && onEdit && (
    <button className="bm-ghost" onClick={onEdit} title="Edit plan" style={{ marginLeft: "auto" }}>
      <EditIcon size={12} />Edit plan
    </button>
  );

  if (mode === "summary") {
    const names = files.map((f) => baseName(f.filePath).replace(/\.[^.]+$/, "")).join(", ");
    return (
      <div style={{ border: "1px solid var(--c-border)", borderRadius: 6, background: "var(--c-surface)", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
          <button onClick={() => setExpanded((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--c-ink-2)", padding: 0, minWidth: 0 }}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <ListChecks size={13} style={{ color: "var(--c-ink-3)" }} />
            <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, whiteSpace: "nowrap" }}>{count} file{count === 1 ? "" : "s"}</span>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {names}</span>
          </button>
          {plan.revision > 1 && <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>rev {plan.revision}</span>}
          {editButton}
        </div>
        {expanded && (
          <div style={{ padding: "0 12px 8px" }}>
            {files.map((f) => (
              <PlanRow key={f.id} f={f} appear={0} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 6, background: "var(--c-surface)", marginBottom: 16, animation: "bmrise 0.3s ease-out both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px" }}>
        <ListChecks size={15} style={{ color: "var(--c-blue)" }} />
        <span style={{ fontSize: "var(--fs-lg)", fontWeight: 600 }}>Planning changes</span>
        {plan.revision > 1 && <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>revision {plan.revision}</span>}
        {editButton}
      </div>
      <div style={{ padding: "0 14px 4px" }}>
        {files.map((f, i) => (
          <PlanRow key={f.id} f={f} appear={i} />
        ))}
      </div>
      <div style={{ padding: "8px 14px 12px", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", borderTop: "1px solid var(--c-border)" }}>
        {count} file{count === 1 ? "" : "s"}
      </div>
    </div>
  );
}
