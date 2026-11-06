import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ORDER,
  agentLabel,
  cursorOf,
  elapsedMs,
  formatClock,
  formatDuration,
  groupEvents,
  groupSummary,
  isMonoType,
  isTerminalStatus,
  isWaitingStatus,
  mergeEvents,
  POLL_ACTIVE_MS,
  POLL_HIDDEN_MS,
  pollIntervalMs,
  shouldPoll,
  startsCollapsed,
  statusGlyph,
  statusTone,
} from "./runTimeline.ts";
import type { RunEvent } from "../services/api.ts";

/**
 * The timeline's display logic. This is where the ordering, the merge and the
 * grouping get proved, because the component that renders them cannot be
 * tested (the runner strips types but does not compile JSX).
 */

let clock = 0;
/** An event at a monotonically increasing wall-clock time, 1s apart. */
const ev = (
  seq: number,
  agent: string,
  type: string,
  opts: { status?: string; summary?: string; durationMs?: number | null; data?: Record<string, unknown> } = {},
): RunEvent =>
  ({
    id: seq,
    seq,
    agent,
    type,
    status: opts.status ?? (type.endsWith(".started") ? "started" : type.endsWith(".failed") ? "failed" : "ok"),
    summary: opts.summary ?? `${type} ${seq}`,
    data: opts.data ?? {},
    createdAt: new Date(Date.UTC(2026, 10, 6, 12, 0, (clock += 1))).toISOString(),
    durationMs: opts.durationMs ?? null,
  }) as unknown as RunEvent;

/** The sequence a successful two-agent run produces, abbreviated. */
function successfulRun(): RunEvent[] {
  clock = 0;
  return [
    ev(1, "system", "run.started", { summary: "Run started (manual)" }),
    ev(2, "system", "stage.started", { summary: "Context started" }),
    ev(3, "system", "context.read", { status: "info", summary: "Read 2 parent items" }),
    ev(4, "system", "stage.completed", { summary: "Context completed in 1.2s", durationMs: 1200 }),
    ev(5, "system", "stage.started", { summary: "Planning started" }),
    ev(6, "system", "plan.step", { status: "info", summary: "Plan step 1 of 2 (create): src/policy.ts" }),
    ev(7, "system", "stage.completed", { summary: "Planning completed in 4.1s", durationMs: 4100 }),
    ev(8, "raptia", "stage.started", { summary: "Generation started" }),
    ev(9, "fovea", "stage.started", { summary: "Generation started" }),
    ev(10, "raptia", "file.write", { summary: "Created src/policy.ts (+12 -0)" }),
    ev(11, "raptia", "stage.completed", { summary: "Generation completed in 18.4s", durationMs: 18400 }),
    ev(12, "fovea", "stage.completed", { summary: "Generation completed in 21.9s", durationMs: 21900 }),
    ev(13, "synthesia", "stage.started", { summary: "Ranking started" }),
    ev(14, "raptia", "score.dimension", { summary: "correctness 85" }),
    ev(15, "synthesia", "stage.completed", { summary: "Ranking completed in 7.3s", durationMs: 7300 }),
    ev(16, "system", "run.completed", { summary: "Run succeeded · 2 suggestions", durationMs: 56200 }),
  ];
}

// ---------------------------------------------------------------------------
// Merging and the cursor
// ---------------------------------------------------------------------------

test("mergeEvents appends in seq order", () => {
  const a = [ev(1, "system", "run.started"), ev(2, "system", "stage.started")];
  clock = 0;
  const b = [ev(3, "raptia", "stage.started")];
  assert.deepEqual(mergeEvents(a, b).map((e) => e.seq), [1, 2, 3]);
});

test("mergeEvents de-duplicates an overlapping page — the reconnect case", () => {
  const first = [ev(1, "system", "run.started"), ev(2, "system", "stage.started"), ev(3, "system", "context.read")];
  // A reconnect replays from a cursor the client is sure about, so seq 2 and 3
  // arrive twice.
  clock = 1;
  const replay = [ev(2, "system", "stage.started"), ev(3, "system", "context.read"), ev(4, "system", "stage.completed")];
  const merged = mergeEvents(first, replay);
  assert.deepEqual(merged.map((e) => e.seq), [1, 2, 3, 4], "no duplicates");
  assert.equal(new Set(merged.map((e) => e.seq)).size, merged.length);
});

test("mergeEvents sorts an out-of-order page", () => {
  const merged = mergeEvents([], [ev(3, "a", "x"), ev(1, "a", "y"), ev(2, "a", "z")]);
  assert.deepEqual(merged.map((e) => e.seq), [1, 2, 3]);
});

