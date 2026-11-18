import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The index claim is always awaited.
 *
 * `triggerRepoIndex` writes graph_status, graph_started_at and
 * graph_triggered_by (0047) and then fires a non-blocking request at the
 * Graphify microservice. The write is what `isIndexInFlight` reads to refuse a
 * duplicate index, so it is not optional bookkeeping: on @vercel/node the
 * invocation ends when the route answers, a write begun before that point can
 * be dropped, and the next caller then sees an unclaimed row and starts a
 * second clone-and-extract job on the customer's repository.
 *
 * Until 0047 this call was deliberately fire-and-forget at all five of its call
 * sites, and the background-work guard's own comment listed repository
 * re-indexing as a case where losing the work costs only a log line. That
 * stopped being true the moment a guard depended on the write, which is why
 * this file exists rather than another entry in RUN_EXECUTORS: the reasoning is
 * different, and so is the fix.
 *
 * TypeScript will not catch a dropped `await` here, because an ignored promise
 * is not a type error.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const CLAIMANT = "triggerRepoIndex";

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

/** The comment above names the banned shape; it must not trip the guard. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const files = sourceFiles(SRC).map((full) => ({
  rel: relative(SRC, full).split(sep).join("/"),
  code: stripComments(readFileSync(full, "utf8")),
}));

test("guard: the call sites were found to scan", () => {
  // Without this the assertions below pass on an empty list and say nothing.
  // Counted as CALLS, not as files: three of the five live in one route file,
  // so counting files passes this check with most of the call sites gone.
  const calls = files
    .filter((f) => f.rel !== "services/graphifyService.ts")
    .flatMap(({ rel, code }) =>
      code
        .split("\n")
        .map((line, i) => ({ rel, i, line }))
        .filter(({ line }) => new RegExp(`(^|[^.\\w])${CLAIMANT}\\s*\\(`).test(line)),
    );
  assert.ok(calls.length >= 5, `expected at least five ${CLAIMANT} call sites, found ${calls.length}`);
});

test("every call site awaits the claim", () => {
  // One invariant, checked on the whole file rather than line by line: the
  // token immediately before the call must be `await`. That covers every shape
  // at once — `void f(...)`, a bare `f(...)` statement, and
  // `f(...).catch(log)` all fail it, and all three were real possibilities.
  //
  // Line-based matching was tried first and quietly missed two of them: the
  // calls are formatted across several lines, so `.catch` never shares a line
  // with the call, and a look-back window accepted any previous line that
  // happened to contain the word `await` (here, `const cfg = await
  // resolveGitCreds(...)` on the line above). Both planted regressions passed.
  const offenders: string[] = [];
  const call = new RegExp(`(?<![.\\w])${CLAIMANT}\\s*\\(`, "g");
  for (const { rel, code } of files) {
    if (rel === "services/graphifyService.ts") continue; // the declaration itself
    for (const m of code.matchAll(call)) {
      const before = code.slice(0, m.index).replace(/\s+$/, "");
      if (/\bawait$/.test(before)) continue;
      if (/\bimport\b[^;]*$/.test(before.split("\n").pop() ?? "")) continue; // the import statement
      const lineNo = code.slice(0, m.index).split("\n").length;
      offenders.push(`${rel}:${lineNo}  not awaited`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `The claim write must land before the response, or the duplicate-index guard reads a stale row ` +
      `and a second clone-and-extract job starts on the customer's repository.\n` +
      offenders.join("\n"),
  );
});
