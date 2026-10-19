import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CONCURRENT_UPLOADS,
  MAX_SIZE_BYTES,
  MAX_SOURCES_PER_PROJECT,
  defaultTitle,
  displayFileName,
  inFlightCount,
  nextToStart,
  queueReducer,
  sortSources,
  uploadableCount,
  validateFile,
  type QueueItem,
} from "./knowledgeQueue.ts";

/**
 * The queue's rules, with no browser and no server.
 *
 * The behaviour worth pinning is what happens when a batch is mixed: one bad
 * file must never stop the good ones, a failure must stay visible for a retry,
 * and the concurrency bound must hold however the states interleave.
 */

// A File stand-in: the queue only ever reads name and size.
const f = (name: string, size = 1024) => ({ name, size }) as unknown as File;

const add = (files: File[], existingCount = 0, items: QueueItem[] = []) =>
  queueReducer(items, { type: "add", files, docType: "requirements", existingCount });

test("8. validateFile accepts the five types and rejects the rest", () => {
  for (const name of ["a.md", "a.txt", "a.csv", "a.pdf", "a.docx", "A.PDF"]) {
    assert.equal(validateFile(f(name), { queuedNames: [], existingCount: 0, acceptedSoFar: 0 }), null, name);
  }
  assert.match(
    validateFile(f("payload.exe"), { queuedNames: [], existingCount: 0, acceptedSoFar: 0 }) ?? "",
    /Unsupported file type/,
  );
  // No extension at all.
  assert.match(
    validateFile(f("README"), { queuedNames: [], existingCount: 0, acceptedSoFar: 0 }) ?? "",
    /Unsupported file type/,
  );
});

test("8b. validateFile rejects oversize, empty, duplicate and over-cap files", () => {
  assert.match(
    validateFile(f("big.pdf", MAX_SIZE_BYTES + 1), { queuedNames: [], existingCount: 0, acceptedSoFar: 0 }) ?? "",
    /15 MB/,
  );
  assert.match(
    validateFile(f("empty.md", 0), { queuedNames: [], existingCount: 0, acceptedSoFar: 0 }) ?? "",
    /empty/,
  );
  assert.match(
    validateFile(f("a.md"), { queuedNames: ["a.md"], existingCount: 0, acceptedSoFar: 0 }) ?? "",
    /Already in the queue/,
  );
  assert.match(
    validateFile(f("a.md"), { queuedNames: [], existingCount: MAX_SOURCES_PER_PROJECT, acceptedSoFar: 0 }) ?? "",
    /Limit of 25 documents/,
  );
  // The cap counts what this batch has already accepted.
  assert.match(
    validateFile(f("a.md"), { queuedNames: [], existingCount: 24, acceptedSoFar: 1 }) ?? "",
    /Limit of 25 documents/,
  );
  assert.equal(validateFile(f("a.md"), { queuedNames: [], existingCount: 24, acceptedSoFar: 0 }), null);
});

test("9. a mixed batch flags the bad files and queues the good ones", () => {
  const items = add([f("arch.pdf"), f("payload.exe"), f("spec.md"), f("huge.pdf", MAX_SIZE_BYTES + 1)]);
  assert.equal(items.length, 4, "every file gets a row, so nothing disappears silently");
  assert.deepEqual(
    items.map((i) => i.state),
    ["queued", "invalid", "queued", "invalid"],
  );
  assert.equal(uploadableCount(items), 2, "one bad file never blocks the good ones");
  assert.equal(items[0].title, "arch", "the title defaults to the name without its extension");
});

test("9b. remove, per-row type, type-for-all and title edits", () => {
  let items = add([f("a.md"), f("b.pdf")]);
  items = queueReducer(items, { type: "remove", id: items[0].id });
  assert.equal(items.length, 1);

  items = add([f("c.docx")], 0, items);
  items = queueReducer(items, { type: "setDocTypeAll", docType: "architecture" });
  assert.deepEqual(items.map((i) => i.docType), ["architecture", "architecture"]);

  items = queueReducer(items, { type: "setDocType", id: items[1].id, docType: "design" });
  assert.deepEqual(items.map((i) => i.docType), ["architecture", "design"], "a row still overrides the batch");

  items = queueReducer(items, { type: "setTitle", id: items[0].id, title: "Platform" });
  assert.equal(items[0].title, "Platform");
});

