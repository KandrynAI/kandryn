import { test } from "node:test";
import assert from "node:assert/strict";

// runEvents imports @workspace/db, which throws at load without a DATABASE_URL.
// Every test here injects its own writer, so the pool is never touched and
// node-postgres never connects (the pattern planningService.test.ts uses).
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const { createRunEmitter, NULL_EMITTER, FLUSH_MAX } = await import("./runEvents.js");
type PreparedEvent = Awaited<ReturnType<typeof import("./runEventCore.js").prepareEvent>>;

const SCOPE = { runId: 7, userId: "user_1", projectId: 3 };
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Records batches in the order they were written, as the db writer would. */
function recordingWriter() {
  const batches: NonNullable<PreparedEvent>[][] = [];
  return {
    batches,
    writer: {
      write: async (_scope: typeof SCOPE, rows: NonNullable<PreparedEvent>[]) => {
        batches.push(rows);
      },
    },
  };
}

const summaries = (batches: NonNullable<PreparedEvent>[][]): string[] =>
  batches.flat().map((r) => r.summary);

// ---------------------------------------------------------------------------
// Buffering and flushing
// ---------------------------------------------------------------------------

test("emit buffers, and close writes what is buffered", async () => {
  const { batches, writer } = recordingWriter();
  const em = createRunEmitter(SCOPE, writer);

  em.emit({ agent: "system", type: "run.started", data: { trigger: "manual" } });
  em.emit({ agent: "system", type: "stage.started", data: { stage: "plan" } });
  assert.equal(batches.length, 0, "nothing is written synchronously");

  await em.close();
  assert.equal(batches.length, 1, "one batch");
  assert.deepEqual(summaries(batches), ["Run started (manual)", "Planning started"]);
});

test("the buffer flushes itself once it reaches FLUSH_MAX, without waiting for the timer", async () => {
  const { batches, writer } = recordingWriter();
  const em = createRunEmitter(SCOPE, writer);

  for (let i = 0; i < FLUSH_MAX; i++) {
    em.emit({ agent: "raptia", type: "file.write", data: { path: `src/f${i}.ts`, action: "modify" } });
  }
  await tick();
  assert.equal(batches.length, 1, "wrote without the timer");
  assert.equal(batches[0].length, FLUSH_MAX);
  await em.close();
});

test("the timer flushes a partial buffer on its own", async () => {
  const { batches, writer } = recordingWriter();
  const em = createRunEmitter(SCOPE, writer);
  em.emit({ agent: "system", type: "stage.started", data: { stage: "generate" } });
  assert.equal(batches.length, 0);
  await tick(500); // FLUSH_MS is 400
  assert.equal(batches.length, 1, "the timer fired");
  await em.close();
});

test("batches are written in the order they were buffered", async () => {
  // A writer that makes the FIRST batch slow, so an unserialized emitter would
  // let the second overtake it and reorder the timeline.
  const batches: NonNullable<PreparedEvent>[][] = [];
  let first = true;
  const writer = {
    write: async (_s: typeof SCOPE, rows: NonNullable<PreparedEvent>[]) => {
      if (first) {
        first = false;
        await tick(60);
      }
      batches.push(rows);
    },
  };
  const em = createRunEmitter(SCOPE, writer);

  em.emit({ agent: "system", type: "stage.started", data: { stage: "plan" } });
  await em.flush();
  em.emit({ agent: "system", type: "stage.completed", data: { stage: "plan" } });
  await em.close();

  assert.deepEqual(summaries(batches), ["Planning started", "Planning completed"]);
});

// ---------------------------------------------------------------------------
// Failure isolation — the contract the agents rely on
// ---------------------------------------------------------------------------

test("a thrown writer error never propagates out of emit, flush or close", async () => {
  const writer = {
    write: async () => {
      throw Object.assign(new Error("Failed query: insert into run_events"), {
        cause: { code: "57014" },
      });
    },
  };
  const em = createRunEmitter(SCOPE, writer);

  // Synchronous emit must not throw.
  assert.doesNotThrow(() => em.emit({ agent: "system", type: "run.started", data: { trigger: "manual" } }));
  // Neither awaited call may reject.
  await em.flush();
  await em.close();
});

test("a failed batch does not poison the next one", async () => {
  const written: string[] = [];
  let calls = 0;
  const writer = {
    write: async (_s: typeof SCOPE, rows: NonNullable<PreparedEvent>[]) => {
      calls++;
      if (calls === 1) throw new Error("transient");
      written.push(...rows.map((r) => r.summary));
    },
  };
  const em = createRunEmitter(SCOPE, writer);

  em.emit({ agent: "system", type: "stage.started", data: { stage: "plan" } });
  await em.flush();
  em.emit({ agent: "system", type: "stage.completed", data: { stage: "plan" } });
  await em.close();

  assert.equal(calls, 2, "the second write was attempted");
  assert.deepEqual(written, ["Planning completed"]);
});

