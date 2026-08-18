import type { SuggestionFile, SuggestionStats } from "../../../../shared/types/codeSuggestion.js";

/** Line count of a blob (0 for empty). */
export function countLines(content: string): number {
  return content ? content.split("\n").length : 0;
}

/**
 * Build a one-file change set from a single generated blob (Phase 0 — the model
 * still emits exactly one file). op='create', seq=0.
 */
export function singleFileChangeSet(filePath: string, content: string): SuggestionFile[] {
  return [
    {
      seq: 0,
      op: "create",
      filePath,
      content,
      hunks: null,
      resolved: true,
      applyStatus: "pending",
      applyError: null,
      linesAdded: countLines(content),
      linesRemoved: 0,
    },
  ];
}

export function statsFor(files: SuggestionFile[]): SuggestionStats {
  return {
    filesChanged: files.length,
    added: files.reduce((n, f) => n + f.linesAdded, 0),
    removed: files.reduce((n, f) => n + f.linesRemoved, 0),
  };
}

/** The file(s) to write in a commit — create/edit contribute content; delete is skipped in Phase 0. */
export function filesToCommit(
  files: Array<{ op: string; filePath: string; content: string }>,
): Array<{ path: string; content: string }> {
  return files.filter((f) => f.op !== "delete").map((f) => ({ path: f.filePath, content: f.content }));
}

/** The primary (first, by seq) file of a change set — the only file in Phase 0. */
export function primaryOf<T extends { filePath: string; content: string }>(
  files: T[],
): { filePath: string; code: string } | null {
  const f = files[0];
  return f ? { filePath: f.filePath, code: f.content } : null;
}
