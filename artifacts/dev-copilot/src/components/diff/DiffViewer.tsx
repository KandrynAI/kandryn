import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Minus,
  Copy,
  Check,
  GitCommit,
  Loader2,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  WrapText,
  RotateCcw,
} from "lucide-react";
import { agentDisplay } from "@/lib/agents";
import { langForPath, tokenizeLines, type ThemedToken } from "@/lib/shiki";
import type { RunSuggestion, SuggestionFile, DiffHunk, DiffLine } from "@/services/api";

/* ------------------------------------------------------------------ helpers */

/** A suggestion is committable only when every file applied cleanly. */
function isValid(s: RunSuggestion): boolean {
  return s.files.length > 0 && s.files.every((f) => f.applyStatus === "applied");
}

const OP_ICON = { create: Plus, edit: Pencil, delete: Minus } as const;

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Reconstruct one side of the file from the full-context diff (line N ⇒ index N-1). */
function reconstruct(hunks: DiffHunk[], side: "old" | "new"): string {
  const arr: string[] = [];
  for (const h of hunks) {
    for (const l of h.lines) {
      const n = side === "old" ? l.oldNumber : l.newNumber;
      if (n != null) arr[n - 1] = l.content;
    }
  }
  for (let i = 0; i < arr.length; i++) if (arr[i] == null) arr[i] = "";
  return arr.join("\n");
}

type Seg = { text: string; color?: string; hl: boolean };

/**
 * Split a line into render segments carrying both a syntax colour (from Shiki
 * tokens) and an intraline-changed flag. Boundaries are the union of token ends
 * and intraline range edges, so the two overlays compose without conflict.
 */
function buildSegments(text: string, tokens: ThemedToken[] | null, intraline?: Array<[number, number]>): Seg[] {
  if (!text) return [{ text: "", hl: false }];

  // Colour spans, expressed as cumulative end offsets.
  const spans: Array<{ end: number; color?: string }> = [];
  if (tokens && tokens.length) {
    let pos = 0;
    for (const t of tokens) {
      pos += t.content.length;
      spans.push({ end: pos, color: t.color });
    }
    if (spans[spans.length - 1].end < text.length) spans.push({ end: text.length });
  } else {
    spans.push({ end: text.length });
  }

  const bounds = new Set<number>([0, text.length]);
  for (const s of spans) if (s.end <= text.length) bounds.add(s.end);
  if (intraline) for (const [a, b] of intraline) { bounds.add(Math.min(a, text.length)); bounds.add(Math.min(b, text.length)); }
  const cuts = [...bounds].sort((x, y) => x - y);

  const colorAt = (a: number) => {
    for (const s of spans) if (a < s.end) return s.color;
    return undefined;
  };
  const hlAt = (a: number, b: number) => intraline?.some(([s, e]) => a >= s && b <= e) ?? false;

  const segs: Seg[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (a >= b) continue;
    segs.push({ text: text.slice(a, b), color: colorAt(a), hl: hlAt(a, b) });
  }
  return segs.length ? segs : [{ text, hl: false }];
}

type Row =
  | { kind: "line"; line: DiffLine; idx: number }
  | { kind: "expand"; id: number; count: number };

const CONTEXT = 3;

/** Collapse runs of unchanged context (keeping CONTEXT lines around each change). */
function buildRows(lines: DiffLine[], expanded: Set<number>): Row[] {
  const keep = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === "context") continue;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) keep[j] = true;
  }

  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    if (keep[i]) {
      rows.push({ kind: "line", line: lines[i], idx: i });
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && !keep[j]) j++;
    if (expanded.has(i)) {
      for (let k = i; k < j; k++) rows.push({ kind: "line", line: lines[k], idx: k });
    } else {
      rows.push({ kind: "expand", id: i, count: j - i });
    }
    i = j;
  }
  return rows;
}

/* --------------------------------------------------------------- style block */

