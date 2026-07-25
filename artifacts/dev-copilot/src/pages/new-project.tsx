import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { ArrowLeft, ArrowRight, Check, GitBranch, Boxes, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import {
  fetchPlmProjects,
  fetchRepositories,
  createProject,
  ApiError,
  type PlmProvider,
  type PlmProjectRef,
  type Repository,
} from "@/services/api";

type Step = 1 | 2 | 3;

const PROVIDERS: { id: PlmProvider; label: string }[] = [
  { id: "jira", label: "Jira" },
  { id: "azure-devops", label: "Azure DevOps" },
];

export default function NewProject() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<PlmProvider | null>(null);
  const [plmKey, setPlmKey] = useState<string | null>(null);
  const [repositoryId, setRepositoryId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 px-5 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">New project</h1>
        <p className="text-muted-foreground mt-1 text-xs">
          Bind one PLM project and one repository. Blue Mantis keeps them in sync.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium ${
                step > n
                  ? "border-primary bg-primary/15 text-primary"
                  : step === n
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted text-muted-foreground"
              }`}
            >
              {step > n ? <Check className="h-3.5 w-3.5" /> : n}
            </div>
            <span className={`text-xs ${step >= n ? "text-foreground" : "text-muted-foreground"}`}>
              {n === 1 ? "Name" : n === 2 ? "PLM project" : "Repository"}
            </span>
            {n < 3 && <div className="h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>

      <Card className="flex flex-1 flex-col gap-4 p-6">
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium" htmlFor="proj-name">
              Project name
            </label>
            <Input
              id="proj-name"
              autoFocus
              placeholder="e.g. Payments platform"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
            />
            <p className="text-muted-foreground text-xs">A label for this workspace. You can rename it later.</p>
          </div>
        )}

        {step === 2 && (
          <PlmStep
            provider={provider}
            plmKey={plmKey}
            onProvider={(p) => {
              setProvider(p);
              setPlmKey(null);
            }}
            onPick={(k) => setPlmKey(k)}
          />
        )}

        {step === 3 && <RepoStep repositoryId={repositoryId} onPick={setRepositoryId} />}
      </Card>

      {/* Nav buttons */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => (step === 1 ? navigate("/dashboard") : setStep((s) => (s - 1) as Step))}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {step === 1 ? "Cancel" : "Back"}
        </Button>

        {step < 3 ? (
          <Button
            disabled={(step === 1 && !name.trim()) || (step === 2 && (!provider || !plmKey))}
            onClick={() => setStep((s) => (s + 1) as Step)}
          >
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            disabled={submitting || !repositoryId || !provider || !plmKey}
            onClick={async () => {
              if (!provider || !plmKey || !repositoryId) return;
              setSubmitting(true);
              try {
                const project = await createProject({
                  name: name.trim(),
                  plmProvider: provider,
                  plmProjectKey: plmKey,
                  repositoryId,
                });
                toast({ title: "Project created", description: `${project.name} is ready.` });
                navigate(`/p/${project.id}/board`);
              } catch (err) {
                // A 409 means this PLM project is already bound to a project.
                // Show the friendly message and, if we know it, a shortcut there.
                const existingId =
                  err instanceof ApiError && err.status === 409
                    ? (err.body as { existingProjectId?: number } | undefined)?.existingProjectId
                    : undefined;
                toast({
                  title: err instanceof ApiError && err.status === 409 ? "Already connected" : "Could not create project",
                  description: err instanceof ApiError ? err.message : "Something went wrong.",
                  variant: "destructive",
                  action: existingId ? (
                    <ToastAction altText="Open the existing project" onClick={() => navigate(`/p/${existingId}/board`)}>
                      Open project
                    </ToastAction>
                  ) : undefined,
                });
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Creating…" : "Create project"}
            <Check className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function PlmStep({
  provider,
  plmKey,
  onProvider,
  onPick,
}: {
  provider: PlmProvider | null;
  plmKey: string | null;
  onProvider: (p: PlmProvider) => void;
  onPick: (key: string) => void;
}) {
  const [projects, setProjects] = useState<PlmProjectRef[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);

  useEffect(() => {
    if (!provider) return;
    setLoading(true);
    setError(null);
    setNotConnected(false);
    setProjects(null);
    fetchPlmProjects(provider)
      .then(setProjects)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 424) setNotConnected(true);
        setError(err instanceof ApiError ? err.message : "Could not load projects.");
      })
      .finally(() => setLoading(false));
  }, [provider]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 text-sm font-medium">PLM provider</div>
        <div className="flex gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => onProvider(p.id)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                provider === p.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {provider && (
        <div>
          <div className="mb-2 text-sm font-medium">Project</div>
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}
          {notConnected && (
            <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
              <p className="text-muted-foreground">
                {provider === "jira" ? "Jira" : "Azure DevOps"} is not connected.
              </p>
              <Link href="/settings">
                <Button variant="outline" size="sm" className="mt-3">
                  Connect in Integrations
                  <ExternalLink className="ml-2 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          )}
          {!loading && !notConnected && error && <p className="text-destructive text-sm">{error}</p>}
          {!loading && projects && projects.length === 0 && (
            <p className="text-muted-foreground text-sm">No projects visible with your credentials.</p>
          )}
          {!loading && projects && projects.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.key}
                  onClick={() => onPick(p.key)}
                  className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    plmKey === p.key ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
                  }`}
                >
                  <Boxes className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RepoStep({
  repositoryId,
  onPick,
}: {
  repositoryId: number | null;
  onPick: (id: number) => void;
}) {
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRepositories()
      .then(setRepos)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">Repository</div>
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {!loading && repos && repos.length === 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
          <p className="text-muted-foreground">No repositories connected yet.</p>
          <Link href="/repositories">
            <Button variant="outline" size="sm" className="mt-3">
              Connect a repository
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      )}
      {!loading && repos && repos.length > 0 && (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {repos.map((r) => (
            <button
              key={r.id}
              onClick={() => onPick(r.id)}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                repositoryId === r.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
              }`}
            >
              {r.provider === "github" ? (
                <GitBranch className="h-4 w-4 text-muted-foreground" />
              ) : (
                <GitBranch className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="flex-1">{r.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{r.provider}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
