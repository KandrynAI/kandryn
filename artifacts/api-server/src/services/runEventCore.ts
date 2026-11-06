/**
 * The live run timeline's pure half (0044): validation, the per-type data
 * allowlist, and the summary templates.
 *
 * No database, no clock, no logger — so the rules that keep the timeline
 * content-free can be tested exhaustively without standing anything up. The
 * db-backed emitter is `runEvents.ts`.
 *
 * TWO RULES, ENFORCED HERE
 *
 * 1. `data` is filtered to an allowlist PER EVENT TYPE, and every surviving
 *    value is coerced to a declared KIND. Unknown keys are dropped silently —
 *    an emit site cannot widen what an event carries by passing more.
 * 2. `summary` is BUILT from a template over those coerced values. It is never
 *    assembled from caller-supplied text, so no work item title, document
 *    passage, diff, prompt or model sentence can reach it.
 *
 * Why kinds rather than "string, truncated": several fields look like metadata
 * and are a hair away from being model prose. `stage.failed.reason` would
 * happily accept `err.message`; `gate.result.reason` would accept a sentence.
 * Declaring them `code` means anything that is not a lowercase identifier is
 * dropped rather than shortened, so prose cannot arrive in a field at all.
 * The leak vectors this closes are listed in
 * docs/investigations/live-run-timeline.md §8.2.
 */

import {
  RUN_EVENT_AGENTS,
  RUN_EVENT_STATUSES,
  RUN_EVENT_TYPES,
  RUN_EVENT_ARRAY_MAX,
  RUN_EVENT_DATA_MAX_BYTES,
  RUN_EVENT_STRING_MAX,
  RUN_EVENT_SUMMARY_MAX,
  RUNBOOK_SECTIONS,
  type RunEventAgent,
  type RunEventStatus,
  type RunEventType,
  type RunStage,
  type RunbookSectionCode,
} from "../../../../shared/types/runEvent.js";

// ---------------------------------------------------------------------------
// Field kinds
// ---------------------------------------------------------------------------

type FieldKind = "num" | "bool" | "code" | "token" | "path" | "url" | "refs";

/** A lowercase identifier: our own enum values and nothing else. */
const CODE_RE = /^[a-z0-9_.:-]{1,40}$/;
/**
 * An identifier that may carry case, slashes, colons or a leading `#`: a model
 * id, an OWASP category, a tracker key, a `#<id>`, a `<sourceId>:<chunkId>`.
 * No spaces, which is what keeps a sentence out.
 */