const DIFF_CSS = `
.bmd-pane { background: var(--c-diff-surface); color: var(--c-diff-fg); border: 1px solid var(--c-diff-border); border-radius: 6px; overflow: hidden; }
.bmd-scroll { overflow-x: auto; }
.bmd-lines { min-width: max-content; font-family: var(--mono); font-size: 12px; line-height: 20px; }
.bmd-lines.wrap { min-width: 0; }
.bmd-row { display: flex; align-items: flex-start; }
.bmd-row.add { background: var(--c-diff-add-bg); box-shadow: inset 2px 0 var(--c-diff-add-border); }
.bmd-row.del { background: var(--c-diff-del-bg); box-shadow: inset 2px 0 var(--c-diff-del-border); }
.bmd-gutter { flex: 0 0 auto; width: 42px; padding: 0 6px; text-align: right; color: var(--c-diff-gutter-fg); user-select: none; white-space: nowrap; }
.bmd-mark { flex: 0 0 auto; width: 16px; text-align: center; user-select: none; color: var(--c-diff-gutter-fg); }
.bmd-content { flex: 0 0 auto; white-space: pre; padding-right: 16px; }
.bmd-lines.wrap .bmd-content { flex: 1 1 auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.bmd-hl-add { background: var(--c-diff-add-bg-strong); border-radius: 2px; }
.bmd-hl-del { background: var(--c-diff-del-bg-strong); border-radius: 2px; }
.bmd-expand { display: flex; align-items: center; gap: 6px; padding: 2px 10px; background: var(--c-diff-expand-bg); color: var(--c-diff-expand-fg); cursor: pointer; user-select: none; font-family: var(--mono); font-size: 11px; border: none; width: 100%; text-align: left; }
.bmd-expand:hover { text-decoration: underline; }
.bmd-tab:focus-visible, .bmd-root:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 1px; }
`;

/* -------------------------------------------------------------- diff surface */