test("9c. a failure stays for retry; done rows leave on clearFinished", () => {
  let items = add([f("a.md"), f("b.md")]);
  const [one, two] = items;

  items = queueReducer(items, { type: "start", id: one.id, sourceId: 7 });
  items = queueReducer(items, { type: "progress", id: one.id, progress: 55 });
  assert.equal(items[0].state, "uploading");
  assert.equal(items[0].progress, 55);
  assert.equal(items[0].sourceId, 7);

  items = queueReducer(items, { type: "processing", id: one.id });
  assert.equal(items[0].progress, 100);
  items = queueReducer(items, { type: "done", id: one.id });

  items = queueReducer(items, { type: "start", id: two.id });
  items = queueReducer(items, { type: "failed", id: two.id, error: "Storage returned an error." });
  assert.equal(items[1].state, "failed");
  assert.equal(items[1].error, "Storage returned an error.");

  // One failure does not touch the other row.
  assert.equal(items[0].state, "done");

  items = queueReducer(items, { type: "clearFinished" });
  assert.deepEqual(items.map((i) => i.state), ["failed"], "failures stay behind so they can be retried");

  items = queueReducer(items, { type: "retry", id: items[0].id });
  assert.equal(items[0].state, "queued");
  assert.equal(items[0].error, null);
  assert.equal(items[0].sourceId, undefined, "a retry must not reuse the dead source id");
});

test("9d. progress is clamped, so a bad byte count cannot break the bar", () => {
  let items = add([f("a.md")]);
  items = queueReducer(items, { type: "progress", id: items[0].id, progress: 240 });
  assert.equal(items[0].progress, 100);
  items = queueReducer(items, { type: "progress", id: items[0].id, progress: -5 });
  assert.equal(items[0].progress, 0);
});

test("9e. concurrency never exceeds three, whatever the mix of states", () => {
  let items = add([f("a.md"), f("b.md"), f("c.md"), f("d.md"), f("e.md"), f("bad.exe")]);
  assert.equal(nextToStart(items).length, MAX_CONCURRENT_UPLOADS);

  for (const i of nextToStart(items)) items = queueReducer(items, { type: "start", id: i.id });
  assert.equal(inFlightCount(items), 3);
  assert.equal(nextToStart(items).length, 0, "no fourth upload starts while three are in flight");

  // Processing still occupies a slot — the server is working on it.
  items = queueReducer(items, { type: "processing", id: items[0].id });
  assert.equal(inFlightCount(items), 3);
  assert.equal(nextToStart(items).length, 0);

  // Finishing one frees exactly one.
  items = queueReducer(items, { type: "done", id: items[0].id });
  assert.equal(inFlightCount(items), 2);
  assert.equal(nextToStart(items).length, 1);

  // An invalid row is never started.
  for (const i of nextToStart(items)) items = queueReducer(items, { type: "start", id: i.id });
  items = queueReducer(items, { type: "done", id: items[1].id });
  items = queueReducer(items, { type: "done", id: items[2].id });
  items = queueReducer(items, { type: "done", id: items[3].id });
  items = queueReducer(items, { type: "done", id: items[4].id });
  assert.deepEqual(nextToStart(items), [], "the .exe row stays out of the rotation");
});

test("9f. the cap counts documents already in the project plus the queue", () => {
  const items = add([f("a.md"), f("b.md"), f("c.md")], MAX_SOURCES_PER_PROJECT - 2);
  assert.deepEqual(items.map((i) => i.state), ["queued", "queued", "invalid"]);
  assert.match(items[2].error ?? "", /Limit of 25/);
});

test("10. sort by each column, both directions, stable on ties", () => {
  const rows = [
    { id: 1, title: "beta", docType: "design", sizeBytes: 300, createdAt: "2026-01-02T00:00:00Z" },
    { id: 2, title: "Alpha", docType: "architecture", sizeBytes: 100, createdAt: "2026-01-03T00:00:00Z" },
    { id: 3, title: "gamma", docType: "design", sizeBytes: 200, createdAt: "2026-01-01T00:00:00Z" },
  ];

  assert.deepEqual(sortSources(rows, "createdAt", "desc").map((r) => r.id), [2, 1, 3]);
  assert.deepEqual(sortSources(rows, "createdAt", "asc").map((r) => r.id), [3, 1, 2]);
  // Case-insensitive, so "Alpha" sorts before "beta" rather than above it.
  assert.deepEqual(sortSources(rows, "title", "asc").map((r) => r.id), [2, 1, 3]);
  assert.deepEqual(sortSources(rows, "title", "desc").map((r) => r.id), [3, 1, 2]);
  assert.deepEqual(sortSources(rows, "sizeBytes", "asc").map((r) => r.id), [2, 3, 1]);
  assert.deepEqual(sortSources(rows, "sizeBytes", "desc").map((r) => r.id), [1, 3, 2]);

  // Two rows share a docType: id breaks the tie the same way in both
  // directions, so a poll cannot make them swap.
  assert.deepEqual(sortSources(rows, "docType", "asc").map((r) => r.id), [2, 1, 3]);
  assert.deepEqual(sortSources(rows, "docType", "desc").map((r) => r.id), [1, 3, 2]);
  // And the input is never mutated.
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3]);
});

test("display helpers keep a long name identifiable", () => {
  assert.equal(defaultTitle("Invoice 1017.pdf"), "Invoice 1017");
  assert.equal(defaultTitle("README"), "README");
  assert.equal(displayFileName("short.md"), "short.md");
  const long = displayFileName(`${"a".repeat(60)}.docx`, 24);
  assert.ok(long.endsWith(".docx"), long);
  assert.ok(long.length <= 24, `${long.length}`);
});
