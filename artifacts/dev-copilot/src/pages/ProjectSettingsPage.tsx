import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  fetchProject,
  updateProject,
  deleteProject,
  fetchRepositories,
  ApiError,
  type Project,
  type Repository,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ACTIVE_PROJECT_KEY } from "@/lib/activeProject";

const groupLabel = "mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export default function ProjectSettingsPage() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [claudePin, setClaudePin] = useState("");
  const [openaiPin, setOpenaiPin] = useState("");
  const [savingModels, setSavingModels] = useState(false);
  const [savingSoD, setSavingSoD] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchProject(projectId)
      .then((p) => {
        setProject(p);
        setName(p.name);
        setThreshold(p.confidenceThreshold);
        setClaudePin(p.pinnedClaudeModel ?? "");
        setOpenaiPin(p.pinnedOpenaiModel ?? "");
      })
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
    // The project's repository, resolved via project_id (0020).
    fetchRepositories(projectId).then(setRepos).catch(() => {});
  }, [projectId]);

  const saveName = async () => {
    if (!name.trim() || name.trim() === project?.name) return;
    setSavingName(true);
    try {
      const updated = await updateProject(projectId, { name: name.trim() });
      setProject(updated);
      setName(updated.name);
      toast({ title: "Project name updated" });
    } catch (err) {
      toast({ title: "Could not update name", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingName(false);
    }
  };

  const saveThreshold = async () => {
    const n = Number(threshold);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      toast({ title: "Enter a value between 0 and 1", variant: "destructive" });
      return;
    }
    setSavingThreshold(true);
    try {
      const updated = await updateProject(projectId, { confidenceThreshold: n });
      setProject(updated);
      setThreshold(updated.confidenceThreshold);
      toast({ title: "Confidence threshold updated" });
    } catch (err) {
      toast({ title: "Could not update threshold", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingThreshold(false);
    }
  };

  const saveSoD = async (value: boolean) => {
    setSavingSoD(true);
    try {
      const updated = await updateProject(projectId, { requireSecondApprover: value });
      setProject(updated);
      toast({ title: value ? "Second approver required" : "Second-approver requirement turned off" });
    } catch (err) {
      toast({ title: "Could not update", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingSoD(false);
    }
  };

  const saveModels = async () => {
    setSavingModels(true);
    try {
      const updated = await updateProject(projectId, {
        pinnedClaudeModel: claudePin.trim() || null,
        pinnedOpenaiModel: openaiPin.trim() || null,
      });
      setProject(updated);
      setClaudePin(updated.pinnedClaudeModel ?? "");
      setOpenaiPin(updated.pinnedOpenaiModel ?? "");
      toast({ title: "Model pinning updated" });
    } catch (err) {
      toast({ title: "Could not update model pinning", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingModels(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteProject(projectId);
      if (localStorage.getItem(ACTIVE_PROJECT_KEY) === String(projectId)) {
        localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
      toast({ title: "Project deleted" });
      navigate("/dashboard");
    } catch (err) {
      toast({ title: "Could not delete project", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-2xl px-6 py-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!project) {
    return <div className="mx-auto max-w-2xl px-6 py-6 text-sm text-destructive">Project not found.</div>;
  }

  const currentRepo = repos[0];

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h1 className="text-lg font-semibold tracking-tight">Project settings</h1>
      <p className="mb-6 mt-1 text-xs text-muted-foreground">{project.name}</p>

      {/* General */}
      <section className="mb-8">
        <div className={groupLabel}>General</div>
        <div className="flex flex-col gap-4 rounded-md border bg-card p-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Project name</label>
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
              <Button
                size="sm"
                className="h-9"
                onClick={saveName}
                disabled={savingName || !name.trim() || name.trim() === project.name}
              >
                {savingName ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <div className="flex gap-10">
            <div>
              <div className="mb-1.5 text-xs font-medium text-foreground">PLM provider</div>
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {project.plmProvider === "jira" ? "Jira" : "Azure DevOps"}
              </span>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-foreground">PLM project key</div>
              <span className="font-mono text-sm text-muted-foreground">{project.plmProjectKey ?? "—"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Confidence gate */}
      <section className="mb-8">
        <div className={groupLabel}>Confidence gate</div>
        <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
          <label className="block text-xs font-medium text-foreground">Confidence threshold</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="h-9 w-28"
            />
            <Button
              size="sm"
              className="h-9"
              onClick={saveThreshold}
              disabled={savingThreshold || threshold === project.confidenceThreshold}
            >
              {savingThreshold ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Before generating code, Kandryn scores its confidence in the change plan (0–1). Plans scoring
            below this value pause for your review instead of generating automatically. Set 0 to never pause,
            1 to always pause. Default 0.6 — an uncalibrated starting point.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <div className={groupLabel}>Segregation of duties</div>
        <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
          <label className="flex items-start gap-2.5" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={project.requireSecondApprover}
              disabled={savingSoD}
              onChange={(e) => saveSoD(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <span className="text-xs font-medium text-foreground">Require a second approver</span>
              <span className="block text-[11px] text-muted-foreground leading-relaxed">
                When a run's plan is paused for confidence review, the person who triggered the run cannot approve it —
                a different team admin must. Rejecting is always allowed. Default off.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="mb-8">
        <div className={groupLabel}>Model pinning</div>
        <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Raptia (Claude) model</label>
            <Input
              value={claudePin}
              onChange={(e) => setClaudePin(e.target.value)}
              placeholder="claude-sonnet-4-5 (default)"
              className="h-9 w-72"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Fovea (OpenAI) model</label>
            <Input
              value={openaiPin}
              onChange={(e) => setOpenaiPin(e.target.value)}
              placeholder="gpt-4o (default)"
              className="h-9 w-72"
            />
          </div>
          <div>
            <Button
              size="sm"
              className="h-9"
              onClick={saveModels}
              disabled={savingModels || (claudePin === (project.pinnedClaudeModel ?? "") && openaiPin === (project.pinnedOpenaiModel ?? ""))}
            >
              {savingModels ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Pin generation to a specific model version per provider, for reproducibility and governance. Leave
            a field blank to use the current default. The exact model that generated each change is recorded on
            the run's explanation report.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <div className={groupLabel}>Governance</div>
        <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            A read-only summary of this project's human-in-the-loop and safety controls — the confidence gate,
            scheduled-run pausing, the security scan gate, and the coherence gate — compiled from current settings.
            Shareable with a security team as a single governance-policy view.
          </p>
          <Link href={`/p/${projectId}/governance`} className="text-xs font-medium text-primary hover:underline">
            View governance policy →
          </Link>
        </div>
      </section>

      {/* Repository */}
      <section className="mb-8">
        <div className={groupLabel}>Repository</div>
        <div className="flex flex-col gap-4 rounded-md border bg-card p-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-foreground">Connected repository</div>
            <span className="font-mono text-sm text-muted-foreground">
              {currentRepo ? currentRepo.name : "None connected"}
            </span>
          </div>
          <Link
            href={`/p/${projectId}/repositories`}
            className="text-xs font-medium text-primary hover:underline w-fit"
          >
            {currentRepo ? "Manage repository →" : "Connect a repository →"}
          </Link>
        </div>
      </section>

      {/* Danger zone */}
      <section>
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--accent-red)" }}>
          Danger zone
        </div>
        <div
          className="flex items-center justify-between gap-4 rounded-md border p-4"
          style={{ borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)" }}
        >
          <div className="text-sm text-muted-foreground">
            Delete this project and all its work items and runs. This does not touch your PLM or repository.
          </div>
          {confirmDelete ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="outline" className="h-9" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" className="h-9" onClick={doDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Confirm delete"}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              Delete project
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
