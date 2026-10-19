import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStoragePath,
  classifyStorageError,
  sanitizeFileName,
  storageErrorResponse,
} from "./knowledgeStorage.js";

/**
 * The storage layer's two jobs that do not need a bucket: saying what went
 * wrong in words someone can act on, and turning a human's file name into a
 * path.
 *
 * The first exists because of a real failure. An upload against a bucket that
 * was not in the project surfaced as "Could not create an upload URL: The
 * related resource does not exist" — which names neither the bucket nor the
 * remedy, and cost a support round-trip to diagnose.
 */

process.env.KNOWLEDGE_BUCKET = "project-knowledge";

test("1. a bucket-not-found error becomes 503 STORAGE_BUCKET_MISSING naming the bucket", () => {
  // The shape Supabase Storage returns from POST /object/upload/sign/<bucket>.
  const err = classifyStorageError(
    { name: "StorageApiError", message: "The related resource does not exist", status: 404, statusCode: "404" },
    "createSignedUploadUrl",
  );
  assert.equal(err.kind, "bucket_missing");

  const { status, body } = storageErrorResponse(err);
  assert.equal(status, 503);
  assert.equal(body.code, "STORAGE_BUCKET_MISSING");
  assert.match(body.error, /project-knowledge/);
  assert.match(body.error, /KNOWLEDGE_BUCKET/);
});

test("1b. the reply carries no key, no project URL and no library wording", () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOi.SECRET-KEY-VALUE.sig";
  process.env.SUPABASE_URL = "https://abcdefghijklm.supabase.co";
  const err = classifyStorageError({ message: "The related resource does not exist", status: 404 }, "op");
  const { body } = storageErrorResponse(err);
  const text = JSON.stringify(body);
  assert.ok(!text.includes("SECRET-KEY-VALUE"), "the service role key must never reach a client");
  assert.ok(!text.includes("supabase.co"), "the project URL must never reach a client");
  assert.ok(!text.includes("related resource"), "the library's wording is replaced, not relayed");
  // The detail is kept on the error for the log only.
  assert.match(err.detail, /related resource/);
});

test("1c. rejected credentials and anything else map to their own codes", () => {
  const auth = storageErrorResponse(classifyStorageError({ message: "invalid JWT", status: 401 }, "op"));
  assert.equal(auth.status, 503);
  assert.equal(auth.body.code, "STORAGE_AUTH");
  assert.match(auth.body.error, /SUPABASE_SERVICE_ROLE_KEY/);

  const other = storageErrorResponse(classifyStorageError({ message: "upstream timeout", status: 504 }, "op"));
  assert.equal(other.status, 502);
  assert.equal(other.body.code, "STORAGE_ERROR");
  // Generic on purpose — a gateway hiccup is not the operator's to fix.
  assert.ok(!other.body.error.includes("timeout"));
});

test("1d. a 400 worded as a missing bucket is still a missing bucket", () => {
  // An older storage gateway answers this way; the condition is the same.
  assert.equal(classifyStorageError({ message: "Bucket not found", status: 400 }, "op").kind, "bucket_missing");
});

test("3. 'Invoice 1017.pdf' produces a valid path and keeps its extension", () => {
  assert.equal(sanitizeFileName("Invoice 1017.pdf"), "Invoice-1017.pdf");
  const path = buildStoragePath("user_2abcDEF", 6, "Invoice 1017.pdf");
  assert.match(path, /^user_2abcDEF\/6\/[0-9a-f]{16}\/Invoice-1017\.pdf$/, path);
});

test("3b. unicode is transliterated rather than shredded", () => {
  assert.equal(sanitizeFileName("Ünïcode  nàme (v2).docx"), "Unicode-name-v2.docx");
  assert.equal(sanitizeFileName("Çözüm — mimari.md"), "Cozum-mimari.md");
});

test("3c. a long name is truncated WITHOUT losing the extension", () => {
  const out = sanitizeFileName(`${"a".repeat(300)}.md`);
  assert.ok(out.endsWith(".md"), `extension was lost: ${out.slice(-10)}`);
  assert.ok(out.length <= 110, `too long: ${out.length}`);
});

test("3d. traversal, separators and empty names cannot escape or break the path", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFileName("a\\b\\c.txt"), "c.txt");
  assert.equal(sanitizeFileName("..."), "document");
  assert.equal(sanitizeFileName(""), "document");
  // Every result is a single path segment.
  for (const name of ["../../x", "a/b/c.pdf", "..", "   "]) {
    assert.ok(!sanitizeFileName(name).includes("/"), name);
  }
});

test("3e. a user id with odd characters still yields one safe segment", () => {
  const path = buildStoragePath("user:abc/../x", 6, "a.md");
  assert.match(path, /^user_abc____x\/6\//, path);
});