test("a writer that hangs does not block the run — emit stays synchronous", () => {
  const em = createRunEmitter(SCOPE, { write: () => new Promise<void>(() => {}) });
  const start = Date.now();
  for (let i = 0; i < FLUSH_MAX * 2; i++) {
    em.emit({ agent: "raptia", type: "file.write", data: { path: `src/f${i}.ts`, action: "modify" } });
  }
  assert.ok(Date.now() - start < 100, "emitting never waits on the writer");
});

// ---------------------------------------------------------------------------
// Validation and lifecycle
// ---------------------------------------------------------------------------

test("an event the taxonomy rejects never reaches the writer", async () => {
  const { batches, writer } = recordingWriter();
  const em = createRunEmitter(SCOPE, writer);
  em.emit({ agent: "system", type: "run.detonated" as never });
  em.emit({ agent: "gpt" as never, type: "run.started" });
  await em.close();
  assert.equal(batches.length, 0);
});

test("emit after close is a no-op", async () => {
  const { batches, writer } = recordingWriter();
  const em = createRunEmitter(SCOPE, writer);
  await em.close();
  em.emit({ agent: "system", type: "run.completed", data: { suggestions: 2 } });
  await tick(500);
  assert.equal(batches.length, 0);
});

test("flush on an empty buffer writes nothing", async () => {
  const { batches, writer } = recordingWriter();
  const em = createRunEmitter(SCOPE, writer);
  await em.flush();
  await em.flush();
  assert.equal(batches.length, 0);
  await em.close();
});

test("RUN_EVENTS_ENABLED=false makes createRunEmitter the identity emitter", async () => {
  const before = process.env.RUN_EVENTS_ENABLED;
  process.env.RUN_EVENTS_ENABLED = "false";
  try {
    const { batches, writer } = recordingWriter();
    const em = createRunEmitter(SCOPE, writer);
    em.emit({ agent: "system", type: "run.started", data: { trigger: "manual" } });
    await em.flush();
    await em.close();
    assert.equal(batches.length, 0, "nothing is buffered, templated or written");
  } finally {
    if (before === undefined) delete process.env.RUN_EVENTS_ENABLED;
    else process.env.RUN_EVENTS_ENABLED = before;
  }
});

test("any other value leaves the timeline on", async () => {
  const before = process.env.RUN_EVENTS_ENABLED;
  for (const value of [undefined, "true", "1", ""]) {
    if (value === undefined) delete process.env.RUN_EVENTS_ENABLED;
    else process.env.RUN_EVENTS_ENABLED = value;
    const { batches, writer } = recordingWriter();
    const em = createRunEmitter(SCOPE, writer);
    em.emit({ agent: "system", type: "run.started", data: { trigger: "manual" } });
    await em.close();
    assert.equal(batches.length, 1, `RUN_EVENTS_ENABLED=${String(value)} should stay on`);
  }
  if (before === undefined) delete process.env.RUN_EVENTS_ENABLED;
  else process.env.RUN_EVENTS_ENABLED = before;
});

test("NULL_EMITTER accepts everything and stores nothing", async () => {
  assert.doesNotThrow(() => NULL_EMITTER.emit({ agent: "system", type: "run.started" }));
  await NULL_EMITTER.flush();
  await NULL_EMITTER.close();
});

// ---------------------------------------------------------------------------
// seq block arithmetic
// ---------------------------------------------------------------------------

/**
 * The claim is `UPDATE runs SET event_seq = event_seq + n RETURNING event_seq`,
 * which returns the END of the reserved block, so the first row of the batch is
 * `end - n + 1`. This models that arithmetic over a shared counter and asserts
 * the blocks are contiguous and never overlap, including when two emitters on
 * one run interleave.
 *
 * It does NOT test the row lock that makes commit order match seq order — that
 * is a database property, and it is covered by
 * `scripts/runevents-verify/seq.ts` against a real Postgres.
 */
test("claimed seq blocks are contiguous and never overlap across two emitters", async () => {
  let eventSeq = 0;
  const rows: Array<{ seq: number; summary: string }> = [];
  const writer = {
    write: async (_s: typeof SCOPE, batch: NonNullable<PreparedEvent>[]) => {
      // The atomic claim.
      eventSeq += batch.length;
      const end = eventSeq;
      const start = end - batch.length + 1;
      await tick(1); // let the other emitter run
      batch.forEach((r, i) => rows.push({ seq: start + i, summary: r.summary }));
    },
  };

  const a = createRunEmitter(SCOPE, writer);
  const b = createRunEmitter(SCOPE, writer);
  for (let i = 0; i < 5; i++) {
    a.emit({ agent: "raptia", type: "file.write", data: { path: `a${i}.ts`, action: "modify" } });
    b.emit({ agent: "fovea", type: "file.write", data: { path: `b${i}.ts`, action: "modify" } });
  }
  await Promise.all([a.close(), b.close()]);

  const seqs = rows.map((r) => r.seq).sort((x, y) => x - y);
  assert.equal(seqs.length, 10);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "contiguous from 1, no gaps, no duplicates");
  assert.equal(new Set(seqs).size, 10, "no two events share a seq");
});
