import { useGetTask, useUpdateTask, useDeleteTask, useListRepositories, getGetTaskQueryKey, getListTasksQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Edit, Trash2, ArrowLeft, Clock, GitBranch, CheckSquare, AlignLeft, Zap, Link2, X } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TaskSourceIcon, TaskStatusBadge } from "./tasks";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  acceptanceCriteria: z.string().nullable().optional(),
  status: z.enum(["open", "in-progress", "review", "done", "blocked"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  type: z.enum(["feature", "bug", "chore", "story"]),
  linkedCommit: z.string().nullable().optional(),
  repositoryId: z.coerce.number().nullable().optional().or(z.literal("none")).transform(val => val === "none" || val === 0 ? null : val)
});

export default function TaskDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: task, isLoading } = useGetTask(id, { query: { enabled: !!id, queryKey: getGetTaskQueryKey(id) } });
  const { data: repos } = useListRepositories();
  
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isLinkingRepo, setIsLinkingRepo] = useState(false);
  const [pendingRepoId, setPendingRepoId] = useState<string>("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values: {
      title: task?.title || "",
      description: task?.description || "",
      acceptanceCriteria: task?.acceptanceCriteria || "",
      status: (task?.status as any) || "open",
      priority: (task?.priority as any) || "medium",
      type: (task?.type as any) || "feature",
      linkedCommit: task?.linkedCommit || "",
      repositoryId: task?.repositoryId || null
    }
  });

  const handleLinkRepo = () => {
    if (!pendingRepoId || pendingRepoId === "none") return;
    updateTask.mutate({ id, data: { repositoryId: parseInt(pendingRepoId) } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        setIsLinkingRepo(false);
        setPendingRepoId("");
        toast({ title: "Repository linked" });
      },
      onError: () => toast({ title: "Failed to link repository", variant: "destructive" }),
    });
  };

  const onEdit = (values: z.infer<typeof formSchema>) => {
    updateTask.mutate({ id, data: values }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        setIsEditOpen(false);
        toast({ title: "Task updated" });
      }
    });
  };

  const onDelete = () => {
    deleteTask.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({ title: "Task deleted" });
        setLocation("/tasks");
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

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <CheckSquare className="h-12 w-12 opacity-20 mb-4" />
        <h2 className="text-xl font-bold mb-2">Task Not Found</h2>
        <Button variant="link" onClick={() => setLocation("/tasks")}>Back to Tasks</Button>
      </div>
    );
  }

  const getRepoName = (repoId?: number | null) => {
    if (!repoId) return null;
    return repos?.find(r => r.id === repoId)?.name || `Repo #${repoId}`;
  };

  return (
    <div className="flex flex-col gap-4 px-5 py-4 animate-in fade-in duration-500 pb-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/tasks")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono font-bold text-muted-foreground px-2 py-1 bg-muted rounded-md tracking-wider">
              {task.externalId || `TASK-${task.id}`}
            </span>
            <TaskStatusBadge status={task.status} />
            <Badge variant="outline" className="font-mono uppercase text-xs">{task.type}</Badge>
          </div>
          <h1 className="text-lg font-semibold tracking-tight mt-2">{task.title}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="font-mono text-xs bg-primary hover:bg-primary/90"
            onClick={() => setLocation(`/workspace/${task.id}`)}
          >
            <Zap className="mr-2 h-4 w-4" /> Generate Code
          </Button>

          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="font-mono text-xs">
                <Edit className="mr-2 h-4 w-4" /> Edit
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl border-primary/20 bg-background/95 backdrop-blur-xl h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-mono">Edit Task</DialogTitle></DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onEdit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Title</FormLabel>
                        <FormControl><Input {...field} className="font-mono bg-muted/50" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs text-muted-foreground">Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="font-mono text-xs bg-muted/50"><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in-progress">In Progress</SelectItem>
                              <SelectItem value="review">Review</SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                              <SelectItem value="blocked">Blocked</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="priority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs text-muted-foreground">Priority</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="font-mono text-xs bg-muted/50"><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="critical">Critical</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs text-muted-foreground">Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="font-mono text-xs bg-muted/50"><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="feature">Feature</SelectItem>
                              <SelectItem value="bug">Bug</SelectItem>
                              <SelectItem value="chore">Chore</SelectItem>
                              <SelectItem value="story">Story</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="repositoryId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs text-muted-foreground">Repository</FormLabel>
                          <Select 
                            onValueChange={(val) => field.onChange(val === "none" ? null : parseInt(val))} 
                            defaultValue={field.value?.toString() || "none"}
                          >
                            <FormControl>
                              <SelectTrigger className="font-mono text-xs bg-muted/50"><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {repos?.map(r => (
                                <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="linkedCommit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Linked Commit SHA</FormLabel>
                        <FormControl><Input {...field} value={field.value || ""} className="font-mono bg-muted/50" placeholder="e.g. a1b2c3d4" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Description</FormLabel>
                        <FormControl><Textarea {...field} value={field.value || ""} className="min-h-[150px] font-mono text-sm bg-muted/50" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="acceptanceCriteria"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Acceptance Criteria</FormLabel>
                        <FormControl><Textarea {...field} value={field.value || ""} className="min-h-[100px] font-mono text-sm bg-muted/50" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter className="pt-4 mt-4 border-t sticky bottom-0 bg-background/95 p-4 rounded-b-lg">
                    <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} className="font-mono text-xs">Cancel</Button>
                    <Button type="submit" disabled={updateTask.isPending} className="font-mono text-xs">Save Changes</Button>
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
              <DialogHeader><DialogTitle className="font-mono text-destructive">Delete Task</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">Are you sure you want to delete this task? This action cannot be undone.</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDeleteOpen(false)} className="font-mono text-xs">Cancel</Button>
                <Button variant="destructive" onClick={onDelete} disabled={deleteTask.isPending} className="font-mono text-xs">Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!task.repositoryId && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <Zap className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-amber-500">No repository linked</span>
            <span className="text-muted-foreground ml-2">
              Link a repository in the Details panel so Kandryn can scan your codebase and generate targeted code suggestions.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
            onClick={() => setIsLinkingRepo(true)}
          >
            <Link2 className="mr-1.5 h-3 w-3" /> Link repo
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-mono flex items-center gap-2 text-muted-foreground">
                <AlignLeft className="h-4 w-4" /> Description
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {task.description ? (
                <div className="prose dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap font-sans">
                  {task.description}
                </div>
              ) : (
                <p className="text-muted-foreground italic text-sm font-mono">No description provided.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-mono flex items-center gap-2 text-muted-foreground">
                <CheckSquare className="h-4 w-4" /> Acceptance Criteria
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {task.acceptanceCriteria ? (
                <div className="prose dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap font-sans">
                  {task.acceptanceCriteria}
                </div>
              ) : (
                <p className="text-muted-foreground italic text-sm font-mono">No acceptance criteria provided.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-mono text-muted-foreground">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              
              <div className="flex flex-col gap-1 pb-3 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted-foreground font-bold">Priority</span>
                <span className={task.priority === 'high' || task.priority === 'critical' ? 'text-destructive font-mono font-bold uppercase text-sm' : 'font-mono uppercase text-sm'}>
                  {task.priority}
                </span>
              </div>

              <div className="flex flex-col gap-1 pb-3 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted-foreground font-bold">Source</span>
                <div className="flex items-center gap-2 text-sm font-medium capitalize">
                  <TaskSourceIcon source={task.source} /> {task.source.replace('-', ' ')}
                </div>
              </div>

              <div className="flex flex-col gap-1 pb-3 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted-foreground font-bold">Repository</span>
                {task.repositoryId ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <Database className="h-4 w-4" />
                    <span className="truncate">{getRepoName(task.repositoryId)}</span>
                  </div>
                ) : isLinkingRepo ? (
                  <div className="flex flex-col gap-2 mt-1">
                    <Select value={pendingRepoId} onValueChange={setPendingRepoId}>
                      <SelectTrigger className="h-8 text-xs font-mono bg-muted/50">
                        <SelectValue placeholder="Choose a repository…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(repos?.length ?? 0) === 0 ? (
                          <SelectItem value="none" disabled>No repositories configured</SelectItem>
                        ) : (
                          repos?.map(r => (
                            <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs flex-1"
                        disabled={!pendingRepoId || pendingRepoId === "none" || updateTask.isPending}
                        onClick={handleLinkRepo}
                      >
                        <Link2 className="mr-1 h-3 w-3" /> Link
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs px-2"
                        onClick={() => { setIsLinkingRepo(false); setPendingRepoId(""); }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsLinkingRepo(true)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mt-0.5 font-mono group"
                  >
                    <Link2 className="h-3 w-3 group-hover:text-primary" />
                    Link a repository
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1 pb-3 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted-foreground font-bold">Linked Commit</span>
                {task.linkedCommit ? (
                  <div className="flex items-center gap-2 text-sm font-mono bg-muted w-fit px-2 py-1 rounded">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" /> 
                    {task.linkedCommit}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground italic font-mono">No commit attached</span>
                )}
              </div>

              <div className="flex flex-col gap-1 pt-1">
                <span className="text-[10px] font-mono text-muted-foreground font-bold">Timestamps</span>
                <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mt-1">
                  <Clock className="h-3 w-3" /> Created: {format(new Date(task.createdAt), 'MMM d, yyyy HH:mm')}
                </div>
                <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mt-1">
                  <Clock className="h-3 w-3" /> Updated: {format(new Date(task.updatedAt), 'MMM d, yyyy HH:mm')}
                </div>
              </div>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}