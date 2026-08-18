import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHunks, applyErrorMessage } from "./patchService.js";

test("single hunk applies and leaves surrounding content untouched", () => {
  const original = "header line\nvalue = 1\nfooter line\n";
  const res = applyHunks(original, [{ search: "value = 1", replace: "value = 2" }]);
  assert.equal(res.ok, true);
  assert.ok(res.ok && res.content === "header line\nvalue = 2\nfooter line\n");
});

test("a search that appears twice returns multiple_matches and applies nothing", () => {
  const original = "dup\nmiddle\ndup\n";
  const res = applyHunks(original, [{ search: "dup", replace: "X" }]);
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.reason === "multiple_matches");
  assert.equal(res.ok, false);
  // "applies nothing" — no content is produced on failure.
  assert.ok(!("content" in res));
  assert.ok(!res.ok && res.failedIndex === 0);
});

test("a search that is absent returns no_match", () => {
  const res = applyHunks("alpha beta gamma\n", [{ search: "delta", replace: "D" }]);
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.reason === "no_match");
  assert.ok(!res.ok && res.failedIndex === 0);
});

test("two hunks whose ranges overlap return overlap", () => {
  // Both searches are individually unique, but their matched offsets overlap.
  const res = applyHunks("abcdef\n", [
    { search: "abcd", replace: "1234" },
    { search: "cdef", replace: "5678" },
  ]);
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.reason === "overlap");
  // The offending hunk is the second (later-starting) one.
  assert.ok(!res.ok && res.failedIndex === 1);
});

test("a CRLF file matches an LF search block and the output stays CRLF", () => {
  const original = "a\r\nb\r\nc\r\n"; // Windows line endings
  // Search block uses LF newlines and spans a line boundary.
  const res = applyHunks(original, [{ search: "a\nb", replace: "a\nB" }]);
  assert.ok(res.ok);
  assert.equal(res.ok && res.content, "a\r\nB\r\nc\r\n");
  assert.ok(res.ok && res.content.includes("\r\n"));
});

test("an LF file stays LF", () => {
  const original = "x\ny\nz\n";
  const res = applyHunks(original, [{ search: "y", replace: "Y" }]);
  assert.ok(res.ok);
  assert.equal(res.ok && res.content, "x\nY\nz\n");
  assert.ok(res.ok && !res.content.includes("\r"));
});

test("multiple non-overlapping hunks apply in a single pass regardless of input order", () => {
  const original = "one\ntwo\nthree\nfour\n";
  // Supplied out of document order to prove they are located and spliced by offset.
  const res = applyHunks(original, [
    { search: "four", replace: "4" },
    { search: "one", replace: "1" },
  ]);
  assert.ok(res.ok);
  assert.equal(res.ok && res.content, "1\ntwo\nthree\n4\n");
});

test("a failure returns the offending search block verbatim (line endings preserved)", () => {
  // The search block carries CRLF; the file does not contain it → no_match.
  const search = "NOPE\r\nGONE";
  const res = applyHunks("just some content\n", [{ search, replace: "whatever" }]);
  assert.equal(res.ok, false);
  // Returned verbatim — not normalised to LF.
  assert.ok(!res.ok && res.search === search);
  // …and it flows through to the user-facing message unchanged.
  assert.ok(!res.ok && applyErrorMessage(res, "src/File.cs").endsWith(`\n\n${search}`));
});
