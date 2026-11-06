/**
 * The live run timeline's display logic (0044 PR3).
 *
 * Pure, and in `lib/` rather than inside the component, for the same reason
 * `uiStyleView.ts` and `knowledgeQueue.ts` are: the dev-copilot test runner
 * strips types but does not compile JSX, so a `.tsx` cannot be tested. The
 * merge, the ordering, the grouping and the collapse rules are the parts worth
 * proving, so they live here.
 */

import type { RunEvent } from '@/services/api';

/** The agents, in the order a run uses them. */
export const AGENT_ORDER = [
  'system',
  'raptia',
  'fovea',
  'synthesia',
  'veria',
  'aegis',
  'narratia',
] as const;
export type TimelineAgent = (typeof AGENT_ORDER)[number];

export const AGENT_LABEL: Record<string, string> = {
  system: 'Kandryn',
  raptia: 'Raptia',
  fovea: 'Fovea',
  synthesia: 'Synthesia',
  veria: 'Veria',
  aegis: 'Aegis',
  narratia: 'Narratia',
};

export const agentLabel = (agent: string): string => AGENT_LABEL[agent] ?? agent;

/** Run statuses that mean nothing more will arrive. */
const TERMINAL = ['succeeded', 'failed', 'canceled'] as const;
export const isTerminalStatus = (status: string | null | undefined): boolean =>
  status != null && (TERMINAL as readonly string[]).includes(status);

/**
 * A run that has stopped producing events but is not finished either: it is
 * parked at the confidence gate, or held by the run-order re-check. Polling
 * should stop, but the timeline is not a failure.
 */
export const isWaitingStatus = (status: string | null | undefined): boolean =>
  status === 'awaiting_review' || status === 'held';

export const shouldPoll = (status: string | null | undefined): boolean =>
  !isTerminalStatus(status) && !isWaitingStatus(status);

// ---------------------------------------------------------------------------
// Merging pages
// ---------------------------------------------------------------------------

/**
 * Merge a polled page into what is already on screen.
 *
 * De-duplicates on `seq` and re-sorts, because a reconnect replays from the
 * last cursor the client is *sure* about, which can overlap what it already
 * has. Keeping the incoming copy of a duplicate is deliberate: it is the
 * fresher read of the same row.
 */
