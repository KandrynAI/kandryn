import type { SuggestionFile, SuggestionStats } from "../../../../shared/types/codeSuggestion.js";

/** Line count of a blob (0 for empty). */
export function countLines(content: string): number {
  return content ? content.split("\n").length : 0;
}

export function statsFor(files: SuggestionFile[]): SuggestionStats {
  return {
    filesChanged: files.length,
    added: files.reduce((n, f) => n + f.linesAdded, 0),
    removed: files.reduce((n, f) => n + f.linesRemoved, 0),
  };
}

/** The primary (first, by seq) file of a change set — the only file in Phase 0/1. */
export function primaryOf<T extends { filePath: string; content: string }>(
  files: T[],
): { filePath: string; code: string } | null {
  const f = files[0];
  return f ? { filePath: f.filePath, code: f.content } : null;
}
