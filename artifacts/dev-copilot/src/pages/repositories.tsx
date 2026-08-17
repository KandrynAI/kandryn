import { useListRepositories, useCreateRepository, getListRepositoriesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Database, Search, Github, Box, Server, Layout as LayoutIcon, FileCode, Beaker, Package } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { SiGithub } from "react-icons/si";
import { Cloud } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  provider: z.enum(["github", "azure-repos"]),
  url: z.string().url("Must be a valid URL"),
  defaultBranch: z.string().min(1, "Default branch is required"),
  stackProfile: z.object({
    frontend: z.enum(["react", "angular", "vue", "none"]),
    backend: z.enum(["nodejs", "dotnet", "java-spring", "python"]),
    database: z.enum(["postgresql", "sqlserver", "oracle", "mysql"]),
    language: z.enum(["typescript", "javascript", "csharp", "java", "python"]),
    testFramework: z.enum(["jest", "jasmine", "xunit", "junit", "pytest", "none"]),
    packageManager: z.enum(["npm", "yarn", "maven", "gradle", "nuget", "pip"])
  })
});

export default function Repositories() {
  // Scoped to the current project when opened at /p/:projectId/repositories (0020).
  const params = useParams<{ projectId?: string }>();
  const projectId = params.projectId ? Number(params.projectId) : null;
  const { data: repositories, isLoading } = useListRepositories(
    projectId != null ? { projectId } : undefined,
  );
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const filteredRepos = repositories?.filter(repo => 
    repo.name.toLowerCase().includes(search.toLowerCase()) || 
    repo.provider.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col gap-4 px-5 py-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Repositories</h1>
          <p className="text-muted-foreground mt-1 text-xs">Connected codebases and stack profiles</p>
        </div>
        {projectId != null ? (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-repo" className="font-mono text-xs">
                <Plus className="mr-2 h-4 w-4" />
                Connect Repository
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] border-primary/20 bg-background/95 backdrop-blur-xl">
              <DialogHeader>
                <DialogTitle className="font-mono text-lg">Connect Repository</DialogTitle>
              </DialogHeader>
              <CreateRepoForm projectId={projectId} onSuccess={() => setIsCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        ) : (
          <p className="text-muted-foreground text-xs">Open a project to connect a repository.</p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-search-repos"
            placeholder="Search repositories..."
            className="pl-9 font-mono text-sm bg-background border-muted"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 border rounded-md bg-card">
        {isLoading ? (
          <div className="p-4 space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !filteredRepos || filteredRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
            <Database className="h-12 w-12 opacity-20" />
            <p className="font-mono text-sm">No repositories found</p>
            {search && (
              <Button variant="link" onClick={() => setSearch("")} className="font-mono text-xs">
                Clear Search
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 divide-y">
            {filteredRepos.map((repo) => (
              <Link key={repo.id} href={`/repositories/${repo.id}`} className="block hover:bg-muted/50 transition-colors">
                <div className="p-4 flex items-start gap-4">
                  <div className="mt-1 p-2 bg-primary/10 rounded-md text-primary">
                    {repo.provider === 'github' ? <SiGithub className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-base font-bold truncate text-foreground">{repo.name}</h3>
                      <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {format(new Date(repo.createdAt), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate font-mono mt-1">{repo.url}</p>
                    
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StackBadge icon={LayoutIcon} value={repo.stackProfile.frontend} />
                      <StackBadge icon={Server} value={repo.stackProfile.backend} />
                      <StackBadge icon={Database} value={repo.stackProfile.database} />
                      <StackBadge icon={FileCode} value={repo.stackProfile.language} />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StackBadge({ icon: Icon, value }: { icon: any, value: string }) {
  if (value === 'none') return null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-md text-xs font-mono text-muted-foreground border border-border/50 shadow-sm">
      <Icon className="h-3 w-3" />
      <span>{value}</span>
    </div>
  );
}

function CreateRepoForm({ projectId, onSuccess }: { projectId: number; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createRepository = useCreateRepository();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      provider: "github",
      url: "",
      defaultBranch: "main",
      stackProfile: {
        frontend: "react",
        backend: "nodejs",
        database: "postgresql",
        language: "typescript",
        testFramework: "jest",
        packageManager: "npm"
      }
    }
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createRepository.mutate({ data: { ...values, projectId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRepositoriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRepositoriesQueryKey({ projectId }) });
        toast({ title: "Repository connected", description: "The repository has been successfully registered." });
        onSuccess();
      },
      onError: (error) => {
        // Surface the server's validation message (e.g. URL not found, owner ===
        // repo). The generated client's ApiError message embeds the server detail.
        toast({
          title: "Couldn't connect repository",
          description: error instanceof Error ? error.message : "Failed to connect repository.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="col-span-2 md:col-span-1">
                <FormLabel className="font-mono text-xs text-muted-foreground">Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. core-api" {...field} className="font-mono bg-muted/50" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="provider"
            render={({ field }) => (
              <FormItem className="col-span-2 md:col-span-1">
                <FormLabel className="font-mono text-xs text-muted-foreground">Provider</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="font-mono bg-muted/50">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="azure-repos">Azure Repos</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="url"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel className="font-mono text-xs text-muted-foreground">Repository URL</FormLabel>
                <FormControl>
                  <Input placeholder="https://github.com/org/repo" {...field} className="font-mono bg-muted/50" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="defaultBranch"
            render={({ field }) => (
              <FormItem className="col-span-2 md:col-span-1">
                <FormLabel className="font-mono text-xs text-muted-foreground">Default Branch</FormLabel>
                <FormControl>
                  <Input placeholder="main" {...field} className="font-mono bg-muted/50" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="border-t pt-4 space-y-4">
          <h4 className="font-mono text-sm font-bold text-primary">Stack Profile</h4>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="stackProfile.frontend"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs text-muted-foreground">Frontend</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono text-xs h-8 bg-muted/50"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="react">React</SelectItem>
                      <SelectItem value="angular">Angular</SelectItem>
                      <SelectItem value="vue">Vue</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="stackProfile.backend"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs text-muted-foreground">Backend</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono text-xs h-8 bg-muted/50"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="nodejs">Node.js</SelectItem>
                      <SelectItem value="dotnet">.NET</SelectItem>
                      <SelectItem value="java-spring">Java Spring</SelectItem>
                      <SelectItem value="python">Python</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stackProfile.database"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs text-muted-foreground">Database</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono text-xs h-8 bg-muted/50"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="postgresql">PostgreSQL</SelectItem>
                      <SelectItem value="sqlserver">SQL Server</SelectItem>
                      <SelectItem value="mysql">MySQL</SelectItem>
                      <SelectItem value="oracle">Oracle</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stackProfile.language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs text-muted-foreground">Language</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono text-xs h-8 bg-muted/50"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="typescript">TypeScript</SelectItem>
                      <SelectItem value="javascript">JavaScript</SelectItem>
                      <SelectItem value="csharp">C#</SelectItem>
                      <SelectItem value="java">Java</SelectItem>
                      <SelectItem value="python">Python</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stackProfile.testFramework"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs text-muted-foreground">Tests</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono text-xs h-8 bg-muted/50"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="jest">Jest</SelectItem>
                      <SelectItem value="jasmine">Jasmine</SelectItem>
                      <SelectItem value="xunit">xUnit</SelectItem>
                      <SelectItem value="junit">JUnit</SelectItem>
                      <SelectItem value="pytest">PyTest</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stackProfile.packageManager"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs text-muted-foreground">Package Mgr</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono text-xs h-8 bg-muted/50"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="npm">npm</SelectItem>
                      <SelectItem value="yarn">yarn</SelectItem>
                      <SelectItem value="maven">maven</SelectItem>
                      <SelectItem value="gradle">gradle</SelectItem>
                      <SelectItem value="nuget">nuget</SelectItem>
                      <SelectItem value="pip">pip</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onSuccess} className="font-mono text-xs">Cancel</Button>
          <Button type="submit" disabled={createRepository.isPending} className="font-mono text-xs">
            {createRepository.isPending ? "Connecting..." : "Connect Repository"}
          </Button>
        </div>
      </form>
    </Form>
  );
}