export function mergeEvents(existing: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  if (incoming.length === 0) return existing;
  const bySeq = new Map<number, RunEvent>();
  for (const e of existing) bySeq.set(e.seq, e);
  for (const e of incoming) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The cursor to poll with next: the highest seq held, or 0. */
export const cursorOf = (events: RunEvent[]): number =>
  events.length === 0 ? 0 : Math.max(...events.map((e) => e.seq));

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface TimelineGroup {
  /** `${agent}#${ordinal}` — stable across polls, unique when an agent has two stints. */
  key: string;
  agent: string;
  events: RunEvent[];
  /** The group's own clock: the first event's time and the last one's. */
  startedAt: string;
  /** Set once the group has an outcome event. */
  endedAt: string | null;
  /** Summed from the group's completion events. */
  durationMs: number | null;
  /** `running` until an outcome arrives, then its worst outcome. */
  state: 'running' | 'ok' | 'warn' | 'failed';
  /** True for the group a reader should be looking at. */
  current: boolean;
}

/** An event that closes a group. */
const isOutcome = (e: RunEvent): boolean =>
  e.type === 'stage.completed' ||
  e.type === 'stage.failed' ||
  e.type === 'run.completed' ||
  e.type === 'run.failed';

const isOpener = (e: RunEvent): boolean => e.type === 'stage.started' || e.type === 'run.started';

/**
 * Group consecutive events by agent.
 *
 * Consecutive, not collected: Raptia and Fovea interleave, and an agent can
 * work twice in one run (`system` does, either side of generation). Collecting
 * all of an agent's events into one block would put its commit step next to
 * its context step and claim a duration spanning the whole run.
 */
export function groupEvents(events: RunEvent[], runStatus?: string | null): TimelineGroup[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const groups: TimelineGroup[] = [];
  const seen = new Map<string, number>();

  for (const e of ordered) {
    const last = groups[groups.length - 1];
    // A new group when the agent changes, or when the same agent opens a new
    // stage after one already closed.
    const startNew =
      !last || last.agent !== e.agent || (isOpener(e) && last.endedAt !== null);
    if (startNew) {
      const ordinal = (seen.get(e.agent) ?? 0) + 1;
      seen.set(e.agent, ordinal);
      groups.push({
        key: `${e.agent}#${ordinal}`,
        agent: e.agent,
        events: [e],
        startedAt: e.createdAt,
        endedAt: isOutcome(e) ? e.createdAt : null,
        durationMs: isOutcome(e) ? e.durationMs : null,
        state: 'running',
        current: false,
      });
    } else {
      last.events.push(e);
      if (isOutcome(e)) last.endedAt = e.createdAt;
    }
  }

  for (const g of groups) {
    // Summed over the group's outcome events, which is where durations live.
    // Null rather than 0 when none of them carried one, so the UI can say
    // nothing instead of claiming the stage took no time.
    const measured = g.events.filter(isOutcome).map((e) => e.durationMs).filter((d): d is number => d != null);
    g.durationMs = measured.length > 0 ? measured.reduce((a, b) => a + b, 0) : null;
    g.state = groupState(g);
    g.current = false;
  }
  // The current group is the last one still open, or — when every group has
  // closed but the run has not — the last one, because that is where the next
  // event will land. A terminal run has no current group: nothing is happening.
  if (shouldPoll(runStatus) && groups.length > 0) {
    const open = [...groups].reverse().find((g) => g.endedAt === null);
    (open ?? groups[groups.length - 1]).current = true;
  }
  return groups;
}

function groupState(g: TimelineGroup): TimelineGroup['state'] {
  if (g.endedAt === null) return 'running';
  if (g.events.some((e) => e.status === 'failed')) return 'failed';
  if (g.events.some((e) => e.status === 'warn')) return 'warn';
  return 'ok';
}

/**
 * Which groups start collapsed: every finished one, so a reader lands on what
 * is happening rather than scrolling past what already did. A group that failed
 * or warned stays open, because that is the part worth reading.
 */
export const startsCollapsed = (g: TimelineGroup): boolean =>
  g.endedAt !== null && !g.current && g.state === 'ok';

/** The one-line summary a collapsed group shows. */
export function groupSummary(g: TimelineGroup): string {
  const outcome = [...g.events].reverse().find(isOutcome);
  if (outcome) return outcome.summary;
  const opener = g.events.find(isOpener);
  return opener?.summary ?? `${g.events.length} step${g.events.length === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** `4.2s` / `840ms` / `1m 12s`. */
export function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Wall-clock time of day, for the right-hand column. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** How long a still-running group has been going, from a supplied `now`. */
export function elapsedMs(startedAt: string, now: number): number | null {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, now - start);
}

/**
 * The status glyph. Text, not colour, so the row still reads when colour is not
 * available — and amber, never red, for the two that need attention.
 */
export const STATUS_GLYPH: Record<string, string> = {
  started: '>',
  ok: 'o',
  info: '-',
  warn: '!',
  failed: 'x',
};
export const statusGlyph = (status: string): string => STATUS_GLYPH[status] ?? '-';

/** Which token a row's status uses. `warn` and `failed` share amber. */
export function statusTone(status: string): 'muted' | 'ok' | 'attention' {
  if (status === 'warn' || status === 'failed') return 'attention';
  if (status === 'ok') return 'ok';
  return 'muted';
}

/** Paths and ids render monospace; the rest of a summary does not. */
export const MONO_TYPES = new Set(['file.write', 'plan.step', 'check.result']);
export const isMonoType = (type: string): boolean => MONO_TYPES.has(type);

// ---------------------------------------------------------------------------
// Polling cadence
// ---------------------------------------------------------------------------

/** While a run is active and the tab is visible. 1.5s lands inside the 2s target. */
export const POLL_ACTIVE_MS = 1500;
/** Backed off while the tab is hidden: still current on return, far cheaper. */
export const POLL_HIDDEN_MS = 15000;

export function pollIntervalMs(runStatus: string | null | undefined, hidden: boolean): number | null {
  if (!shouldPoll(runStatus)) return null;
  return hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS;
}
