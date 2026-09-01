import { useGetRepository, useUpdateRepository, useDeleteRepository, getListRepositoriesQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Edit, Trash2, ArrowLeft, Layout as LayoutIcon, Server, FileCode, Clock, GitBranch, Github, Link as LinkIcon, CheckSquare, ShieldAlert, Copy, X } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { SiGithub } from "react-icons/si";
import { Cloud } from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useActiveProjectFromResource } from "@/context/ActiveProjectContext";
import { fetchRepositoryGraphStatus, uploadRepositoryGraph, rebuildRepositoryGraph, fetchProjectWorkItems, verifyRepository, ApiError } from "@/services/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { BaselineScanPanel } from "@/components/repository/BaselineScanPanel";
import { SECURITY_CHECK_CONTEXT } from "../../../../shared/types/branding";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Enter a valid repository URL"),
  defaultBranch: z.string().min(1, "Default branch is required"),
});

export default function RepositoryDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: repo, isLoading } = useGetRepository(id);
  // Derive the owning project from the repository itself (repositories.project_id
  // is the single owner, 0020) — the same resource-derived active-project
  // mechanism every page uses, replacing the old /p/:projectId URL-prefix patch.
  const projectId = repo?.projectId ?? null;
  useActiveProjectFromResource(projectId);
  const reposHref = projectId != null ? `/p/${projectId}/repositories` : "/repositories";
  // Linked Tasks are scoped to the repository's owning project, not the
  // repository row — a repo shared by two projects otherwise leaks each
  // project's work items into the other (Issue 2).
  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["project", projectId, "work-items"],
    queryFn: () => fetchProjectWorkItems(projectId as number),
    enabled: projectId != null,
  });
  
  const deleteRepo = useDeleteRepository();
  const updateRepo = useUpdateRepository();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values: {
      name: repo?.name || "",
      url: repo?.url || "",
      defaultBranch: repo?.defaultBranch || ""
    }
  });

  const onEdit = (values: z.infer<typeof formSchema>) => {
    updateRepo.mutate({ id, data: values }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRepositoriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: [`/api/repositories/${id}`] });
        setIsEditOpen(false);
        toast({ title: "Repository updated" });
      },
      onError: (err) => {
        // Surface the server's validation message (e.g. URL not found, owner ===
        // repo). The generated client's ApiError message already embeds it.
        toast({
          title: "Update failed",
          description: err instanceof Error ? err.message : "Could not update the repository.",
          variant: "destructive",
        });
      }
    });
  };

  const onDelete = () => {
    deleteRepo.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRepositoriesQueryKey() });
        toast({ title: "Repository deleted" });
        setLocation(reposHref);
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Database className="h-12 w-12 opacity-20 mb-4" />
        <h2 className="text-xl font-bold mb-2">Repository Not Found</h2>
        <Button variant="link" onClick={() => setLocation(reposHref)}>Back to Repositories</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4 animate-in fade-in duration-500 pb-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation(reposHref)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {repo.provider === 'github' ? <SiGithub className="h-5 w-5 text-muted-foreground" /> : <Cloud className="h-5 w-5 text-blue-500" />}
            <h1 className="text-xl font-semibold tracking-tight">{repo.name}</h1>
          </div>
          {repo.url ? (
            <a href={repo.url} target="_blank" rel="noreferrer" className="text-sm font-mono text-primary hover:underline flex items-center gap-1 mt-1 w-fit">
              <LinkIcon className="h-3 w-3" />
              {repo.url}
            </a>
          ) : (
            <span className="text-sm font-mono text-amber-500 flex items-center gap-1 mt-1 w-fit">
              <ShieldAlert className="h-3 w-3" />
              No URL — needs reconfiguration
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="font-mono text-xs">
                <Edit className="mr-2 h-4 w-4" /> Edit
              </Button>
            </DialogTrigger>
            <DialogContent className="border-primary/20 bg-background/95 backdrop-blur-xl">
              <DialogHeader><DialogTitle className="font-mono">Edit Repository</DialogTitle></DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onEdit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Name</FormLabel>
                        <FormControl><Input {...field} className="font-mono" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Repository URL</FormLabel>
                        <FormControl><Input {...field} placeholder="https://github.com/owner/repo" className="font-mono" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="defaultBranch"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Default Branch</FormLabel>
                        <FormControl><Input {...field} className="font-mono" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} className="font-mono text-xs">Cancel</Button>
                    <Button type="submit" disabled={updateRepo.isPending} className="font-mono text-xs">Save</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm" className="font-mono text-xs">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </DialogTrigger>
            <DialogContent className="border-destructive/50 bg-background/95 backdrop-blur-xl">
              <DialogHeader><DialogTitle className="font-mono text-destructive">Delete Repository</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">Are you sure you want to delete this repository? This action cannot be undone.</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDeleteOpen(false)} className="font-mono text-xs">Cancel</Button>
                <Button variant="destructive" onClick={onDelete} disabled={deleteRepo.isPending} className="font-mono text-xs">Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground">Stack Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <StackDetail icon={LayoutIcon} label="Frontend" value={repo.stackProfile.frontend} />
              <StackDetail icon={Server} label="Backend" value={repo.stackProfile.backend} />
              <StackDetail icon={Database} label="Database" value={repo.stackProfile.database} />
              <StackDetail icon={FileCode} label="Language" value={repo.stackProfile.language} />
              <StackDetail icon={CheckSquare} label="Tests" value={repo.stackProfile.testFramework} />
              <StackDetail icon={FileCode} label="Package Mgr" value={repo.stackProfile.packageManager} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-muted-foreground">Default Branch:</span>
              <span className="font-mono font-medium">{repo.defaultBranch}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-muted-foreground">Added:</span>
              <span className="font-mono font-medium">{format(new Date(repo.createdAt), 'MMM d, yyyy')}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {(repo.needsReconfiguration || !repo.url) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">This repository needs reconfiguration</p>
              <p className="text-sm text-muted-foreground mt-1">
                Its URL was cleared because it didn't point at a valid repository. Set a correct
                <code className="font-mono"> https://github.com/owner/repo </code> URL to use it again.
              </p>
            </div>
            <Button size="sm" className="font-mono text-xs shrink-0" onClick={() => setIsEditOpen(true)}>
              <Edit className="mr-2 h-3.5 w-3.5" /> Fix URL
            </Button>
          </CardContent>
        </Card>
      )}

      {repo.needsVerification && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Verify this repository</p>
              <p className="text-sm text-muted-foreground mt-1">
                This binding was created when a repository shared by more than one project was split.
                Its URL, stack profile, and graph index may have been built from another project's
                codebase. Confirm the URL below is correct for this project, or fix it.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="font-mono text-xs shrink-0"
              onClick={async () => {
                try {
                  await verifyRepository(id);
                  queryClient.invalidateQueries({ queryKey: [`/api/repositories/${id}`] });
                  queryClient.invalidateQueries({ queryKey: getListRepositoriesQueryKey() });
                  toast({ title: "Repository verified" });
                } catch (err) {
                  toast({
                    title: "Could not verify",
                    description: err instanceof Error ? err.message : undefined,
                    variant: "destructive",
                  });
                }
              }}
            >
              <CheckSquare className="mr-2 h-3.5 w-3.5" /> Looks right
            </Button>
          </CardContent>
        </Card>
      )}

      {repo.url && <AegisSetupNotice repoId={id} provider={repo.provider} url={repo.url} />}

      <GraphifySection repoId={id} />

      <BaselineScanPanel repoId={id} />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight">Linked Tasks</h2>
          <Button variant="outline" size="sm" asChild className="font-mono text-xs">
            <Link href={`/tasks/new?repositoryId=${repo.id}`}>Create Task</Link>
          </Button>
        </div>

        <div className="border rounded-md bg-card overflow-hidden">
          {tasksLoading ? (
            <div className="p-4 space-y-4"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          ) : !tasks || tasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm font-mono">
              {projectId == null
                ? "Open this repository from a project to see its work items."
                : "No work items in this project."}
            </div>
          ) : (
            <div className="divide-y">
              {tasks.map(task => (
                <Link key={task.id} href={`/tasks/${task.id}`}>
                  <div className="p-4 hover:bg-muted/50 transition-colors flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono font-bold text-muted-foreground">{task.externalId || `TASK-${task.id}`}</span>
                        <h4 className="text-sm font-medium truncate">{task.title}</h4>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="font-mono uppercase text-[10px]">{task.status}</Badge>
                        <span className={task.priority === 'high' || task.priority === 'critical' ? 'text-destructive font-mono font-bold' : 'text-muted-foreground font-mono'}>{task.priority}</span>
                      </div>
                    </div>
                    {task.linkedCommit && (
                      <div className="flex items-center gap-1 text-xs font-mono bg-muted px-2 py-1 rounded text-muted-foreground shrink-0">
                        <GitBranch className="h-3 w-3" />
                        {task.linkedCommit.substring(0, 7)}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AegisSetupNotice({ repoId, provider, url }: { repoId: number; provider: string; url: string }) {
  const { toast } = useToast();
  const key = `bm_aegis_setup_dismissed_${repoId}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });

  if (provider !== "github" || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(key, "1");
    } catch { /* ignore */ }
    setDismissed(true);
  };

  const copyCheckName = async () => {
    try {
      await navigator.clipboard.writeText(SECURITY_CHECK_CONTEXT);
      toast({ title: "Copied", description: SECURITY_CHECK_CONTEXT });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <Card className="border-amber-500/30">
      <CardHeader>
        <CardTitle className="text-sm font-mono text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Security gate setup</span>
          <button onClick={dismiss} title="Dismiss" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground leading-relaxed">
          To enforce the Aegis stop gate, add <code className="font-mono">{SECURITY_CHECK_CONTEXT}</code> as a required status
          check on your main branch in GitHub: Settings → Branches → Branch protection rules → Require status checks.
        </p>
        <div className="mt-3 flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="font-mono text-xs" onClick={copyCheckName}>
            <Copy className="mr-2 h-3.5 w-3.5" /> Copy check name
          </Button>
          <Button variant="outline" size="sm" className="font-mono text-xs" onClick={() => window.open(`${url}/settings/branches`, "_blank")}>
            <LinkIcon className="mr-2 h-3.5 w-3.5" /> Open GitHub branch settings →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GraphifySection({ repoId }: { repoId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["repo", repoId, "graph"],
    queryFn: () => fetchRepositoryGraphStatus(repoId),
    // Poll while a rebuild is in flight so the panel updates itself (and self-
    // corrects after navigating away and back — the state is server-persisted).
    refetchInterval: (q) => (q.state.data?.status === "indexing" ? 3000 : false),
  });

  const graphStatus = status?.status ?? "idle";
  const isIndexing = graphStatus === "indexing";

  // Toast when a rebuild finishes (state transitions out of "indexing").
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const s = status?.status;
    if (prevStatus.current === "indexing" && s && s !== "indexing") {
      if (s === "succeeded") {
        toast({ title: "Graph rebuilt", description: `${status?.nodeCount ?? 0} nodes indexed.` });
      } else if (s === "failed") {
        toast({
          title: "Graph rebuild failed",
          description: status?.error ?? "The Graphify service reported an error.",
          variant: "destructive",
        });
      }
    }
    prevStatus.current = s;
  }, [status?.status, status?.nodeCount, status?.error, toast]);

  const onRebuild = async () => {
    setRebuilding(true);
    try {
      const res = await rebuildRepositoryGraph(repoId);
      toast({ title: "Rebuild started", description: res.message });
      // Pick up the "indexing" state immediately; the poll takes over from there.
      qc.invalidateQueries({ queryKey: ["repo", repoId, "graph"] });
    } catch (err) {
      const notConfigured = err instanceof ApiError && err.status === 503;
      toast({
        title: notConfigured ? "Automatic rebuild unavailable" : "Rebuild failed",
        description:
          err instanceof ApiError ? err.message : "Could not start the rebuild.",
        variant: "destructive",
      });
    } finally {
      setRebuilding(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const graph = JSON.parse(await file.text());
      const res = await uploadRepositoryGraph(repoId, graph);
      toast({ title: res.message });
      qc.invalidateQueries({ queryKey: ["repo", repoId, "graph"] });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof ApiError ? err.message : "Could not parse graph.json.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const built = status?.built ?? false;
  const stale = status?.stale ?? false;
  const dot = isLoading
    ? "#9ba3ac"
    : isIndexing
      ? "#3b82f6"
      : graphStatus === "failed"
        ? "#dc2626"
        : graphStatus === "stale"
          ? "#d4821a"
          : !built
            ? "#9ba3ac"
            : stale
              ? "#d4821a"
              : "#1a7f4b";
  const statusText = isLoading
    ? "Checking…"
    : isIndexing
      ? "Indexing… this can take a minute"
      : graphStatus === "failed"
        ? `Rebuild failed${status?.error ? ` — ${status.error}` : ""}`
        : graphStatus === "stale"
          ? "Stale — repository URL changed; retrieval is tree-only until a rebuild completes"
          : !built
            ? "Not loaded"
            : `Loaded — ${status?.nodeCount ?? 0} nodes${status?.builtAt ? `, built ${formatDistanceToNow(new Date(status.builtAt))} ago` : ""}${stale ? " · Rebuild recommended" : ""}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono text-muted-foreground">Graphify context</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "inline-block", flexShrink: 0 }} />
          <span>{statusText}</span>
        </div>

        {!built && !isLoading && !isIndexing && graphStatus !== "failed" && (
          <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 4, padding: "14px 16px", marginTop: 10 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-ink-4)", marginBottom: 8, fontWeight: 600 }}>Graph context</div>
            <p style={{ fontSize: 13, color: "var(--c-ink-2)", lineHeight: 1.6 }}>
              Kandryn uses a Graphify knowledge graph to send Raptia and Fovea precise file context instead of guessing
              from keywords. This reduces tokens per run by up to 5×.
            </p>
            <ol style={{ fontSize: 13, color: "var(--c-ink-2)", marginTop: 10, paddingLeft: 18, lineHeight: 1.8 }}>
              <li>Install Graphify: <code style={{ fontFamily: "var(--mono)" }}>uv tool install graphifyy</code></li>
              <li>In Claude Code on your repository: <code style={{ fontFamily: "var(--mono)" }}>/graphify . --code-only --no-viz</code></li>
              <li>Upload the result:</li>
            </ol>
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={onFile} />
          <Button variant="outline" size="sm" className="font-mono text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : built ? "Re-upload graph.json" : "Upload graph.json"}
          </Button>
          <Button variant="outline" size="sm" className="font-mono text-xs" disabled={rebuilding || isIndexing} onClick={onRebuild}>
            {rebuilding || isIndexing ? "Indexing…" : "Rebuild graph"}
          </Button>
        </div>
        {built && (
          <p style={{ fontSize: 12, color: "var(--c-ink-4)", marginTop: 8, lineHeight: 1.5 }}>
            Rebuild re-indexes from the latest default branch via the Graphify service. The graph also
            re-indexes automatically after Kandryn commits code.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StackDetail({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <div className="flex flex-col gap-1 p-3 border rounded-md bg-muted/20">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-mono font-bold">{label}</span>
      </div>
      <span className="text-sm font-medium capitalize">{value}</span>
    </div>
  );
}