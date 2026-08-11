import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
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

const ACTIVE_PROJECT_KEY = "bluemantis_active_project_id";

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
  const [repoId, setRepoId] = useState<number | null>(null);
  const [savingRepo, setSavingRepo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchProject(projectId)
      .then((p) => {
        setProject(p);
        setName(p.name);
        setRepoId(p.repositoryId);
      })
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
    fetchRepositories().then(setRepos).catch(() => {});
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

  const saveRepo = async () => {
    if (repoId == null || repoId === project?.repositoryId) return;
    setSavingRepo(true);
    try {
      const updated = await updateProject(projectId, { repositoryId: repoId });
      setProject(updated);
      setRepoId(updated.repositoryId);
      toast({ title: "Repository updated" });
    } catch (err) {
      toast({ title: "Could not change repository", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingRepo(false);
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

  const currentRepo = repos.find((r) => r.id === project.repositoryId);

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

      {/* Repository */}
      <section className="mb-8">
        <div className={groupLabel}>Repository</div>
        <div className="flex flex-col gap-4 rounded-md border bg-card p-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-foreground">Connected repository</div>
            <span className="font-mono text-sm text-muted-foreground">
              {currentRepo ? currentRepo.name : `#${project.repositoryId}`}
            </span>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Change repository</label>
            <div className="flex items-center gap-2">
              <select
                value={repoId ?? ""}
                onChange={(e) => setRepoId(Number(e.target.value))}
                className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                className="h-9"
                onClick={saveRepo}
                disabled={savingRepo || repoId == null || repoId === project.repositoryId}
              >
                {savingRepo ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
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
