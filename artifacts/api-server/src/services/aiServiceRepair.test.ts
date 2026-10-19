import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFileOps, type HunkRepair } from "./aiService.js";

/**
 * The repair round-trip, with no model and no database in the loop.
 *
 * This exists because of a real production failure: a generated edit anchored
 * on text that was not in the file, the whole suggestion was discarded, and —
 * because the other agent had separately dropped out — the run failed with
 * nothing to show for it. The retry is what makes that recoverable, so its
 * boundaries are worth pinning: what it retries, what it refuses to retry, and
 * that it never lets a bad edit through.
 */

const FILE = 'import React from "react";\n\nexport default function App() {\n  return <Home />;\n}\n';
const reader = async (path: string) => (path === "App.tsx" ? { content: FILE, sha: "sha1" } : null);
const editOp = (search: string, replace = "  return <Screening />;") => [
  { op: "edit" as const, path: "App.tsx", hunks: [{ search, replace }] },
];

test("a matching edit applies and the repair hook is never called", async () => {
  let called = 0;
  const repair: HunkRepair = async () => {
    called++;
    return null;
  };
  const { files, valid } = await resolveFileOps(editOp("  return <Home />;"), reader, undefined, repair);
  assert.equal(valid, true);
  assert.equal(files[0].applyStatus, "applied");
  assert.equal(called, 0, "a clean apply must not pay for a repair");
});

test("a search block that is not in the file triggers one repair, and the corrected edit applies", async () => {
  // The production shape: the model invents an anchor that is not in the file.
  const repair: HunkRepair = async (path, content, failedSearch) => {
    assert.equal(path, "App.tsx");
    assert.equal(content, FILE, "the repair must be handed the real file");
    assert.match(failedSearch, /archive/, "and told exactly what did not match");
    return [{ search: "  return <Home />;", replace: "  return <Screening />;" }];
  };
  const { files, valid } = await resolveFileOps(
    editOp('{tab === "archive" && <ScreeningPage />}'),
    reader,
    undefined,
    repair,
  );
  assert.equal(valid, true);
  assert.equal(files[0].applyStatus, "applied");
  assert.match(files[0].content, /<Screening \/>/);
});

test("the stored hunks are the ones that applied, not the ones that failed", async () => {
  // Otherwise the record would show an edit that could never have worked.
  const repair: HunkRepair = async () => [{ search: "  return <Home />;", replace: "  return <X />;" }];
  const { files } = await resolveFileOps(editOp("not in the file"), reader, undefined, repair);
  assert.deepEqual(files[0].hunks, [{ search: "  return <Home />;", replace: "  return <X />;" }]);
});

test("a repair that gives up leaves the original failure intact", async () => {
  const repair: HunkRepair = async () => null;
  const { files, valid } = await resolveFileOps(editOp("not in the file"), reader, undefined, repair);
  assert.equal(valid, false);
  assert.equal(files[0].applyStatus, "failed");
  assert.match(files[0].applyError ?? "", /was expected in App\.tsx but was not found/);
});

test("a repair that is also wrong does not get applied", async () => {
  // The retry is one more chance to be right, not permission to be wrong.
  const repair: HunkRepair = async () => [{ search: "still not in the file", replace: "x" }];
  const { files, valid } = await resolveFileOps(editOp("not in the file"), reader, undefined, repair);
  assert.equal(valid, false);
  assert.equal(files[0].applyStatus, "failed");
  assert.equal(files[0].content, "", "nothing half-applied may be stored");
});

test("with no repair hook the behaviour is exactly as before", async () => {
  const { files, valid } = await resolveFileOps(editOp("not in the file"), reader);
  assert.equal(valid, false);
  assert.equal(files[0].applyStatus, "failed");
});

test("ambiguous and overlapping edits are NOT retried", async () => {
  // Both mean the model read the file correctly and needs more context or
  // fewer hunks — re-asking the same question cannot supply either, so a retry
  // would only cost a round trip.
  const dup = "line\nline\n";
  const dupReader = async () => ({ content: dup, sha: "s" });
  let called = 0;
  const repair: HunkRepair = async () => {
    called++;
    return null;
  };

  const multi = await resolveFileOps(
    [{ op: "edit", path: "a.ts", hunks: [{ search: "line", replace: "x" }] }],
    dupReader,
    undefined,
    repair,
  );
  assert.equal(multi.files[0].applyStatus, "failed");
  assert.match(multi.files[0].applyError ?? "", /matches more than once/);

  const overlap = await resolveFileOps(
    [{ op: "edit", path: "b.ts", hunks: [{ search: "abcd", replace: "x" }, { search: "bc", replace: "y" }] }],
    async () => ({ content: "abcd\n", sha: "s" }),
    undefined,
    repair,
  );
  assert.equal(overlap.files[0].applyStatus, "failed");

  assert.equal(called, 0, "neither case is worth a repair round trip");
});

test("a missing file is not retried — there is nothing to anchor against", async () => {
  let called = 0;
  const repair: HunkRepair = async () => {
    called++;
    return null;
  };
  const { files, valid } = await resolveFileOps(editOp("anything"), async () => null, undefined, repair);
  assert.equal(valid, false);
  assert.match(files[0].applyError ?? "", /File not found in the repository/);
  assert.equal(called, 0);
});

test("creates are untouched by any of this", async () => {
  const { files, valid } = await resolveFileOps(
    [{ op: "create", path: "New.tsx", content: "export const a = 1;\n" }],
    reader,
    undefined,
    async () => null,
  );
  assert.equal(valid, true);
  assert.equal(files[0].applyStatus, "applied");
});