test("mergeEvents on an empty page returns the same array, not a copy", () => {
  const existing = [ev(1, "system", "run.started")];
  assert.equal(mergeEvents(existing, []), existing, "an empty poll must not re-render");
});

test("cursorOf is the highest seq held, and 0 when empty", () => {
  assert.equal(cursorOf([]), 0);
  assert.equal(cursorOf([ev(4, "a", "x"), ev(9, "a", "y"), ev(7, "a", "z")]), 9);
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test("groupEvents groups consecutively by agent and splits a second stint", () => {
  const groups = groupEvents(successfulRun(), "succeeded");
  assert.deepEqual(
    groups.map((g) => g.key),
    [
      "system#1", // run.started + context
      "system#2", // planning
      "raptia#1", // generation start
      "fovea#1",
      "raptia#2", // the file.write + completion that follow Fovea's start
      "fovea#2",
      "synthesia#1",
      "raptia#3", // the score dimension, attributed to the suggestion's agent
      "synthesia#2",
      "system#3", // run.completed
    ],
    "an agent that works twice gets two groups, not one spanning the run",
  );
});

test("a group's duration sums its outcome events, or stays null", () => {
  const groups = groupEvents(successfulRun(), "succeeded");
  const byKey = new Map(groups.map((g) => [g.key, g]));
  assert.equal(byKey.get("system#1")!.durationMs, 1200);
  assert.equal(byKey.get("system#2")!.durationMs, 4100);
  assert.equal(byKey.get("raptia#1")!.durationMs, null, "a start with no outcome has no duration");
  assert.equal(byKey.get("raptia#2")!.durationMs, 18400);
});

test("a group's state is its worst outcome, and running until one arrives", () => {
  clock = 0;
  const groups = groupEvents(
    [
      ev(1, "raptia", "stage.started"),
      ev(2, "raptia", "file.write", { status: "warn" }),
      ev(3, "raptia", "stage.failed", { durationMs: 900 }),
      ev(4, "fovea", "stage.started"),
      ev(5, "fovea", "file.write", { status: "warn" }),
      ev(6, "fovea", "stage.completed", { durationMs: 100 }),
      ev(7, "veria", "stage.started"),
    ],
    "running",
  );
  assert.equal(groups[0].state, "failed");
  assert.equal(groups[1].state, "warn", "a warn row without a failure is a warn group");
  assert.equal(groups[2].state, "running");
});

test("the current group is the last open one while the run is active", () => {
  clock = 0;
  const groups = groupEvents(
    [
      ev(1, "system", "run.started"),
      ev(2, "system", "stage.completed", { durationMs: 10 }),
      ev(3, "raptia", "stage.started"),
    ],
    "running",
  );
  assert.deepEqual(groups.map((g) => g.current), [false, true]);
});

test("a terminal run has no current group", () => {
  for (const status of ["succeeded", "failed", "canceled"]) {
    const groups = groupEvents(successfulRun(), status);
    assert.ok(groups.every((g) => !g.current), `${status} should highlight nothing`);
  }
});

test("a parked or held run has no current group either — nothing is happening", () => {
  for (const status of ["awaiting_review", "held"]) {
    clock = 0;
    const groups = groupEvents([ev(1, "system", "run.started"), ev(2, "system", "gate.result", { status: "warn" })], status);
    assert.ok(groups.every((g) => !g.current), status);
  }
});

test("groupEvents tolerates an empty timeline", () => {
  assert.deepEqual(groupEvents([], "running"), []);
});

// ---------------------------------------------------------------------------
// Collapse
// ---------------------------------------------------------------------------

test("finished clean groups start collapsed; the current one and anything amber stay open", () => {
  clock = 0;
  const groups = groupEvents(
    [
      ev(1, "system", "run.started"),
      ev(2, "system", "stage.completed", { durationMs: 10 }),
      ev(3, "fovea", "stage.started"),
      ev(4, "fovea", "stage.failed", { durationMs: 20 }),
      ev(5, "raptia", "stage.started"),
    ],
    "running",
  );
  assert.equal(startsCollapsed(groups[0]), true, "a finished clean group collapses");
  assert.equal(startsCollapsed(groups[1]), false, "a failed group stays open");
  assert.equal(startsCollapsed(groups[2]), false, "the current group stays open");
});

test("groupSummary prefers the outcome, falls back to the opener", () => {
  clock = 0;
  const groups = groupEvents(
    [
      ev(1, "system", "stage.started", { summary: "Context started" }),
      ev(2, "system", "stage.completed", { summary: "Context completed in 1.2s", durationMs: 1200 }),
      ev(3, "raptia", "stage.started", { summary: "Generation started" }),
    ],
    "running",
  );
  assert.equal(groupSummary(groups[0]), "Context completed in 1.2s");
  assert.equal(groupSummary(groups[1]), "Generation started");
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

test("a finished run replays from stored events with no polling and nothing highlighted", () => {
  const events = successfulRun();
  assert.equal(pollIntervalMs("succeeded", false), null);
  const groups = groupEvents(events, "succeeded");
  assert.ok(groups.length > 0);
  assert.ok(groups.every((g) => !g.current));
  // Every group that closed cleanly collapses, so a replay opens as a summary.
  const closedClean = groups.filter((g) => g.endedAt !== null && g.state === "ok");
  assert.ok(closedClean.length > 0 && closedClean.every(startsCollapsed));
});

// ---------------------------------------------------------------------------
// Polling cadence
// ---------------------------------------------------------------------------

test("polling runs at 1.5s, backs off when hidden, and stops at a terminal state", () => {
  assert.equal(pollIntervalMs("running", false), POLL_ACTIVE_MS);
  assert.equal(pollIntervalMs("running", true), POLL_HIDDEN_MS);
  assert.equal(pollIntervalMs("queued", false), POLL_ACTIVE_MS);
  assert.equal(pollIntervalMs(null, false), POLL_ACTIVE_MS, "unknown yet: keep asking");
  for (const status of ["succeeded", "failed", "canceled", "awaiting_review", "held"]) {
    assert.equal(pollIntervalMs(status, false), null, status);
  }
  assert.ok(POLL_ACTIVE_MS <= 2000, "the acceptance criterion is about 2 seconds");
});

test("the status predicates agree with each other", () => {
  assert.ok(isTerminalStatus("failed") && !shouldPoll("failed"));
  assert.ok(isWaitingStatus("awaiting_review") && !shouldPoll("awaiting_review"));
  assert.ok(!isTerminalStatus("awaiting_review"), "parked is not terminal — it can still resume");
  assert.ok(shouldPoll("running"));
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

test("formatDuration reads naturally at every scale", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(840), "840ms");
  assert.equal(formatDuration(1200), "1.2s");
  assert.equal(formatDuration(18400), "18.4s");
  assert.equal(formatDuration(60000), "1m");
  assert.equal(formatDuration(72000), "1m 12s");
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(-1), null);
  assert.equal(formatDuration(NaN), null);
});

test("formatClock survives a bad timestamp", () => {
  assert.equal(formatClock("not a date"), "");
  assert.ok(formatClock(new Date().toISOString()).length > 0);
});

test("elapsedMs never goes negative and refuses a bad start", () => {
  const start = new Date(Date.UTC(2026, 10, 6, 12, 0, 0)).toISOString();
  assert.equal(elapsedMs(start, Date.UTC(2026, 10, 6, 12, 0, 5)), 5000);
  assert.equal(elapsedMs(start, Date.UTC(2026, 10, 6, 11, 59, 0)), 0, "a clock skew reads as 0, not negative");
  assert.equal(elapsedMs("nonsense", Date.now()), null);
});

test("status tone is amber for both warn and failed, and there is no red", () => {
  assert.equal(statusTone("warn"), "attention");
  assert.equal(statusTone("failed"), "attention");
  assert.equal(statusTone("ok"), "ok");
  assert.equal(statusTone("info"), "muted");
  assert.equal(statusTone("started"), "muted");
});

test("every status has a glyph, so a row reads without colour", () => {
  for (const status of ["started", "ok", "info", "warn", "failed"]) {
    assert.ok(statusGlyph(status).length > 0, status);
  }
  assert.equal(statusGlyph("something-new"), "-", "an unknown status still renders");
});

test("paths and ids are the monospace types", () => {
  assert.ok(isMonoType("file.write"));
  assert.ok(isMonoType("plan.step"));
  assert.ok(!isMonoType("run.started"));
});

test("every agent the server can emit has a label", () => {
  for (const agent of AGENT_ORDER) {
    assert.ok(agentLabel(agent).length > 0, agent);
    assert.notEqual(agentLabel(agent), agent === "system" ? "system" : "", agent);
  }
  assert.equal(agentLabel("brand-new-agent"), "brand-new-agent", "an unknown agent renders its own name");
});
