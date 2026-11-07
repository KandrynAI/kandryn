import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A run is never started after the response that asked for it.
 *
 * Generation runs inline in an Express handler on @vercel/node. The invocation
 * ends when the route answers: the container is frozen and reclaimed, and work
 * begun before that point does not get to finish. It is not the 300s
 * maxDuration ceiling either, because that timer only applies while the
 * invocation is open.
 *
 * This is not hypothetical. `approvePlan` ended with a fire-and-forget
 * `void executeRun(runId, { reusePlan: true })`, and approving a parked plan on
 * production got about ten seconds of borrowed time — long enough to emit the
 * context stage and a generation-started event, not long enough to produce a
 * single suggestion. The run sat `running` until the dispatcher's 20-minute
 * sweep failed it with a timeout message that named neither cause nor remedy.
 * `reviseAndRegenerate` had the identical shape.
 *
 * The fix is structural: a route that wants a run executed leaves the row
 * `queued` and answers, and the client fires a second request the SERVER
 * awaits. This guard fails the build if the old shape comes back.
 *
 * Scoped deliberately to the run-execution entry points. Fire-and-forget is
 * right and common elsewhere here — audit writes, repo re-indexing, email —
 * because losing one of those costs a log line, not a run.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The functions that execute a run. Each takes minutes and writes its outcome to the row. */
const RUN_EXECUTORS = ["executeRun", "regenerateFromPlan", "regenerateCurrentPlan"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") sourceFiles(full, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** The comments above describe the banned shape; they must not trip the guard. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const files = sourceFiles(SRC).map((full) => ({
  rel: relative(SRC, full).split(sep).join("/"),
  code: stripComments(readFileSync(full, "utf8")),
}));

test("guard: source files were found to scan", () => {
  // Without this the assertions below pass on an empty list and say nothing.
  assert.ok(files.length > 20, `expected to scan the api-server sources, found ${files.length} files`);
  assert.ok(
    files.some((f) => f.rel === "services/runService.ts"),
    "runService.ts is the file this guard exists for and it was not scanned",
  );
});

test("no run is started with `void` (fire-and-forget after a response)", () => {
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    code.split("\n").forEach((line, i) => {
      for (const fn of RUN_EXECUTORS) {
        if (new RegExp(`\\bvoid\\s+${fn}\\s*\\(`).test(line)) {
          offenders.push(`${rel}:${i + 1}  void ${fn}(...)`);
        }
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `A run started with \`void\` does not survive the response that started it.\n` +
      `Leave the run \`queued\` and have the client call an endpoint that awaits the work.\n` +
      offenders.join("\n"),
  );
});

test("no run is started with a bare .catch() instead of await", () => {
  // The same mistake wearing a different hat: `executeRun(id).catch(log)` is a
  // floating promise too, and it reads more like error handling than like a
  // background start, so it survives review more easily.
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    code.split("\n").forEach((line, i) => {
      for (const fn of RUN_EXECUTORS) {
        if (new RegExp(`(^|[^.\\w])${fn}\\s*\\([^;]*\\)\\s*\\.catch\\b`).test(line) && !/\bawait\s/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${fn}(...).catch(...)`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], `Unawaited run execution:\n${offenders.join("\n")}`);
});
