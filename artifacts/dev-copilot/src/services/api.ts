import type { StackProfile } from '@/components/dc';

export interface DevCopilotTask {
  id: number;
  externalId: string | null;
  source: string;
  type: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  priority: string;
  status: string;
  linkedCommit: string | null;
  repositoryId: number | null;
  createdAt: string;
  updatedAt: string;
  assignee?: string | null;
}

export interface Repository {
  id: number;
  name: string;
  provider: string;
  url: string;
  defaultBranch: string;
  stackProfile: StackProfile | null;
  createdAt: string;
}

export interface CodeSuggestion {
  agent: 'claude' | 'openai' | 'copilot' | 'antigravity';
  code: string;
  explanation: string;
  filePath: string;
  language: string;
  score?: number;
  recommendation?: string;
}

export class ApiError extends Error {
  status: number;
  /** Parsed JSON error body (e.g. `{ error, existingProjectId }`), when present. */
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let body: unknown;
    try {
      body = await res.json();
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        msg = (body as { error: string }).error;
      }
    } catch { /* ignore */ }
    throw new ApiError(msg, res.status, body);
  }
  return res.json() as Promise<T>;
}

export function fetchTasks(): Promise<DevCopilotTask[]> {
  return request<DevCopilotTask[]>('/api/tasks');
}

export function fetchRepositories(): Promise<Repository[]> {
  return request<Repository[]>('/api/repositories');
}

export function connectRepository(data: {
  name: string;
  provider: string;
  url: string;
  defaultBranch: string;
}): Promise<Repository> {
  return request<Repository>('/api/repositories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function redetectStack(repoId: number): Promise<StackProfile> {
  return request<StackProfile>(`/api/repositories/${repoId}/stack`);
}

export function generateSuggestions(taskId: number, refinementPrompt?: string): Promise<CodeSuggestion[]> {
  return request<CodeSuggestion[]>(`/api/tasks/${taskId}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refinementPrompt ? { refinePrompt: refinementPrompt } : {}),
  });
}

export function commitCode(taskId: number, filePath: string, code: string, commitMessage: string): Promise<{ commitHash: string; prUrl: string }> {
  return request<{ commitHash: string; prUrl: string }>(`/api/tasks/${taskId}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, code, commitMessage }),
  });
}

export function completeTask(taskId: number, commitHash: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/tasks/${taskId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitHash }),
  });
}

/* ---- Projects / PLM hierarchy (Phase 1) ---- */

export type PlmProvider = 'jira' | 'azure-devops';

export interface Project {
  id: number;
  name: string;
  plmProvider: PlmProvider;
  plmProjectKey: string | null;
  plmProjectName: string | null;
  repositoryId: number;
  defaultTarget: 'story' | 'task';
  lastSyncedAt: string | null;
  createdAt: string;
  counts?: { open: number; running: number; review: number };
}

export interface PlmProjectRef {
  key: string;
  name: string;
}

