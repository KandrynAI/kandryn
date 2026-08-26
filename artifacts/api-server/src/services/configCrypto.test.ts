import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Set a key BEFORE importing the module (the key is read at module load).
process.env.CONFIG_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
const { encryptSecret, decryptSecret, isEncrypted, isEncryptionEnabled } = await import("./configCrypto.js");

test("encryption is enabled with a valid key", () => {
  assert.equal(isEncryptionEnabled(), true);
});

test("round-trips a secret", () => {
  const secret = "ghp_" + "x".repeat(36);
  const enc = encryptSecret(secret);
  assert.ok(isEncrypted(enc), "stored value is enveloped");
  assert.notEqual(enc, secret);
  assert.equal(decryptSecret(enc), secret);
});

test("two encryptions of the same value differ (random IV) but both decrypt", () => {
  const s = "jira-token-123";
  const a = encryptSecret(s);
  const b = encryptSecret(s);
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), s);
  assert.equal(decryptSecret(b), s);
});

test("legacy plaintext is returned unchanged", () => {
  assert.equal(decryptSecret("plain-legacy-value"), "plain-legacy-value");
});

test("empty string passes through", () => {
  assert.equal(encryptSecret(""), "");
});

test("already-encrypted value is not double-wrapped", () => {
  const enc = encryptSecret("abc");
  assert.equal(encryptSecret(enc), enc);
});

test("a corrupted ciphertext decrypts to empty, never throws", () => {
  const enc = encryptSecret("abc");
  const corrupted = enc.slice(0, -4) + "AAAA";
  assert.equal(decryptSecret(corrupted), "");
});
