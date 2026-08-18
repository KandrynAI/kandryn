import { applyHunks } from "./patchService.js";
import type { CommitFile } from "./gitService.js";

export type FileReader = (path: string) => Promise<{ content: string; sha: string } | null>;

/** A suggestion file (in-memory or DB row) resolvable into a commit change. */
export interface ResolvableFile {
  op: "create" | "edit" | "delete";
  filePath: string;
  content: string;
  hunks?: Array<{ search: string; replace: string }> | null;
  sourceBlobSha?: string | null;
}

export type CommitResolution =
  | { ok: true; files: CommitFile[] }
  | { ok: false; stale: true; path: string; reason: string };

/**
 * Resolve a suggestion's change set into concrete commit files, re-checking
 * staleness for edits (Phase 1, 1.5): if the source blob moved since generation,
 * re-apply the hunks against the current content. If that fails, the branch
 * changed in a way the edit no longer fits — surface it rather than committing a
 * wrong or partial change. `create`/`delete` are stable and pass through.
 */
export async function resolveCommitFiles(
  files: ResolvableFile[],
  reader: FileReader,
): Promise<CommitResolution> {
  const out: CommitFile[] = [];
  for (const f of files) {
    if (f.op === "create") {
      out.push({ path: f.filePath, content: f.content });
      continue;
    }
    if (f.op === "delete") {
      out.push({ path: f.filePath, delete: true });
      continue;
    }

    // edit — verify the source hasn't moved since generation.
    const current = await reader(f.filePath);
    if (!current) {
      return { ok: false, stale: true, path: f.filePath, reason: "the file no longer exists" };
    }
    if (f.sourceBlobSha && current.sha === f.sourceBlobSha) {
      out.push({ path: f.filePath, content: f.content });
      continue;
    }
    // Blob changed (or SHA unknown): re-apply the hunks against current content.
    if (!f.hunks || f.hunks.length === 0) {
      return { ok: false, stale: true, path: f.filePath, reason: "the file changed and has no hunks to re-apply" };
    }
    const res = applyHunks(current.content, f.hunks);
    if (res.ok) {
      out.push({ path: f.filePath, content: res.content });
    } else {
      return { ok: false, stale: true, path: f.filePath, reason: res.reason };
    }
  }
  return { ok: true, files: out };
}

/** Message shown when a commit is blocked because the branch moved mid-run. */
export const STALE_BRANCH_MESSAGE = "The branch changed while this run was in progress.";
