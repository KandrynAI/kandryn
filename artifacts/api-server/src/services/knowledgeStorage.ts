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

export type StorageFailureKind = "bucket_missing" | "auth" | "other";

/**
 * A storage call that failed, classified so the route can say something
 * actionable instead of relaying the library's wording.
 *
 * This exists because of a real support round-trip: a signed-URL call against
 * a bucket that did not exist surfaced as "Could not create an upload URL:
 * The related resource does not exist", which names neither the bucket nor
 * the remedy. Storage answers `POST /object/upload/sign/<bucket>/<path>` with
 * a 404 when the bucket is absent from the project the URL points at, so that
 * is the one case worth naming outright.
 */
export class StorageOpError extends Error {
  constructor(
    readonly kind: StorageFailureKind,
    readonly bucket: string,
    /** Supabase's own message, for the log only — never sent to a client. */
    readonly detail: string,
    readonly httpStatus?: number,
  ) {
    super(`Storage ${kind} on bucket ${bucket}`);
  }
}

interface SupabaseStorageError {
  message?: string;
  name?: string;
  status?: number;
  statusCode?: string | number;
  error?: string;
}

/**
 * Classify a Supabase storage error and log it safely.
 *
 * Logged: status, error name, message, and the bucket NAME. Never the service
 * role key, never the project URL, never a file name or any file content.
 */
export function classifyStorageError(err: unknown, op: string): StorageOpError {
  const e = (err ?? {}) as SupabaseStorageError;
  const bucket = bucketName();
  const status = Number(e.status ?? e.statusCode ?? 0) || undefined;
  const message = e.message ?? String(err);
  const name = e.name ?? e.error;

  // 404 from a storage call means the bucket is not in this project. A 400
  // with "Bucket not found" is the same condition from an older gateway.
  const missing = status === 404 || /bucket not found|related resource does not exist/i.test(message);
  // 401/403 is a rejected key; Storage words it as an invalid JWT.
  const badAuth = status === 401 || status === 403 || /invalid jwt|signature verification|unauthor/i.test(message);

  const kind: StorageFailureKind = missing ? "bucket_missing" : badAuth ? "auth" : "other";
  logger.warn({ op, bucket, status, name, message, kind }, "Knowledge storage call failed");
  return new StorageOpError(kind, bucket, message, status);
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
const MAX_STEM = 100;

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // NFKD then strip combining marks, so "Ünïcode" becomes "Unicode" rather
  // than a row of underscores.
  const ascii = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "");

  const dot = ascii.lastIndexOf(".");
  // A leading dot is part of the name, not an extension separator.
  const hasExt = dot > 0 && dot < ascii.length - 1;
  const rawStem = hasExt ? ascii.slice(0, dot) : ascii;
  const rawExt = hasExt ? ascii.slice(dot + 1) : "";

  const clean = (part: string) =>
    part
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");

  // Truncate the STEM, never the extension — a path that loses its suffix is
  // a path nobody can identify later.
  const stem = clean(rawStem).slice(0, MAX_STEM) || "document";
  const ext = clean(rawExt).slice(0, 12);
  return ext ? `${stem}.${ext}` : stem;
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
  if (error || !data) throw classifyStorageError(error ?? new Error("unknown error"), "createSignedUploadUrl");
  return data.signedUrl;
}

export async function downloadObject(storagePath: string): Promise<Buffer> {
  const { data, error } = await client().storage.from(bucketName()).download(storagePath);
  if (error || !data) throw classifyStorageError(error ?? new Error("unknown error"), "download");
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
    // A missing object is the expected case on a failed upload — the row and
    // its chunks still have to go, so nothing here is fatal.
    if (error) logger.warn({ bucket: bucketName(), message: error.message }, "Could not delete a knowledge object");
  } catch (err) {
    logger.warn({ bucket: bucketName(), err }, "Could not delete a knowledge object");
  }
}

/**
 * Storage failures, in the words of someone who can fix them. The bucket NAME
 * is safe to show and is the one thing that makes this diagnosable; the
 * service-role key and the project URL never appear.
 */
export function storageErrorResponse(err: StorageOpError): { status: number; body: Record<string, string> } {
  if (err.kind === "bucket_missing") {
    return {
      status: 503,
      body: {
        code: "STORAGE_BUCKET_MISSING",
        error: `Storage bucket '${err.bucket}' was not found. Create it as a private bucket in Supabase Storage, or correct KNOWLEDGE_BUCKET.`,
      },
    };
  }
  if (err.kind === "auth") {
    return {
      status: 503,
      body: { code: "STORAGE_AUTH", error: "Storage credentials were rejected. Check SUPABASE_SERVICE_ROLE_KEY." },
    };
  }
  return {
    status: 502,
    body: { code: "STORAGE_ERROR", error: "Document storage returned an error. Try again." },
  };
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
