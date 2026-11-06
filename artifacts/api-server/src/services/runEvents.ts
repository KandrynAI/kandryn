/**
 * The live run timeline's db-backed half (0044): one emitter per run.
 *
 * THE CONTRACT THE AGENTS RELY ON: emitting never throws, never blocks and
 * never slows a run. `emit()` is synchronous and fire-and-forget — it
 * validates and templates in memory (runEventCore.ts), buffers, and returns.
 * Writes happen on a short timer off the agent's path, and every error is
 * logged and swallowed. A run must be able to succeed with the whole timeline
 * broken.
 *
 * WHY THE FLUSH IS ON A TIMER AND NOT AT STAGE BOUNDARIES: the feed has to be
 * live. Flushing when a stage ends would make the whole of Raptia's generation
 * appear at once, several seconds after it happened, and the 2-second
 * freshness target would be unreachable no matter how fast the client polls.
 *
 * WHY `seq` COMES FROM `runs.event_seq`: it is the cursor the client polls
 * with, so it has to be monotonic per run AND equal to commit order. A global
 * sequence (and the serial `id`) is allocated outside the transaction, so a
 * writer holding a lower number can commit after a higher one and land behind
 * a reader's cursor, never to be delivered. Claiming the block inside the
 * insert's own transaction holds the row lock to commit and makes that
 * impossible. Measured in docs/investigations/live-run-timeline.md §8.1.
 */

import { sql, eq } from "drizzle-orm";
import { db, runsTable, runEventsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { prepareEvent, type EmitInput, type PreparedEvent } from "./runEventCore.js";

/** How long a buffered event may wait before it is written. */
export const FLUSH_MS = 400;
/** Buffer size that triggers an immediate write regardless of the timer. */
export const FLUSH_MAX = 20;

export interface RunEventScope {
  runId: number;
  /** The project owner, as on `runs.user_id` — not the person who clicked. */
  userId: string;
  projectId: number;
}

export interface RunEventEmitter {
  /** Fire-and-forget. Synchronous, and never throws. */
  emit(input: EmitInput): void;
  /** Write whatever is buffered. Resolves even when the write failed. */
  flush(): Promise<void>;
  /** Final flush, then stop accepting events. Resolves even on failure. */
  close(): Promise<void>;
}

/**
 * The write half, injectable so the emitter's buffering, ordering and failure
 * isolation can be tested without a database.
 */
export interface RunEventWriter {
  write(scope: RunEventScope, rows: PreparedEvent[]): Promise<void>;
}

/**
 * Claim a block of `seq` values and insert the batch, in ONE transaction. The
 * `UPDATE … RETURNING` takes the run row's lock and holds it to commit, so a
 * second emitter on the same run cannot claim until this batch is visible.
 */
export const dbWriter: RunEventWriter = {
  async write(scope, rows) {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(runsTable)
        .set({ eventSeq: sql`${runsTable.eventSeq} + ${rows.length}` })
        .where(eq(runsTable.id, scope.runId))
        .returning({ eventSeq: runsTable.eventSeq });
      // The run was deleted mid-flight. Its events would cascade away anyway.
      if (!claimed) return;

      const end = Number(claimed.eventSeq);
      const start = end - rows.length + 1;
      await tx.insert(runEventsTable).values(
        rows.map((r, i) => ({
          runId: scope.runId,
          userId: scope.userId,
          projectId: scope.projectId,
          seq: start + i,
          agent: r.agent,
          type: r.type,
          status: r.status,
          summary: r.summary,
          data: r.data,
          durationMs: r.durationMs,
        })),
      );
    });
  },
};

/**
 * An emitter for one run.
 *
 * Flushes are serialized through a promise chain, so batches are written in
 * the order they were buffered and two writes never interleave — which is what
 * makes `seq` order equal to the order the agents emitted in, not just to
 * commit order.
 */
export function createRunEmitter(scope: RunEventScope, writer: RunEventWriter = dbWriter): RunEventEmitter {
  let buffer: PreparedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let closed = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = (): Promise<void> => {
    clearTimer();
    if (buffer.length === 0) return chain;
    const batch = buffer;
    buffer = [];
    // The catch is inside the chain so a failed write cannot poison the next
    // one, and so `flush()` resolves rather than rejecting into a caller that
    // has no business handling it.
    chain = chain.then(() =>
      writer.write(scope, batch).catch((err: unknown) => {
        logger.warn(
          { runId: scope.runId, err, dropped: batch.length },
          "Run timeline: writing a batch of events failed — the run is unaffected",
        );
      }),
    );
    return chain;
  };

  const schedule = (): void => {
    if (timer !== null || closed) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_MS);
    // Never a reason to keep the process alive: `close()` does the last flush.
    timer.unref?.();
  };

  return {
    emit(input) {
      try {
        if (closed) return;
        const prepared = prepareEvent(input);
        if (!prepared) {
          logger.warn(
            { runId: scope.runId, type: input.type, agent: input.agent },
            "Run timeline: dropped an event the taxonomy does not allow",
          );
          return;
        }
        buffer.push(prepared);
        if (buffer.length >= FLUSH_MAX) void flush();
        else schedule();
      } catch (err) {
        // Belt and braces: nothing in here should throw, and if it does the run
        // still must not notice.
        logger.warn({ runId: scope.runId, err }, "Run timeline: emit failed");
      }
    },
    flush,
    async close() {
      closed = true;
      await flush();
      clearTimer();
    },
  };
}

/**
 * The identity emitter: accepts everything, stores nothing.
 *
 * What a disabled timeline returns, and what a test uses when it cares about
 * the code under test rather than the events.
 */
export const NULL_EMITTER: RunEventEmitter = {
  emit() {},
  flush: async () => {},
  close: async () => {},
};