function UnifiedDiff({
  file,
  suggestionKey,
  wrap,
  containerRef,
}: {
  file: SuggestionFile;
  suggestionKey: string;
  wrap: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [tokens, setTokens] = useState<{ old: ThemedToken[][] | null; neu: ThemedToken[][] | null }>({ old: null, neu: null });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const hunks = file.diff ?? [];
  const lines = useMemo(() => hunks.flatMap((h) => h.lines), [hunks]);

  useEffect(() => {
    setExpanded(new Set());
  }, [suggestionKey, file.seq]);

  useEffect(() => {
    let cancelled = false;
    setTokens({ old: null, neu: null });
    const lang = langForPath(file.filePath);
    if (!lang || hunks.length === 0) return;
    const oldText = reconstruct(hunks, "old");
    const newText = reconstruct(hunks, "new");
    Promise.all([
      oldText ? tokenizeLines(oldText, lang) : Promise.resolve(null),
      newText ? tokenizeLines(newText, lang) : Promise.resolve(null),
    ]).then(([old, neu]) => {
      if (!cancelled) setTokens({ old, neu });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionKey, file.seq]);

  if (file.op === "delete") {
    return (
      <div className="bmd-pane" style={{ padding: "14px 16px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--c-diff-fg)" }}>
        This file is deleted.
      </div>
    );
  }
  if (hunks.length === 0) {
    return (
      <div className="bmd-pane" style={{ padding: "14px 16px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--c-diff-gutter-fg)" }}>
        No diff available for this file.
      </div>
    );
  }

  const rows = buildRows(lines, expanded);

  return (
    <div className="bmd-pane">
      <div className="bmd-scroll" ref={containerRef}>
        <div className={wrap ? "bmd-lines wrap" : "bmd-lines"}>
          {rows.map((row) => {
            if (row.kind === "expand") {
              return (
                <button key={`e${row.id}`} className="bmd-expand" onClick={() => setExpanded((prev) => new Set(prev).add(row.id))}>
                  ⋯ Expand {row.count} unchanged line{row.count === 1 ? "" : "s"} ⋯
                </button>
              );
            }
            const l = row.line;
            const lt = l.type === "del" ? tokens.old?.[(l.oldNumber ?? 0) - 1] : tokens.neu?.[(l.newNumber ?? 0) - 1];
            const segs = buildSegments(l.content, lt ?? null, l.intraline);
            const hlClass = l.type === "add" ? "bmd-hl-add" : "bmd-hl-del";
            const marker = l.type === "add" ? "+" : l.type === "del" ? "−" : " ";
            return (
              <div key={row.idx} data-idx={row.idx} className={`bmd-row ${l.type}`}>
                <span className="bmd-gutter">{l.oldNumber ?? ""}</span>
                <span className="bmd-gutter">{l.newNumber ?? ""}</span>
                <span className="bmd-mark">{marker}</span>
                <span className="bmd-content">
                  {segs.map((s, i) =>
                    s.hl ? (
                      <span key={i} className={hlClass} style={{ color: s.color }}>
                        {s.text}
                      </span>
                    ) : (
                      <span key={i} style={{ color: s.color }}>
                        {s.text}
                      </span>
                    ),
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- invalid panel */

function InvalidFile({ file }: { file: SuggestionFile }) {
  const [label, ...rest] = (file.applyError ?? "This change could not be applied.").split("\n\n");
  const search = rest.join("\n\n");
  return (
    <div style={{ border: "1px solid var(--c-red)", background: "var(--c-red-bg)", borderRadius: 6, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <AlertTriangle size={14} style={{ color: "var(--c-red)" }} />
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-red)" }}>This change could not be applied.</span>
      </div>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.5, margin: "0 0 8px" }}>{label}</p>
      {search && (
        <pre style={{ margin: 0, padding: "10px 12px", background: "var(--c-diff-surface)", color: "var(--c-diff-fg)", border: "1px solid var(--c-diff-border)", borderRadius: 4, fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.5, overflowX: "auto" }}>
          <code>{search}</code>
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ main */

export interface DiffViewerProps {
  suggestions: RunSuggestion[];
  committedId: number | null;
  committingId: number | null;
  /** Set by the parent when a commit failed because the branch moved (1.5). */
  staleMessage?: string | null;
  onCommit: (s: RunSuggestion) => void;
  onReRun?: () => void;
  rerunning?: boolean;
  prUrl?: string | null;
  onReview?: () => void;
  reviewing?: boolean;
  /** Renders the collapsible Synthesia score breakdown for the selected suggestion. */
  renderScoreAnalysis?: (s: RunSuggestion) => ReactNode;
  /** Plan file paths, in plan order — drives pending tabs for planned-but-absent files (§3.4). */
  plannedPaths?: string[];
}

export function DiffViewer({
  suggestions,
  committedId,
  committingId,
  staleMessage,
  onCommit,
  onReRun,
  rerunning,
  prUrl,
  onReview,
  reviewing,
  renderScoreAnalysis,
  plannedPaths,
}: DiffViewerProps) {
  const isCommitted = committedId != null;

  const initialSel = useMemo(() => {
    if (committedId != null) {
      const i = suggestions.findIndex((s) => s.id === committedId);
      if (i >= 0) return i;
    }
    const rec = suggestions.findIndex((s) => s.recommendation === "Recommended" && isValid(s));
    if (rec >= 0) return rec;
    const v = suggestions.findIndex(isValid);
    return v >= 0 ? v : 0;
  }, [committedId, suggestions]);

  const [sel, setSel] = useState(initialSel);
  useEffect(() => {
    setSel(initialSel);
  }, [initialSel]);

  const suggestion = suggestions[sel] ?? suggestions[0];
  const files = useMemo(() => [...suggestion.files].sort((a, b) => a.seq - b.seq), [suggestion]);
  const [fileIdx, setFileIdx] = useState(0);
  useEffect(() => {
    setFileIdx(0);
  }, [suggestion.id]);

  const file = files[Math.min(fileIdx, files.length - 1)] ?? files[0];
  // Planned files this suggestion didn't produce → pending tabs, in plan order (§3.4).
  const pendingPaths = plannedPaths ? plannedPaths.filter((p) => !files.some((f) => f.filePath === p)) : [];
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hunkCursor = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const selValid = isValid(suggestion);
  const allInvalid = suggestions.every((s) => !isValid(s));
  const canCommit = !isCommitted && selValid && committingId == null;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(file.filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  // [ / ] jump between change runs in the current file.
  const jumpHunk = (dir: 1 | -1) => {
    const anchors = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>(".bmd-row.add, .bmd-row.del") ?? []);
    const starts = anchors.filter((el, i) => i === 0 || anchors[i - 1] !== el.previousElementSibling);
    if (!starts.length) return;
    hunkCursor.current = Math.max(0, Math.min(starts.length - 1, hunkCursor.current + dir));
    starts[hunkCursor.current]?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      setFileIdx((i) => Math.min(files.length - 1, i + 1));
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      setFileIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "]") {
      e.preventDefault();
      jumpHunk(1);
    } else if (e.key === "[") {
      e.preventDefault();
      jumpHunk(-1);
    } else if (e.key === "c" && canCommit) {
      e.preventDefault();
      onCommit(suggestion);
    }
  };

  return (
    <div ref={rootRef} className="bmd-root" tabIndex={0} onKeyDown={onKeyDown} style={{ outline: "none", marginTop: 12 }}>
      <style>{DIFF_CSS}</style>

      {/* Agent tabs */}
      <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--c-border)" }}>
        {suggestions.map((s, i) => {
          const d = agentDisplay(s.agent);
          const active = i === sel;
          const committedTab = s.id === committedId;
          const valid = isValid(s);
          return (
            <button
              key={s.id}
              role="tab"
              className="bmd-tab"
              aria-selected={active}
              onClick={() => setSel(i)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "8px 12px",
                border: "none",
                borderBottom: active ? `2px solid ${d.colour}` : "2px solid transparent",
                background: "none",
                cursor: "pointer",
                opacity: !valid && !active ? 0.6 : 1,
              }}
              title={valid ? undefined : "This suggestion could not be applied"}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", fontWeight: 600, color: active ? d.colour : "var(--c-ink-3)" }}>{d.name}</span>
              {s.score != null && <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{s.score}/10</span>}
              {committedTab ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--fs-xs)", fontWeight: 700, color: "var(--c-green)" }}>
                  <Check size={11} />Committed
                </span>
              ) : s.recommendation === "Recommended" ? (
                <span style={{ fontSize: 10, fontWeight: 700, background: "var(--c-blue)", color: "#fff", padding: "1px 5px", borderRadius: 2, letterSpacing: "0.04em" }}>REC</span>
              ) : null}
              {!valid && <AlertTriangle size={12} style={{ color: "var(--c-red)" }} />}
            </button>
          );
        })}
      </div>

      {/* Summary bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 2px", borderBottom: "1px solid var(--c-border)" }}>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
          {suggestion.files.length} file{suggestion.files.length === 1 ? "" : "s"} changed
        </span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-diff-add-border)" }}>
          +{suggestion.files.reduce((n, f) => n + (f.linesAdded ?? 0), 0)}
        </span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-diff-del-border)" }}>
          −{suggestion.files.reduce((n, f) => n + (f.linesRemoved ?? 0), 0)}
        </span>
        {suggestion.explanation && (
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", marginLeft: "auto", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={suggestion.explanation}>
            {suggestion.explanation}
          </span>
        )}
      </div>

      {/* File tabs (or select on narrow viewports) */}
      {narrow ? (
        <select
          value={fileIdx}
          onChange={(e) => setFileIdx(Number(e.target.value))}
          style={{ margin: "8px 0", padding: "6px 8px", width: "100%", fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", background: "var(--c-bg)", color: "var(--c-ink)", border: "1px solid var(--c-border)", borderRadius: 4 }}
        >
          {files.map((f, i) => (
            <option key={f.seq} value={i}>
              {baseName(f.filePath)}  +{f.linesAdded} −{f.linesRemoved}
            </option>
          ))}
        </select>
      ) : (
        <div style={{ position: "relative", margin: "8px 0" }}>
          <div style={{ display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none" }}>
            {files.map((f, i) => {
              const OpIcon = OP_ICON[f.op];
              const active = i === fileIdx;
              const bad = f.applyStatus === "failed";
              return (
                <button
                  key={f.seq}
                  className="bmd-tab"
                  onClick={() => setFileIdx(i)}
                  title={f.filePath}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    flex: "0 0 auto",
                    padding: "5px 10px",
                    border: "1px solid var(--c-border)",
                    borderRadius: 4,
                    background: active ? "var(--c-raised)" : "var(--c-bg)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <OpIcon size={12} style={{ color: bad ? "var(--c-red)" : f.op === "delete" ? "var(--c-diff-del-border)" : "var(--c-diff-add-border)" }} />
                  <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: active ? "var(--c-ink)" : "var(--c-ink-3)" }}>{baseName(f.filePath)}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-diff-add-border)" }}>+{f.linesAdded}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-diff-del-border)" }}>−{f.linesRemoved}</span>
                  {f.deviationReason && (
                    <span title={`Not in the plan — ${f.deviationReason}`} style={{ color: "var(--c-amber)", fontSize: 13, lineHeight: 1 }}>●</span>
                  )}
                </button>
              );
            })}
            {/* Planned files this suggestion didn't generate — pending tabs (§3.4). */}
            {pendingPaths.map((p) => (
              <span
                key={`pending-${p}`}
                title={`Planned but not generated: ${p}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  flex: "0 0 auto",
                  padding: "5px 10px",
                  border: "1px dashed var(--c-border)",
                  borderRadius: 4,
                  background: "transparent",
                  whiteSpace: "nowrap",
                  opacity: 0.6,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", border: "1px solid var(--c-ink-4)" }} />
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", fontStyle: "italic" }}>{baseName(p)}</span>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>pending</span>
              </span>
            ))}
          </div>
          {files.length + pendingPaths.length > 6 && (
            <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 28, pointerEvents: "none", background: "linear-gradient(90deg, transparent, var(--c-bg))" }} />
          )}
        </div>
      )}

      {/* Sticky file header */}
      <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderBottom: "none", borderTopLeftRadius: 6, borderTopRightRadius: 6 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.filePath}>
          {file.filePath}
        </span>
        <button className="bm-ghost" onClick={copyPath} title="Copy path" style={{ marginLeft: "auto", border: "none", padding: 2, color: "var(--c-ink-4)" }}>
          {copied ? <Check size={12} style={{ color: "var(--c-green)" }} /> : <Copy size={12} />}
        </button>
        <button className="bm-ghost" onClick={() => setWrap((w) => !w)} title={wrap ? "Disable wrap" : "Enable wrap"} style={{ border: "none", padding: 2, color: wrap ? "var(--c-blue)" : "var(--c-ink-4)" }}>
          <WrapText size={12} />
        </button>
      </div>

      {/* Diff or invalid panel */}
      {file.applyStatus === "failed" ? (
        <div style={{ padding: "10px 0" }}>
          <InvalidFile file={file} />
        </div>
      ) : (
        <UnifiedDiff file={file} suggestionKey={String(suggestion.id)} wrap={wrap} containerRef={scrollRef} />
      )}

      {/* Score analysis (parent-rendered, keeps run-detail's breakdown UI) */}
      {renderScoreAnalysis?.(suggestion)}

      {/* Stale banner */}
      {staleMessage && (
        <div style={{ marginTop: 12, border: "1px solid var(--c-amber)", background: "var(--c-amber-bg)", borderRadius: 6, padding: "10px 14px" }}>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.5 }}>{staleMessage}</div>
          {onReRun && (
            <button className="bm-ghost" onClick={onReRun} disabled={rerunning} style={{ marginTop: 8 }}>
              {rerunning ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}Re-run this item
            </button>
          )}
        </div>
      )}

      {/* Sticky commit bar */}
      <div style={{ position: "sticky", bottom: 0, display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "10px 0", borderTop: "1px solid var(--c-border)", background: "var(--c-bg)" }}>
        {isCommitted ? (
          suggestion.id === committedId ? (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-green)" }}>
                <Check size={13} />Committed
              </span>
              <button className="bm-ghost" onClick={() => prUrl && window.open(prUrl, "_blank")} disabled={!prUrl} style={{ marginLeft: "auto" }}>
                <ExternalLink size={12} />View PR →
              </button>
              {onReview && (
                <button className="bm-ghost" onClick={onReview} disabled={reviewing}>
                  {reviewing ? <><Loader2 size={12} className="animate-spin" />Running Veria…</> : <><ShieldCheck size={12} />Run Veria</>}
                </button>
              )}
            </>
          ) : (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>Alternative — another suggestion was committed for this run.</span>
          )
        ) : (
          <>
            {!selValid && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--fs-xs)", color: "var(--c-red)" }}>
                <AlertTriangle size={12} />{allInvalid ? "No suggestion could be applied to the repository." : "This suggestion could not be applied and can't be committed."}
              </span>
            )}
            <button className="bm-primary" onClick={() => onCommit(suggestion)} disabled={!canCommit} style={{ marginLeft: "auto" }}>
              {committingId === suggestion.id ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}Commit
            </button>
          </>
        )}
      </div>
    </div>
  );
}
