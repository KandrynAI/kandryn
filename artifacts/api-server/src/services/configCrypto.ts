import crypto from "node:crypto";
import { logger } from "../lib/logger.js";

/**
 * At-rest encryption for integration credentials (integration_configs +
 * team_integrations). AES-256-GCM (authenticated). Ciphertext is stored as
 * `enc:v1:<base64(iv ‖ authTag ‖ ciphertext)>` in the existing `value` text
 * column — no schema change.
 *
 * The key comes from CONFIG_ENCRYPTION_KEY (32 bytes, base64 or hex). When it is
 * absent, encryption is a graceful no-op (values stored as plaintext) with a
 * one-time warning — so dev/sandbox and not-yet-configured deploys still work;
 * production sets the key. Values are only ever ciphertext at rest; callers
 * always see plaintext. This module NEVER logs a credential value.
 */

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(): Buffer | null {
  const raw = process.env.CONFIG_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  try {
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

const KEY = loadKey();
let warned = false;
function warnIfDisabled(): void {
  if (KEY || warned) return;
  warned = true;
  logger.warn(
    "CONFIG_ENCRYPTION_KEY is unset or invalid — integration credentials are stored UNENCRYPTED at rest. Set a 32-byte key (base64/hex) in production.",
  );
}

/** True when a valid key is configured (used by the backfill to no-op safely). */
export function isEncryptionEnabled(): boolean {
  return KEY != null;
}

/** True when a stored value is in the encrypted envelope format. */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** Encrypt a credential for storage. No key or empty string → returned as-is. */
export function encryptSecret(plaintext: string): string {
  warnIfDisabled();
  if (!KEY || plaintext === "") return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted — don't double-wrap
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a stored value. Legacy plaintext (no envelope) is returned as-is. */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext
  if (!KEY) {
    // Encrypted at rest but no key to read it — return empty rather than leaking
    // ciphertext as if it were a credential. The integration reads as unset.
    warnIfDisabled();
    return "";
  }
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (err) {
    // Wrong key or corrupt value. Never log the value; the integration reads unset.
    logger.error({ err }, "Failed to decrypt an integration credential (wrong key or corrupt data)");
    return "";
  }
}
