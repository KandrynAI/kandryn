/**
 * The live run timeline's event contract (migration 0044).
 *
 * Shared between the API server, which emits, and the app, which renders. The
 * two rules that govern everything here:
 *
 *  1. STRUCTURED EVENTS, NOT REASONING. No raw model output, chain of thought
 *     or free-form model text is ever emitted or stored.
 *  2. CONTENT-FREE. Events carry names, paths, counts, ids, categories,
 *     statuses and durations. They never carry the text of a work item, a
 *     document, a diff or a prompt. Same rule the 0040 context manifest
 *     follows, for the same reason: an event must be readable by anyone who
 *     can read the run without widening what they can see.
 *
 * The data shapes below are the contract. Enforcement — which keys survive and
 * how a summary is built — lives in the server's `runEventCore.ts`, because a
 * client that trusted itself to filter would be no filter at all.
 */

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

/**
 * Who the event is attributed to. These are the TIMELINE's agent names, not
 * `suggestions.agent` ('claude' | 'openai' | …) — the mapping between them is
 * `timelineAgent()` in runEventCore.ts. `system` covers the orchestrator's own
 * work: loading the run, resolving the repository, writing the terminal row.
 */
export const RUN_EVENT_AGENTS = [
  "raptia",
  "fovea",
  "synthesia",
  "veria",
  "aegis",
  "narratia",
  "system",
] as const;
export type RunEventAgent = (typeof RUN_EVENT_AGENTS)[number];

export const RUN_EVENT_TYPES = [
  "run.started",
  "run.completed",
  "run.failed",
  "stage.started",
  "stage.completed",
  "stage.failed",
  "context.read",
  "plan.step",
  "file.write",
  "check.result",
  "score.dimension",
  "runbook.section",
  "gate.result",
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export const RUN_EVENT_STATUSES = ["started", "ok", "warn", "failed", "info"] as const;
export type RunEventStatus = (typeof RUN_EVENT_STATUSES)[number];

/**
 * The pipeline stages a `stage.*` event can name. Codes, not prose, so the
 * client can label them and the server never has to template a stage name it
 * was handed.
 */
export const RUN_STAGES = [
  "context",
  "plan",
  "generate",
  "coherence",
  "rank",
  "commit",
  "review",
  "security",
  "runbook",
] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/** What a `context.read` event read. Mirrors the 0040/0041/0042 sources. */
export const CONTEXT_KINDS = [
  "work_item",
  "parent",
  "document",
  "repo_graph",
  "stack_profile",
  "ui_style",
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

/**
 * Why a run failed, as a closed set of codes.
 *
 * Deliberately NOT the message on `runs.error`: that string concatenates
 * `suggestion_files.apply_error`, which embeds the model's own failed search
 * text. The full message stays on the run row, where the error panel already
 * renders it under identical authorization.
 */
export const RUN_FAILURE_REASONS = [
  "no_agent_output",
  "no_applicable_suggestion",
  "stale_branch",
  "no_repository",
  "repo_unconfigured",
  "work_item_missing",
  "git_auth",
  "unknown",
] as const;
export type RunFailureReason = (typeof RUN_FAILURE_REASONS)[number];

/**
 * Narratia's eight sections, as codes.
 *
 * A section "name" is the model's own `## ` heading (narratiaService.ts:131),
 * so it is model-authored text and cannot be passed through. Headings are
 * matched against this list and anything unrecognised becomes `other` — which
 * is itself useful: it says the model drifted off the template.
 */
export const RUNBOOK_SECTIONS = [
  "summary",
  "what_changed",
  "deployment",
  "rollback",
  "validation",
  "test_cases",
  "security_notes",
  "references",
  "other",
] as const;
export type RunbookSectionCode = (typeof RUNBOOK_SECTIONS)[number];

/** Which gate a `gate.result` event reports. */
export const RUN_GATES = ["confidence", "coherence", "security"] as const;
export type RunGate = (typeof RUN_GATES)[number];

// ---------------------------------------------------------------------------
// Per-type data shapes
// ---------------------------------------------------------------------------

export interface RunEventDataMap {
  "run.started": { trigger: string; triggerContext?: string; autoCommit?: boolean };
  "run.completed": {
    suggestions?: number;
    topScore?: number;
    committed?: boolean;
    prUrl?: string;
    commitHash?: string;
  };
  "run.failed": {
    reason: RunFailureReason;
    stage?: RunStage;
    agentsAttempted?: number;
    agentsFailed?: number;
  };
  "stage.started": { stage: RunStage; model?: string };
  "stage.completed": { stage: RunStage; model?: string };
  "stage.failed": { stage: RunStage; reason?: string };
  "context.read": {
    kind: ContextKind;
    included?: number;
    available?: number;
    truncated?: boolean;
    /** Identifiers only: tracker keys, `#<id>`, `<sourceId>:<chunkId>`. */
    refs?: string[];
    retrievalMode?: string;
    revision?: number;
  };
  "plan.step": { index: number; total: number; op: string; path: string };
  "file.write": {
    path: string;
    action: "create" | "modify" | "delete";
    linesAdded?: number;
    linesRemoved?: number;
    applyStatus?: string;
  };
  "check.result": {
    check: "coherence" | "veria" | "aegis";
    path?: string;
    /** An OWASP category id, a coherence finding kind, a Veria finding type. */
    category?: string;
    outcome?: string;
    findings?: number;
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
  };
  "score.dimension": { dimension: string; value: number; weight?: number };
  "runbook.section": { section: RunbookSectionCode; index?: number };
  "gate.result": { gate: RunGate; outcome: string; blocking?: number; reason?: string };
}

/** A timeline event as the API returns it. */
export interface RunEventDTO<T extends RunEventType = RunEventType> {
  id: number;
  seq: number;
  agent: RunEventAgent;
  type: T;
  status: RunEventStatus;
  summary: string;
  data: T extends keyof RunEventDataMap ? Partial<RunEventDataMap[T]> : Record<string, never>;
  createdAt: string;
  durationMs: number | null;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** `summary` is a column cap as well as a template cap. */
export const RUN_EVENT_SUMMARY_MAX = 160;
/** Serialized `data` ceiling, after the allowlist has run. */
export const RUN_EVENT_DATA_MAX_BYTES = 2048;
/** Per-string ceiling inside `data` (a path is the long one). */
export const RUN_EVENT_STRING_MAX = 200;
/** `refs` and any other array in `data`. */
export const RUN_EVENT_ARRAY_MAX = 20;

/**
 * Retention, in one place (the decision this feature was approved under).
 *
 * `null` means the events live exactly as long as their run: `run_events.run_id`
 * is `ON DELETE CASCADE`, so deleting a run takes its timeline with it and
 * nothing else has to run. Set a number of days here to make the timeline
 * shorter-lived than the run, and a purge job becomes necessary — there is
 * deliberately none today.
 */
export const RUN_EVENT_RETENTION_DAYS: number | null = null;