export interface WorkItem {
  id: number;
  externalId: string | null;
  source: string;
  type: string;
  itemType: 'epic' | 'story' | 'task' | 'bug' | 'test_case';
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  priority: string;
  status: string;
  linkedCommit: string | null;
  repositoryId: number | null;
  projectId: number | null;
  parentId: number | null;
  plmUrl: string | null;
  plmStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchProjects(): Promise<Project[]> {
  return request<Project[]>('/api/projects');
}

export function fetchProject(id: number): Promise<Project> {
  return request<Project>(`/api/projects/${id}`);
}

export function createProject(data: {
  name: string;
  plmProvider: PlmProvider;
  plmProjectKey: string;
  repositoryId: number;
}): Promise<Project> {
  return request<Project>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function fetchPlmProjects(provider: PlmProvider): Promise<PlmProjectRef[]> {
  return request<PlmProjectRef[]>(`/api/plm/${provider}/projects`);
}

export function fetchProjectWorkItems(projectId: number): Promise<WorkItem[]> {
  return request<WorkItem[]>(`/api/projects/${projectId}/work-items`);
}

export function backfillProjects(): Promise<{ created: number; attached: number; skipped: number }> {
  return request<{ created: number; attached: number; skipped: number }>('/api/projects/backfill', {
    method: 'POST',
  });
}

export interface SyncSummary {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
}

export function syncProject(projectId: number): Promise<SyncSummary> {
  return request<SyncSummary>(`/api/projects/${projectId}/sync`, { method: 'POST' });
}

/* ---- Runs / scheduling (Phase 3) ---- */

export type RunStatus =
  | 'scheduled'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface Run {
  id: number;
  userId: string;
  projectId: number;
  workItemId: number;
  status: RunStatus;
  trigger: 'manual' | 'scheduled';
  refinePrompt: string | null;
  autoCommit: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  prUrl: string | null;
  commitHash: string | null;
  createdAt: string;
}

export interface RunSuggestion {
  id: number;
  runId: number;
  agent: 'claude' | 'openai' | 'copilot' | 'antigravity';
  code: string;
  explanation: string;
  filePath: string;
  language: string;
  score: number | null;
  recommendation: string | null;
  createdAt: string;
}

export interface RunDetail {
  run: Run;
  suggestions: RunSuggestion[];
}

/**
 * Start a run for a work item. Omit `scheduledAt` to run inline (resolves once
 * the pipeline finishes, returning the completed run + suggestions). Pass an ISO
 * UTC `scheduledAt` to schedule it — the response is a `scheduled` run with no
 * suggestions yet.
 */
export function createRun(
  workItemId: number,
  opts: { refinePrompt?: string; autoCommit?: boolean; scheduledAt?: string } = {},
): Promise<RunDetail | Run> {
  return request<RunDetail | Run>(`/api/work-items/${workItemId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
}

/**
 * Re-run a work item inline. Thin wrapper over `createRun` (which posts to
 * `/api/work-items/:id/runs`) that normalises the `RunDetail | Run` response
 * down to the new run's id.
 */
export async function reRunItem(workItemId: number): Promise<{ id: number }> {
  const res = await createRun(workItemId);
  const id = "run" in res ? res.run.id : res.id;
  return { id };
}

export function fetchRuns(params: { projectId?: number; status?: RunStatus } = {}): Promise<Run[]> {
  const q = new URLSearchParams();
  if (params.projectId != null) q.set('projectId', String(params.projectId));
  if (params.status) q.set('status', params.status);
  const qs = q.toString();
  return request<Run[]>(`/api/runs${qs ? `?${qs}` : ''}`);
}

export function fetchRun(runId: number): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/${runId}`);
}

export function cancelRun(runId: number): Promise<Run> {
  return request<Run>(`/api/runs/${runId}/cancel`, { method: 'POST' });
}

export function commitRunSuggestion(
  runId: number,
  suggestionId: number,
  commitMessage?: string,
): Promise<{ commitHash: string; prUrl: string }> {
  return request<{ commitHash: string; prUrl: string }>(`/api/runs/${runId}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commitMessage ? { suggestionId, commitMessage } : { suggestionId }),
  });
}

/* ---- Two-way work item creation (Phase 4) ---- */

export type CreatableItemType = 'epic' | 'story' | 'task' | 'bug';

export interface CreateWorkItemInput {
  itemType: CreatableItemType;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  parentId?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  pushToPlm?: boolean;
}

export function createWorkItem(projectId: number, input: CreateWorkItemInput): Promise<WorkItem> {
  return request<WorkItem>(`/api/projects/${projectId}/work-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateWorkItem(
  workItemId: number,
  patch: Partial<{
    title: string;
    description: string;
    acceptanceCriteria: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: string;
    itemType: WorkItem['itemType'];
  }>,
): Promise<WorkItem> {
  return request<WorkItem>(`/api/work-items/${workItemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export interface BreakdownChild {
  itemType: 'story' | 'task' | 'bug';
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export function breakdownWorkItem(workItemId: number): Promise<{ parentId: number; children: BreakdownChild[] }> {
  return request<{ parentId: number; children: BreakdownChild[] }>(`/api/work-items/${workItemId}/breakdown`, {
    method: 'POST',
  });
}

/* ---- Test generation & push-back (Phase 5) ---- */

export interface TestCase {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  type: 'happy-path' | 'edge-case' | 'failure';
  given: string;
  when: string;
  then: string;
  assertion: string;
  tags: string[];
  selected?: boolean; // client-side only, not persisted
}

export interface PushedTestCase {
  testCaseId: string;
  plmUrl: string;
  plmKey: string;
}

export interface TestScript {
  filePath: string;
  code: string;
  framework: string;
}

export interface GeneratedTests {
  testCases: TestCase[];
  testScript: TestScript;
}

export function generateTests(workItemId: number): Promise<GeneratedTests> {
  return request<GeneratedTests>(`/api/work-items/${workItemId}/tests/generate`, { method: 'POST' });
}

export function commitTestScript(
  workItemId: number,
  filePath: string,
  code: string,
): Promise<{ commitHash: string; prUrl: string | null }> {
  return request<{ commitHash: string; prUrl: string | null }>(`/api/work-items/${workItemId}/tests/commit-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, code }),
  });
}

export function pushTestCases(
  workItemId: number,
  testCases: TestCase[],
): Promise<{ pushed: PushedTestCase[] }> {
  return request<{ pushed: PushedTestCase[] }>(
    `/api/work-items/${workItemId}/tests/push`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCases }),
    },
  );
}
