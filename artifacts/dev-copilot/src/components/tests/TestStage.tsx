import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, Loader2, GitCommit, Upload } from "lucide-react";
import {
  generateTests,
  commitTestScript,
  pushTestCases,
  ApiError,
  type GeneratedTests,
  type TestCase,
} from "@/services/api";

type CaseRow = TestCase & { selected: boolean };

/**
 * Final stage of the run workspace (spec §6): generate Given/When/Then cases +
 * a test script for a committed work item, commit the script to the same PR,
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
  const [pushing, setPushing] = useState(false);
  const [committed, setCommitted] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const t = await generateTests(workItemId);
      setTests(t);
      setCases(t.testCases.map((c) => ({ ...c, selected: true })));
      setFilePath(t.testScript.filePath);
      setCode(t.testScript.code);
      setCommitted(false);
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
      toast({ title: `Pushed ${res.created.length} test case${res.created.length === 1 ? "" : "s"} to the PLM` });
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

  return (
    <div className="rounded-lg border border-border bg-card/40">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-semibold">Tests</h2>
        </div>
        {!tests && (
          <Button size="sm" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="mr-2 h-3.5 w-3.5" />}
            {generating ? "Generating…" : "Generate tests"}
          </Button>
        )}
      </div>

      {!tests ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Generate Given/When/Then cases and a runnable test script from the committed change.
        </p>
      ) : (
        <div className="space-y-5 p-4">
          {/* Test script */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-muted-foreground">Test script</label>
              <div className="flex items-center gap-2">
                {tests.testScript.framework && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {tests.testScript.framework}
                  </Badge>
                )}
                <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
                  Regenerate
                </Button>
                <Button size="sm" onClick={commit} disabled={committing || committed}>
                  {committing ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitCommit className="mr-2 h-3.5 w-3.5" />
                  )}
                  {committed ? "Committed" : "Commit to PR"}
                </Button>
              </div>
            </div>
            <Input value={filePath} onChange={(e) => setFilePath(e.target.value)} className="font-mono text-xs" />
            <Textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
          </div>

          {/* Test cases */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Test cases ({cases.length})
              </label>
              <Button
                size="sm"
                onClick={push}
                disabled={pushing || selectedCount === 0 || !canPushToPlm}
                title={canPushToPlm ? undefined : "This work item isn't linked to a PLM story"}
              >
                {pushing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                Push {selectedCount > 0 ? selectedCount : ""} to PLM
              </Button>
            </div>
            {!canPushToPlm && (
              <p className="text-xs text-muted-foreground">
                This work item isn't linked to a Jira/ADO story, so cases can't be pushed. The script can still be committed.
              </p>
            )}
            <div className="space-y-2">
              {cases.map((c, i) => (
                <div key={i} className="flex items-start gap-3 rounded-md border border-border p-3">
                  <Checkbox
                    checked={c.selected}
                    onCheckedChange={(v) => setCases((prev) => prev.map((r, idx) => (idx === i ? { ...r, selected: v === true } : r)))}
                    className="mt-1"
                    disabled={!canPushToPlm}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.title}</p>
                    <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {c.given && <div><span className="font-semibold">Given</span> {c.given}</div>}
                      {c.when && <div><span className="font-semibold">When</span> {c.when}</div>}
                      {c.then && <div><span className="font-semibold">Then</span> {c.then}</div>}
                    </dl>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
