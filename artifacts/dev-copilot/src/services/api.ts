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
  url: string | null;
  defaultBranch: string;
  projectId: number | null;
  needsReconfiguration: boolean;
  needsVerification: boolean;
  stackProfile: StackProfile | null;
  createdAt: string;
}

export interface DiffLine {
  type: 'add' | 'del' | 'context';
  oldNumber: number | null;
  newNumber: number | null;
  content: string;
  intraline?: Array<[number, number]>;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface SuggestionFile {
  seq: number;
  op: 'create' | 'edit' | 'delete';
  filePath: string;
  content: string;
  /** Structured, server-computed diff (Phase 1 PR2). Null for a failed/deleted file. */
  diff?: DiffHunk[] | null;
  hunks?: Array<{ search: string; replace: string }> | null;
  sourceBlobSha?: string | null;
  resolved: boolean;
  applyStatus: 'pending' | 'applied' | 'failed';
  applyError?: string | null;
  /** Why this file falls outside the change plan (Phase 2). Null for a planned file. */
  deviationReason?: string | null;
  linesAdded: number;
  linesRemoved: number;
}

export interface SuggestionStats {
  filesChanged: number;
  added: number;
  removed: number;
}

export interface CodeSuggestion {
  agent: 'claude' | 'openai' | 'copilot' | 'antigravity';
  /** The suggestion's change set. Phase 0: always exactly one file. */
  files: SuggestionFile[];
  valid: boolean;
  stats: SuggestionStats;
  explanation: string;
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
  // 'stale' is set when the repo URL changed after the build — the graph is kept
  // but retrieval refuses it (tree-only) until a rebuild succeeds.
  status: 'idle' | 'indexing' | 'succeeded' | 'failed' | 'stale';
  error: string | null;
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

export function fetchRepositories(projectId?: number): Promise<Repository[]> {
  const q = projectId != null ? `?projectId=${projectId}` : '';
  return request<Repository[]>(`/api/repositories${q}`);
}

export function connectRepository(data: {
  name: string;
  provider: string;
  url: string;
  defaultBranch: string;
  projectId: number;
}): Promise<Repository> {
  return request<Repository>('/api/repositories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// Clear a repository's needs_verification flag once the user confirms a
// migration-cloned repo points at the right codebase (0020).
export function verifyRepository(id: number): Promise<Repository> {
  return request<Repository>(`/api/repositories/${id}/verify`, { method: 'POST' });
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
  /** @deprecated (0020) — resolve a project's repo via GET /repositories?projectId. */
  repositoryId: number | null;
  defaultTarget: 'story' | 'task';
  /** Confidence gate threshold (Phase 4), 0–1. numeric → arrives as a string. */
  confidenceThreshold: string;
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

export function updateProject(
  id: number,
  data: { name?: string; repositoryId?: number; confidenceThreshold?: number },
): Promise<Project> {
  return request<Project>(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: number): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
}

export function createProject(data: {
  name: string;
  plmProvider: PlmProvider;
  plmProjectKey: string;
  repositoryId?: number;
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
  // Parked by the confidence gate (Phase 4) — awaits a human decision.
  | 'awaiting_review'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface Run {
  id: number;
  userId: string;
  projectId: number;
  workItemId: number;
  /** Repository this run targets, snapshotted at creation (0020). */
  repositoryId: number | null;
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
  issueType?: 'bug' | 'subtask',
): Promise<RemediateResponse> {
  return request<RemediateResponse>(`/api/runs/${runId}/security/remediate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findingId, action, issueType }),
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
  /** The changed file this finding is in (assigned from the scanned file). */
  filePath?: string;
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
  /** Per-file coverage (fail-closed gate). Optional for legacy single-file scans. */
  scannedFiles?: string[];
  unscannedFiles?: string[];
  filesTotal?: number;
  filesScanned?: number;
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
  /** The changed file this finding concerns, when file-specific. */
  filePath?: string;
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
  minimalDiff: ScoreDimension; // reframed as plan-relative "diff proportionality" (Phase 3)
  conventions: ScoreDimension;
  acCoverage: ScoreDimension;
  // Static cross-file coherence (Phase 3), injected mechanically. Optional for
  // older runs / single-file changes.
  coherence?: ScoreDimension;
  // Behaviour signals (weight 0 — informational). Optional for older runs.
  ambiguityHandling?: ScoreDimension;
  surgicalPrecision?: ScoreDimension;
  overallNarrative: string;
  recommendation: 'Recommended' | 'Alternative';
  confidence: number;
  confidenceReason: string;
}

/** A cross-file coherence finding (Phase 3), mirrors shared/types/coherence.ts. */
export interface CoherenceFinding {
  check: 'interface_impl' | 'type_resolution' | 'caller_callee' | 'imports';
  severity: 'error' | 'warning';
  filePath: string;
  line?: number;
  message: string;
  relatedFilePath?: string;
}

export type CoherenceStatus = 'passed' | 'warnings' | 'failed';

export interface RunSuggestion {
  id: number;
  runId: number;
  agent: 'claude' | 'openai' | 'copilot' | 'antigravity';
  /** The change set (0022). Phase 0: one file. */
  files: SuggestionFile[];
  /** @deprecated (0022) — read `files`. Null for suggestions created after 0022. */
  code: string | null;
  explanation: string;
  /** @deprecated (0022) — read `files`. */
  filePath: string | null;
  language: string;
  score: number | null;
  recommendation: string | null;
  scoreBreakdown?: ScoreBreakdown | null;
  scoreNarrative?: string | null;
  // Static coherence check (Phase 3). numeric column → score arrives as a
  // string; null for older runs / single-file / non-C# changes.
  coherenceScore?: string | null;
  coherenceStatus?: CoherenceStatus | null;
  coherenceFindings?: CoherenceFinding[] | null;
  testCases?: TestCase[];
  testScript?: TestScript | null;
  createdAt: string;
}

export interface RunWorkItemSummary {
  externalId: string | null;
  source: string | null;
}

export interface RunPlanFile {
  id: number;
  seq: number;
  op: 'create' | 'edit' | 'delete';
  filePath: string;
  rationale: string;
  symbols: string[] | null;
  addedByUser: boolean;
  addedSource: 'autocomplete' | 'manual' | null;
  inCandidates: boolean | null;
}

/** The change plan for a run (Phase 2). Present once planning has run. */
export interface RunPlan {
  id: number;
  revision: number;
  // 'awaiting_review' (Phase 4): parked by the confidence gate before generation.
  status: 'planning' | 'ready' | 'edited' | 'failed' | 'awaiting_review';
  notes: string | null;
  retrievalMode: 'graph' | 'keyword' | null;
  graphAgeHours: number | null;
  error: string | null;
  files: RunPlanFile[];
  // Confidence gate (Phase 4). Null on plans predating it.
  confidenceScore: number | null;
  confidenceSignals: ConfidenceSignals | null;
  /** One-line, signal-derived reason for the awaiting-review banner. */
  confidenceReason: string | null;
}

/** Raw inputs the confidence score was computed from (Phase 4). */
export interface ConfidenceSignals {
  scoreGap: number | null;
  topScore: number | null;
  secondScore: number | null;
  retrievalMode: 'graph' | 'keyword';
  candidateCount: number;
  countAboveFloor: number;
  floor: number;
  target: number;
  density: number;
  historicalPriorCount: number;
  weights: { gap: number; mode: number; density: number; historical: number };
  perSignal: { gap: number | null; mode: number; density: number; historical: number | null };
  weakestSignal: 'gap' | 'mode' | 'density' | 'historical' | null;
}

/** A file in a plan-revision request (Edit plan). */
export interface RevisionFileInput {
  op: 'create' | 'edit' | 'delete';
  path: string;
  rationale: string;
  symbols?: string[];
  addedByUser?: boolean;
  addedSource?: 'autocomplete' | 'manual';
}

export interface RunDetail {
  run: Run;
  suggestions: RunSuggestion[];
  /** Present on GET /runs/:id; used to gate PLM actions (e.g. test-case push). */
  workItem?: RunWorkItemSummary | null;
  /** The current change plan (Phase 2). Null when the run predates planning. */
  plan?: RunPlan | null;
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

/** Repository path list for plan-edit autocomplete (Phase 2 PR3). */
export function fetchRunTree(runId: number): Promise<{ paths: string[] }> {
  return request<{ paths: string[] }>(`/api/runs/${runId}/tree`);
}

/** Apply plan edits → new revision → background regeneration (Phase 2 PR3). */
export function reviseRunPlan(runId: number, files: RevisionFileInput[]): Promise<{ planId: number; revision: number }> {
  return request<{ planId: number; revision: number }>(`/api/runs/${runId}/plan/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
}

/** Approve a parked (awaiting_review) plan → generate as-is (Phase 4). */
export function approveRunPlan(runId: number): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/runs/${runId}/plan/approve`, { method: 'POST' });
}

/** Reject a parked plan → the run ends canceled, no suggestions (Phase 4). */
export function rejectRunPlan(runId: number): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/runs/${runId}/plan/reject`, { method: 'POST' });
}

/** Trigger the Veria review agent for a committed run. */
export function runReview(runId: number): Promise<{ review: ReviewResult }> {
  return request<{ review: ReviewResult }>(`/api/runs/${runId}/review`, { method: 'POST' });
}

export function commitRunSuggestion(
  runId: number,
  suggestionId: number,
  commitMessage?: string,
  override?: boolean,
): Promise<{ commitHash: string; prUrl: string }> {
  const body: { suggestionId: number; commitMessage?: string; override?: boolean } = { suggestionId };
  if (commitMessage) body.commitMessage = commitMessage;
  if (override) body.override = true;
  return request<{ commitHash: string; prUrl: string }>(`/api/runs/${runId}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

/* ---- Reporting dashboard (Phase 3) ---- */

export interface ChartSeries {
  labels: string[];
  data: (number | null)[];
}

export interface StackedSeries {
  labels: string[];
  datasets: { label: string; data: number[] }[];
}

export interface BacklogSeries {
  labels: string[];
  created: number[];
  completed: number[];
}

export interface ReportData {
  range: { days: number; since: string; until: string };
  scope: 'team' | 'personal';
  kpis: {
    totalRuns: number;
    successRate: number;
    prsOpened: number;
    committedRuns: number;
    avgTimeToPrHours: number | null;
    securityFindings: number;
  };
  charts: {
    runVolumeByWeek: ChartSeries;
    outcomes: ChartSeries;
    timeToPrDaily: ChartSeries;
    agentWinRate: ChartSeries;
    scoreTrend: ChartSeries;
    securityByOwasp: StackedSeries;
    workItemsByType: ChartSeries;
    backlogBurn: BacklogSeries;
  };
}

export function fetchReportSummary(days: number, projectId?: number): Promise<ReportData> {
  const q = new URLSearchParams();
  q.set('days', String(days));
  if (projectId != null) q.set('projectId', String(projectId));
  return request<ReportData>(`/api/reports/summary?${q.toString()}`);
}

/* ---- Audit log (admin only) ---- */

export interface AuditLogItem {
  id: number;
  teamId: number | null;
  userId: string;
  action: string;
  entityType: string | null;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
  hasMore: boolean;
  nextBefore: string | null;
}

export function fetchAuditLog(params: {
  days?: number;
  action?: string;
  userId?: string;
  before?: string;
  limit?: number;
}): Promise<AuditLogResponse> {
  const p = new URLSearchParams();
  if (params.days) p.set('days', String(params.days));
  if (params.action) p.set('action', params.action);
  if (params.userId) p.set('userId', params.userId);
  if (params.before) p.set('before', params.before);
  if (params.limit) p.set('limit', String(params.limit));
  return request<AuditLogResponse>(`/api/audit?${p}`);
}

export function fetchAuditActions(): Promise<{ actions: string[] }> {
  return request<{ actions: string[] }>('/api/audit/actions');
}

export function auditLogCsvUrl(days: number): string {
  return `/api/audit/export.csv?days=${days}`;
}

/* ---- Teams / multi-tenancy (Phase 1) ---- */

export interface TeamInfo {
  id: number;
  name: string;
  slug: string | null;
  ownerUserId: string;
  plan: string;
  createdAt: string;
}

export interface TeamMe {
  team: TeamInfo | null;
  role?: 'admin' | 'member';
  memberCount?: number;
}

export function fetchMyTeam(): Promise<TeamMe> {
  return request<TeamMe>('/api/teams/me');
}

export function bootstrapTeam(name?: string): Promise<{ team: TeamInfo }> {
  return request<{ team: TeamInfo }>('/api/teams/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });
}

export function acceptTeamInvite(token: string): Promise<{ teamId: number; role: string }> {
  return request<{ teamId: number; role: string }>('/api/invites/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function createTeamInvite(
  teamId: number,
  email: string,
  role: 'admin' | 'member',
): Promise<{ invite: { id: number; email: string; role: string } }> {
  return request(`/api/teams/${teamId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
}

export interface TeamMemberRow {
  id: number;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface TeamInviteRow {
  id: number;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
  acceptedAt: string | null;
}

export interface TeamIntegrationRow {
  key: string;
  setBy: string;
  setAt: string;
  masked: string;
  /** Present for non-secret preference keys (e.g. AEGIS_JIRA_ISSUE_TYPE). */
  value?: string | null;
}

export function fetchTeamMembers(teamId: number): Promise<TeamMemberRow[]> {
  return request<TeamMemberRow[]>(`/api/teams/${teamId}/members`);
}

export function fetchInvites(teamId: number): Promise<TeamInviteRow[]> {
  return request<TeamInviteRow[]>(`/api/teams/${teamId}/invites`);
}

export function cancelInvite(teamId: number, inviteId: number): Promise<void> {
  return request(`/api/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE' });
}

export function removeTeamMember(teamId: number, userId: string): Promise<void> {
  return request(`/api/teams/${teamId}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export function updateMemberRole(
  teamId: number,
  userId: string,
  role: 'admin' | 'member',
): Promise<{ userId: string; role: string }> {
  return request(`/api/teams/${teamId}/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

export function fetchTeamIntegrations(teamId: number): Promise<TeamIntegrationRow[]> {
  return request<TeamIntegrationRow[]>(`/api/teams/${teamId}/integrations`);
}

export function setTeamIntegration(
  teamId: number,
  key: string,
  value: string,
): Promise<{ key: string; setAt: string }> {
  return request(`/api/teams/${teamId}/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}