const TOKEN_RE = /^[A-Za-z0-9._:/#-]{1,64}$/;

function coerce(kind: FieldKind, value: unknown): unknown | undefined {
  switch (kind) {
    case "num": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (!Number.isFinite(n)) return undefined;
      // Rounded to 3dp so a float score does not arrive as 0.8300000000000001,
      // and clamped so a nonsense value cannot bloat the row.
      return Math.max(-1e9, Math.min(1e9, Math.round(n * 1000) / 1000));
    }
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "code":
      return typeof value === "string" && CODE_RE.test(value) ? value : undefined;
    case "token":
      return typeof value === "string" && TOKEN_RE.test(value) ? value : undefined;
    case "path": {
      if (typeof value !== "string" || value.length === 0) return undefined;
      // A path must contain no whitespace. That is the whole guard, and it is
      // the second hole the structural leak test found: `path` is interpolated
      // into the summary, so accepting free text here put a work item title one
      // emit site away from the feed. A sentence always has spaces; a path
      // essentially never does. The cost is a repository with spaces in a
      // filename, whose event still fires and whose summary reads "a file"
      // instead of naming it. Worth it.
      if (/\s/.test(value)) return undefined;
      // Long paths are legitimate. Clip from the LEFT: the tail is the
      // informative end.
      return value.length <= RUN_EVENT_STRING_MAX
        ? value
        : `…${value.slice(value.length - (RUN_EVENT_STRING_MAX - 1))}`;
    }
    case "url":
      return typeof value === "string" && /^https:\/\/\S{1,190}$/.test(value) ? value : undefined;
    case "refs": {
      if (!Array.isArray(value)) return undefined;
      // Each ref must be identifier-shaped and is DROPPED otherwise, never
      // truncated. Truncating was the first version, and the structural leak
      // test caught it: 64 characters of a document passage is still 64
      // characters of a document passage. Every ref 0040 and 0041 produce is a
      // tracker key, a `#<id>` or a `<sourceId>:<chunkId>`, so nothing
      // legitimate is lost.
      const out = value
        .filter((v): v is string => typeof v === "string" && TOKEN_RE.test(v))
        .slice(0, RUN_EVENT_ARRAY_MAX);
      return out.length > 0 ? out : undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

/**
 * Which keys each event type may carry, and as what. Adding a key here is the
 * only way to widen an event, which is the point: a reviewer sees the whole
 * surface of what the timeline can hold in one screen.
 */
export const DATA_ALLOWLIST: Record<RunEventType, Readonly<Record<string, FieldKind>>> = {
  "run.started": { trigger: "code", triggerContext: "code", autoCommit: "bool" },
  "run.completed": {
    suggestions: "num",
    topScore: "num",
    committed: "bool",
    prUrl: "url",
    commitHash: "token",
  },
  "run.failed": { reason: "code", stage: "code", agentsAttempted: "num", agentsFailed: "num" },
  "stage.started": { stage: "code", model: "token" },
  "stage.completed": { stage: "code", model: "token" },
  "stage.failed": { stage: "code", reason: "code" },
  "context.read": {
    kind: "code",
    included: "num",
    available: "num",
    truncated: "bool",
    refs: "refs",
    retrievalMode: "code",
    revision: "num",
  },
  "plan.step": { index: "num", total: "num", op: "code", path: "path" },
  "file.write": {
    path: "path",
    action: "code",
    linesAdded: "num",
    linesRemoved: "num",
    applyStatus: "code",
  },
  "check.result": {
    check: "code",
    path: "path",
    category: "token",
    outcome: "code",
    findings: "num",
    critical: "num",
    high: "num",
    medium: "num",
    low: "num",
  },
  "score.dimension": { dimension: "token", value: "num", weight: "num" },
  "runbook.section": { section: "code", index: "num" },
  "gate.result": { gate: "code", outcome: "code", blocking: "num", reason: "code" },
};

/**
 * Filter and coerce. Unknown keys are dropped; a key whose value fails its
 * kind is dropped rather than mangled. If the result still exceeds the byte
 * ceiling (only reachable via `refs`), entries are shed from the end until it
 * fits, so a pathological payload degrades instead of failing the insert.
 */
export function sanitizeData(type: RunEventType, raw: unknown): Record<string, unknown> {
  const allow = DATA_ALLOWLIST[type];
  if (!allow || typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(allow)) {
    const v = coerce(kind, (raw as Record<string, unknown>)[key]);
    if (v !== undefined) out[key] = v;
  }

  let keys = Object.keys(out);
  while (keys.length > 0 && Buffer.byteLength(JSON.stringify(out), "utf8") > RUN_EVENT_DATA_MAX_BYTES) {
    delete out[keys[keys.length - 1]];
    keys = Object.keys(out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const STAGE_LABEL: Record<RunStage, string> = {
  context: "Context",
  plan: "Planning",
  generate: "Generation",
  coherence: "Coherence check",
  rank: "Ranking",
  commit: "Commit",
  review: "Review",
  security: "Security scan",
  runbook: "Runbook",
};

const CONTEXT_LABEL: Record<string, string> = {
  work_item: "work item",
  parent: "parent item",
  document: "document passage",
  repo_graph: "repository graph",
  stack_profile: "stack profile",
  ui_style: "UI style profile",
};

const FAILURE_LABEL: Record<string, string> = {
  no_agent_output: "no agent produced a suggestion",
  no_applicable_suggestion: "no suggestion could be applied",
  stale_branch: "the branch moved under the change",
  no_repository: "no repository is connected",
  repo_unconfigured: "the repository needs reconfiguration",
  work_item_missing: "the work item was not found",
  git_auth: "the git credential was rejected",
  unknown: "see the run error for detail",
};

const SECTION_LABEL: Record<RunbookSectionCode, string> = {
  summary: "Summary",
  what_changed: "What changed",
  deployment: "Deployment steps",
  rollback: "Rollback procedure",
  validation: "Validation",
  test_cases: "Test cases",
  security_notes: "Security notes",
  references: "References",
  other: "an unrecognised section",
};

/** `12.4s` / `840ms`. */
function durationLabel(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 100) / 10}s` : `${Math.round(ms)}ms`;
}

const stageLabel = (code: unknown): string =>
  typeof code === "string" && code in STAGE_LABEL ? STAGE_LABEL[code as RunStage] : "Stage";

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Narratia section codes
// ---------------------------------------------------------------------------

/**
 * Map one of Narratia's `## ` headings to a code.
 *
 * The heading is model output (narratiaService.ts:131), so it is matched, never
 * passed through. An unrecognised heading becomes `other`, which is itself
 * worth seeing: it means the model drifted off the template.
 */
export function runbookSectionCode(heading: unknown): RunbookSectionCode {
  if (typeof heading !== "string") return "other";
  const key = heading.toLowerCase().replace(/[^a-z]/g, "");
  const map: Record<string, RunbookSectionCode> = {
    summary: "summary",
    whatchanged: "what_changed",
    deploymentsteps: "deployment",
    deployment: "deployment",
    rollbackprocedure: "rollback",
    rollback: "rollback",
    validation: "validation",
    testcases: "test_cases",
    securitynotes: "security_notes",
    references: "references",
  };
  return map[key] ?? "other";
}

/**
 * `suggestions.agent` → the timeline's agent name. Mirrors the app's
 * AGENT_DISPLAY (src/lib/agents.ts), where the two mock agents stand in for
 * the two real ones. Anything unrecognised is attributed to `system` rather
 * than guessed.
 */
export function timelineAgent(agent: string): RunEventAgent {
  switch (agent) {
    case "claude":
    case "antigravity":
      return "raptia";
    case "openai":
    case "copilot":
      return "fovea";
    default:
      return RUN_EVENT_AGENTS.includes(agent as RunEventAgent) ? (agent as RunEventAgent) : "system";
  }
}

// ---------------------------------------------------------------------------
// Summary templates
// ---------------------------------------------------------------------------

function template(type: RunEventType, d: Record<string, unknown>, durationMs: number | null): string {
  const n = (k: string): number | null => (typeof d[k] === "number" ? (d[k] as number) : null);
  const s = (k: string): string | null => (typeof d[k] === "string" ? (d[k] as string) : null);
  const took = durationMs != null ? ` in ${durationLabel(durationMs)}` : "";

  switch (type) {
    case "run.started": {
      const how = s("triggerContext") === "remediation" ? "remediation" : (s("trigger") ?? "manual");
      return `Run started (${how})`;
    }
    case "run.completed": {
      const parts = ["Run succeeded"];
      const count = n("suggestions");
      if (count != null) parts.push(plural(count, "suggestion"));
      const top = n("topScore");
      if (top != null) parts.push(`top score ${top}`);
      if (d.committed === true) parts.push("committed");
      return parts.join(" · ") + took;
    }
    case "run.failed": {
      const why = FAILURE_LABEL[s("reason") ?? "unknown"] ?? FAILURE_LABEL.unknown;
      const at = d.stage != null ? ` at ${stageLabel(d.stage).toLowerCase()}` : "";
      return `Run failed${at}: ${why}`;
    }
    case "stage.started":
      return `${stageLabel(d.stage)} started`;
    case "stage.completed":
      return `${stageLabel(d.stage)} completed${took}`;
    case "stage.failed": {
      const why = s("reason");
      return `${stageLabel(d.stage)} failed${why ? ` (${why})` : ""}${took}`;
    }
    case "context.read": {
      const what = CONTEXT_LABEL[s("kind") ?? ""] ?? "context";
      const included = n("included");
      const available = n("available");
      if (included == null) return `Read the ${what}`;
      const of = available != null && available > included ? ` of ${available}` : "";
      return `Read ${plural(included, what)}${of}`;
    }
    case "plan.step": {
      const i = n("index");
      const total = n("total");
      const where = s("path") ? `: ${s("path")}` : "";
      const op = s("op");
      const label = i != null && total != null ? `Plan step ${i} of ${total}` : "Plan step";
      return `${label}${op ? ` (${op})` : ""}${where}`;
    }
    case "file.write": {
      const action = s("action");
      const verb = action === "create" ? "Created" : action === "delete" ? "Deleted" : "Modified";
      const added = n("linesAdded");
      const removed = n("linesRemoved");
      const diff = added != null || removed != null ? ` (+${added ?? 0} -${removed ?? 0})` : "";
      return `${verb} ${s("path") ?? "a file"}${diff}`;
    }
    case "check.result": {
      const which = s("check");
      const who = which === "aegis" ? "Aegis" : which === "veria" ? "Veria" : "Coherence";
      const where = s("path") ? ` ${s("path")}` : "";
      const counts = (["critical", "high", "medium", "low"] as const)
        .map((k) => [k, n(k)] as const)
        .filter(([, v]) => v != null && v > 0)
        .map(([k, v]) => `${v} ${k}`);
      if (counts.length > 0) return `${who}${where}: ${counts.join(", ")}`;
      const findings = n("findings");
      if (findings != null) return `${who}${where}: ${plural(findings, "finding")}`;
      return `${who}${where}: ${s("outcome") ?? "checked"}`;
    }
    case "score.dimension": {
      const v = n("value");
      return `${s("dimension") ?? "Dimension"} ${v != null ? v : "scored"}`;
    }
    case "runbook.section": {
      const code = (s("section") ?? "other") as RunbookSectionCode;
      return `Runbook section: ${SECTION_LABEL[code] ?? SECTION_LABEL.other}`;
    }
    case "gate.result": {
      const gate = s("gate");
      const which = gate === "security" ? "Security gate" : gate === "confidence" ? "Confidence gate" : "Coherence gate";
      const outcome = s("outcome") ?? "reported";
      const blocking = n("blocking");
      const why = blocking != null && blocking > 0 ? ` (${plural(blocking, "blocking finding")})` : "";
      return `${which} ${outcome}${why}`;
    }
  }
}

/** Default status for a type, when an emit site does not state one. */
function defaultStatus(type: RunEventType): RunEventStatus {
  if (type.endsWith(".failed")) return "failed";
  if (type.endsWith(".started")) return "started";
  if (type === "plan.step" || type === "context.read" || type === "runbook.section") return "info";
  return "ok";
}

// ---------------------------------------------------------------------------
// prepareEvent
// ---------------------------------------------------------------------------

export interface EmitInput {
  agent: RunEventAgent;
  type: RunEventType;
  status?: RunEventStatus;
  data?: unknown;
  durationMs?: number | null;
}

export interface PreparedEvent {
  agent: RunEventAgent;
  type: RunEventType;
  status: RunEventStatus;
  summary: string;
  data: Record<string, unknown>;
  durationMs: number | null;
}

/**
 * Validate, filter, template. Returns null for an event that cannot be stored
 * — an unknown type, agent or status — so a bad emit site drops its event
 * rather than failing an insert the run is waiting on.
 */
export function prepareEvent(input: EmitInput): PreparedEvent | null {
  if (!RUN_EVENT_TYPES.includes(input.type)) return null;
  if (!RUN_EVENT_AGENTS.includes(input.agent)) return null;
  const status = input.status ?? defaultStatus(input.type);
  if (!RUN_EVENT_STATUSES.includes(status)) return null;

  const data = sanitizeData(input.type, input.data);
  const durationMs =
    typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs >= 0
      ? Math.round(input.durationMs)
      : null;

  const summary = template(input.type, data, durationMs).slice(0, RUN_EVENT_SUMMARY_MAX);
  return { agent: input.agent, type: input.type, status, summary, data, durationMs };
}
