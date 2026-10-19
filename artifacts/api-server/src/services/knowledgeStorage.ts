import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger.js";

/**
 * The private Supabase bucket holding uploaded project documents (0041).
 *
 * Follows the Graphify model: entirely a no-op unless configured. Nothing here
 * runs at import time, so an unconfigured deploy behaves exactly as it did
 * before this feature existed — the routes answer 503 and say so.
 *
 * Uploads go straight from the browser to storage via a signed URL because
 * @vercel/node caps a request body at 4.5 MB, well under the 15 MB a real
 * architecture PDF can be. The server mints the path and the URL; the client
 * never chooses either.
 */

const DEFAULT_BUCKET = "project-knowledge";
/** Signed upload URLs are short-lived; the client uses one immediately. */
export const UPLOAD_URL_TTL_SECONDS = 300;

export class StorageNotConfiguredError extends Error {
  readonly status = 503;
  constructor() {
    super("Document storage is not configured.");
  }
}

export function isStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function bucketName(): string {
  return process.env.KNOWLEDGE_BUCKET || DEFAULT_BUCKET;
}

let cached: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!isStorageConfigured()) throw new StorageNotConfiguredError();
  if (!cached) {
    // The service-role key is never logged, here or anywhere.
    cached = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/**
 * A file name safe to put in an object path: no separators, no control
 * characters, no traversal, bounded length. Falls back to a generic name
 * rather than an empty one.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "document";
}

/**
 * Where a document lives: `<userId>/<projectId>/<random>/<safe name>`. The
 * random segment means two uploads of the same file name never collide and a
 * path cannot be guessed from the project alone.
 */
export function buildStoragePath(userId: string, projectId: number, fileName: string): string {
  const safeUser = userId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safeUser}/${projectId}/${randomBytes(8).toString("hex")}/${sanitizeFileName(fileName)}`;
}

export async function createSignedUploadUrl(storagePath: string): Promise<string> {
  const { data, error } = await client().storage.from(bucketName()).createSignedUploadUrl(storagePath);
  if (error || !data) throw new Error(`Could not create an upload URL: ${error?.message ?? "unknown error"}`);
  return data.signedUrl;
}

export async function downloadObject(storagePath: string): Promise<Buffer> {
  const { data, error } = await client().storage.from(bucketName()).download(storagePath);
  if (error || !data) throw new Error(`Could not read the uploaded file: ${error?.message ?? "unknown error"}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Remove an object. Best-effort on purpose: this is called on the failure and
 * delete paths, where the row and the chunks still have to go whatever storage
 * says.
 */
export async function deleteObject(storagePath: string): Promise<void> {
  try {
    const { error } = await client().storage.from(bucketName()).remove([storagePath]);
    if (error) logger.warn({ err: error.message }, "Could not delete a knowledge object");
  } catch (err) {
    logger.warn({ err }, "Could not delete a knowledge object");
  }
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
