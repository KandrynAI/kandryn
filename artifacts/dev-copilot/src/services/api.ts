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

export interface RepositoryGraphStatus {
  built: boolean;
  builtAt: string | null;
  nodeCount: number | null;
  stale: boolean;
}

export function fetchRepositoryGraphStatus(repoId: number): Promise<RepositoryGraphStatus> {
  return request<RepositoryGraphStatus>(`/api/repositories/${repoId}/graph`);
}

export function uploadRepositoryGraph(
  repoId: number,
  graph: unknown,
): Promise<{ nodeCount: number; edgeCount: number; message: string }> {
  return request(`/api/repositories/${repoId}/graph`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph }),
  });
}

/**
 * Ask the Graphify microservice to re-index this repo (Phase 3). Resolves 202
 * (indexing started); throws ApiError 503 when no microservice is configured —
 * callers should fall back to prompting a manual graph.json upload.
 */
export function rebuildRepositoryGraph(
  repoId: number,
): Promise<{ status: string; message: string }> {
  return request(`/api/repositories/${repoId}/graph/rebuild`, { method: 'POST' });
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
  committedSuggestionId: number | null;
  usedGraphContext?: boolean;
  stackDesc?: string | null;
  review?: ReviewResult | null;
  reviewStatus?: 'pending' | 'running' | 'done' | 'failed' | null;
  securityScan?: AegisScanResult | null;
  securityScanStatus?: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | null;
  securityGate?: 'approved' | 'blocked' | 'pending' | null;
  runbook?: string | null;
  runbookStatus?: 'pending' | 'running' | 'done' | 'failed' | null;
  runbookTarget?: string | null;
  runbookUrl?: string | null;
  parentRunId?: number | null;
  triggerContext?: string | null;
  createdAt: string;
}

export interface RemediateResponse {
  ticketKey: string;
  ticketUrl: string;
  newRunId: number | null;
  action: 'push' | 'remediate-now';
  message: string;
  alreadyPushed?: boolean;
}

export function remediateAegisFinding(
  runId: number,
  findingId: string,
  action: 'push' | 'remediate-now',
): Promise<RemediateResponse> {
  return request<RemediateResponse>(`/api/runs/${runId}/security/remediate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findingId, action }),
  });
}

export type RunbookTarget = 'markdown' | 'confluence' | 'notion';

export function runNarratia(
  runId: number,
  target: RunbookTarget,
): Promise<{ runbook: string; url: string | null; target: string; sections?: string[] }> {
  return request(`/api/runs/${runId}/runbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  });
}

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface AegisFinding {
  id: string;
  severity: SecuritySeverity;
  owasp: string;
  title: string;
  detail: string;
  lineRef?: string;
  remediation: string;
  cveRef?: string;
  plmTicketUrl?: string;
  plmTicketKey?: string;
  pushedToBoard?: boolean;
  remediationRunId?: number;
  remediationStatus?: 'pending' | 'running' | 'committed' | 'failed';
}

export interface AegisScanResult {
  summary: string;
  findings: AegisFinding[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  gateDecision: 'approved' | 'blocked';
  gateReason: string;
  scannedFile: string;
  generatedAt: string;
}

export function runAegisScan(runId: number): Promise<{ scan: AegisScanResult }> {
  return request<{ scan: AegisScanResult }>(`/api/runs/${runId}/security`, { method: 'POST' });
}

export interface ReviewFinding {
  type: 'strength' | 'gap' | 'risk';
  title: string;
  detail: string;
  acRef?: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface ReviewResult {
  summary: string;
  acCoverage: { covered: string[]; missed: string[]; partial: string[] };
  findings: ReviewFinding[];
  reviewerNote: string;
  generatedAt: string;
}

export interface ScoreDimension {
  score: number;
  weight: number;
  verdict: 'strong' | 'adequate' | 'weak';
  reason: string;
}

export interface ScoreBreakdown {
  correctness: ScoreDimension;
  readability: ScoreDimension;
  minimalDiff: ScoreDimension;
  conventions: ScoreDimension;
  acCoverage: ScoreDimension;
  // Behaviour signals (weight 0 — informational). Optional for older runs.
  ambiguityHandling?: ScoreDimension;
  surgicalPrecision?: ScoreDimension;
  overallNarrative: string;
  recommendation: 'Recommended' | 'Alternative';
  confidence: number;
  confidenceReason: string;
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
  scoreBreakdown?: ScoreBreakdown | null;
  scoreNarrative?: string | null;
  testCases?: TestCase[];
  testScript?: TestScript | null;
  createdAt: string;
}

export interface RunWorkItemSummary {
  externalId: string | null;
  source: string | null;
}

export interface RunDetail {
  run: Run;
  suggestions: RunSuggestion[];
  /** Present on GET /runs/:id; used to gate PLM actions (e.g. test-case push). */
  workItem?: RunWorkItemSummary | null;
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

/** Recent runs for a single work item (server caps this at 10). */
export function fetchRunsForItem(workItemId: number): Promise<Run[]> {
  return request<Run[]>(`/api/runs?workItemId=${workItemId}`);
}

export function fetchRuns(params: { projectId?: number; status?: RunStatus; limit?: number } = {}): Promise<Run[]> {
  const q = new URLSearchParams();
  if (params.projectId != null) q.set('projectId', String(params.projectId));
  if (params.status) q.set('status', params.status);
  if (params.limit != null) q.set('limit', String(params.limit));
  const qs = q.toString();
  return request<Run[]>(`/api/runs${qs ? `?${qs}` : ''}`);
}

export function fetchRun(runId: number): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/${runId}`);
}

export function cancelRun(runId: number): Promise<Run> {
  return request<Run>(`/api/runs/${runId}/cancel`, { method: 'POST' });
}

/** Trigger the Veria review agent for a committed run. */
export function runReview(runId: number): Promise<{ review: ReviewResult }> {
  return request<{ review: ReviewResult }>(`/api/runs/${runId}/review`, { method: 'POST' });
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

/**
 * Promote a local-only work item into the project's PLM (Jira/ADO). Returns the
 * now-linked work item (externalId/source/plmUrl populated). Throws ApiError:
 * 409 if already linked, 424 when the PLM isn't connected, 502 on a PLM API error.
 */
export function pushWorkItemToPlm(workItemId: number): Promise<WorkItem> {
  return request<WorkItem>(`/api/work-items/${workItemId}/push-to-plm`, { method: 'POST' });
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
  // Set once the case has been pushed to the PLM (persisted server-side).
  plmKey?: string;
  plmUrl?: string;
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
