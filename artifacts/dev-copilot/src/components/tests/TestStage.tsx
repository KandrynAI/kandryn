import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, Loader2, GitCommit, Upload, RotateCcw, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import {
  generateTests,
  commitTestScript,
  pushTestCases,
  ApiError,
  type GeneratedTests,
  type TestCase,
} from "@/services/api";

type CaseRow = TestCase & { selected: boolean };
type Filter = "all" | "happy-path" | "edge-case" | "failure";

const PRIORITY_DOT: Record<string, string> = { high: "var(--c-red)", medium: "var(--c-amber)", low: "var(--c-ink-4)" };
const TYPE_LABEL: Record<string, string> = { "happy-path": "happy", "edge-case": "edge", failure: "fail" };

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "happy-path", label: "Happy path" },
  { key: "edge-case", label: "Edge cases" },
  { key: "failure", label: "Failures" },
];

/**
 * Final stage of the run workspace: generate rich AC-driven test cases + a
 * runnable script for a committed work item, commit the script to the same PR,
 * and push selected cases to the PLM.
 */
export function TestStage({ workItemId, canPushToPlm }: { workItemId: number; canPushToPlm: boolean }) {
  const { toast } = useToast();
  const [tests, setTests] = useState<GeneratedTests | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [filePath, setFilePath] = useState("");
  const [code, setCode] = useState("");
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pushed, setPushed] = useState<Record<string, { plmUrl: string; plmKey: string }>>({});

  const generate = async () => {
    setGenerating(true);
    try {
      const t = await generateTests(workItemId);
      setTests(t);
      setCases(t.testCases.map((c) => ({ ...c, selected: true })));
      setFilePath(t.testScript.filePath);
      setCode(t.testScript.code);
      setCommitted(false);
      setPushed({});
    } catch (err) {
      toast({
        title: "Could not generate tests",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const commit = async () => {
    if (!filePath.trim() || !code.trim()) {
      toast({ title: "Test script is empty", variant: "destructive" });
      return;
    }
    setCommitting(true);
    try {
      const res = await commitTestScript(workItemId, filePath.trim(), code);
      setCommitted(true);
      toast({ title: "Test script committed", description: res.prUrl ?? "Added to the open PR." });
    } catch (err) {
      toast({
        title: "Commit failed",
        description: err instanceof ApiError ? err.message : "Could not commit the test script.",
        variant: "destructive",
      });
    } finally {
      setCommitting(false);
    }
  };

  const push = async () => {
    const chosen = cases.filter((c) => c.selected);
    if (chosen.length === 0) {
      toast({ title: "Select at least one case", variant: "destructive" });
      return;
    }
    setPushing(true);
    try {
      const res = await pushTestCases(
        workItemId,
        chosen.map(({ selected: _selected, ...c }) => c),
      );
      setPushed((prev) => {
        const next = { ...prev };
        for (const p of res.pushed) next[p.testCaseId] = { plmUrl: p.plmUrl, plmKey: p.plmKey };
        return next;
      });
      toast({ title: `Pushed ${res.pushed.length} test case${res.pushed.length === 1 ? "" : "s"} to the PLM` });
    } catch (err) {
      toast({
        title: "Push failed",
        description: err instanceof ApiError ? err.message : "Could not push test cases.",
        variant: "destructive",
      });
    } finally {
      setPushing(false);
    }
  };

  const selectedCount = cases.filter((c) => c.selected).length;
  const allSelected = cases.length > 0 && selectedCount === cases.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const filtered = useMemo(() => (filter === "all" ? cases : cases.filter((c) => c.type === filter)), [cases, filter]);

  const toggleAll = () => {
    const target = !allSelected;
    setCases((prev) => prev.map((c) => ({ ...c, selected: target })));
  };
  const toggleRow = (id: string, v: boolean) =>
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, selected: v } : c)));
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-bg)" }}>
      <style>{`
        .ts-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-bottom:1px solid var(--c-border); }
        .ts-pill { font-size: var(--fs-sm); font-weight:500; padding:3px 10px; border:1px solid var(--c-border); border-radius:3px; background:transparent; color:var(--c-ink-3); cursor:pointer; white-space:nowrap; }
        .ts-pill.active { background: var(--c-blue); color:#fff; border-color: var(--c-blue); }
        .ts-row { display:grid; grid-template-columns:20px 80px 60px 1fr; gap:10px; padding:10px 12px; border-bottom:1px solid var(--c-border); }
        .ts-row.checked { box-shadow: inset 3px 0 0 var(--c-blue); background: var(--c-blue-bg); }
        .ts-assert { margin-top:6px; font-family:var(--mono); font-size:var(--fs-xs); color:var(--c-ink-4); background:var(--c-raised); padding:4px 8px; border-radius:3px; overflow-x:auto; }
        .ts-toggle { display:inline-flex; align-items:center; gap:3px; font-size:var(--fs-xs); color:var(--c-ink-4); background:none; border:none; cursor:pointer; padding:2px 0; }
        .ts-gwt { font-size:var(--fs-xs); color:var(--c-ink-3); line-height:1.45; }
        .ts-gwt b { color: var(--c-ink-4); font-weight:600; }
      `}</style>

      {/* Component header */}
      <div className="ts-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FlaskConical size={16} style={{ color: "var(--c-amber)" }} />
          <span style={{ fontSize: "var(--fs-lg)", fontWeight: 600 }}>Tests</span>
        </div>
        {!tests && (
          <button className="bm-primary" onClick={generate} disabled={generating}>
            {generating ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
            {generating ? "Generating…" : "Generate tests"}
          </button>
        )}
      </div>

      {!tests ? (
        <p style={{ padding: "22px 14px", textAlign: "center", fontSize: "var(--fs-base)", color: "var(--c-ink-4)" }}>
          Generate detailed, AC-driven test cases and a runnable script from the committed change.
        </p>
      ) : (
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Test script */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)" }}>
                Test script{tests.testScript.framework ? ` · ${tests.testScript.framework}` : ""}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="bm-ghost" onClick={generate} disabled={generating}>
                  <RotateCcw size={12} />Regenerate
                </button>
                <button className="bm-primary" onClick={commit} disabled={committing || committed}>
                  {committing ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}
                  {committed ? "Committed" : "Commit to PR"}
                </button>
              </div>
            </div>
            <Input value={filePath} onChange={(e) => setFilePath(e.target.value)} className="font-mono text-xs" />
            <Textarea value={code} onChange={(e) => setCode(e.target.value)} rows={10} className="font-mono text-xs" />
          </div>

          {/* Test cases */}
          <div>
            {/* header bar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)" }}>
                Test cases <span style={{ color: "var(--c-ink-3)" }}>· {cases.length} case{cases.length === 1 ? "" : "s"}</span>
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", cursor: "pointer" }}>
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    disabled={!canPushToPlm}
                  />
                  Select all
                </label>
                <button
                  className="bm-primary"
                  onClick={push}
                  disabled={pushing || selectedCount === 0 || !canPushToPlm}
                  title={canPushToPlm ? undefined : "This work item isn't linked to a PLM story"}
                >
                  {pushing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {pushing ? `Pushing ${selectedCount}…` : `Push selected to PLM`}
                </button>
              </div>
            </div>

            {!canPushToPlm && (
              <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginBottom: 8 }}>
                This work item isn't linked to a Jira/ADO story, so cases can't be pushed. The script can still be committed.
              </p>
            )}

            {/* filter pills */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {FILTERS.map((f) => (
                <button key={f.key} className={`ts-pill${filter === f.key ? " active" : ""}`} onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>

            {/* rows */}
            <div style={{ border: "1px solid var(--c-border)", borderRadius: 4, overflow: "hidden" }}>
              {filtered.length === 0 ? (
                <p style={{ padding: 12, fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>No cases in this filter.</p>
              ) : (
                filtered.map((c) => {
                  const isPushed = pushed[c.id];
                  const isOpen = expanded.has(c.id);
                  return (
                    <div key={c.id} className={`ts-row${c.selected ? " checked" : ""}`}>
                      {/* checkbox */}
                      <div style={{ paddingTop: 1 }}>
                        <Checkbox checked={c.selected} onCheckedChange={(v) => toggleRow(c.id, v === true)} disabled={!canPushToPlm} />
                      </div>

                      {/* priority + type */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-xs)", color: "var(--c-ink-3)" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: PRIORITY_DOT[c.priority] ?? "var(--c-ink-4)" }} />
                          {c.priority}
                        </span>
                        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{TYPE_LABEL[c.type] ?? c.type}</span>
                      </div>

                      {/* id */}
                      <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{c.id}</span>

                      {/* content */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-ink)" }}>{c.title}</span>
                          {isPushed && (
                            <a href={isPushed.plmUrl} target="_blank" rel="noopener noreferrer"
                              style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-green)", background: "var(--c-green-bg)", padding: "1px 6px", borderRadius: 3 }}>
                              Pushed · {isPushed.plmKey}<ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        {c.given && <div className="ts-gwt"><b>Given</b> {c.given}</div>}
                        {c.when && <div className="ts-gwt"><b>When</b> {c.when}</div>}
                        {c.then && <div className="ts-gwt"><b>Then</b> {c.then}</div>}
                        {c.assertion && (
                          <>
                            <button className="ts-toggle" onClick={() => toggleExpand(c.id)}>
                              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} assertion
                            </button>
                            {isOpen && (
                              <div className="ts-assert">
                                <span style={{ color: "var(--c-ink-4)" }}>Assert: </span>{c.assertion}
                              </div>
                            )}
                          </>
                        )}
                        {c.tags.length > 0 && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                            {c.tags.map((t) => (
                              <span key={t} style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", background: "var(--c-raised)", padding: "1px 5px", borderRadius: 2 }}>{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
