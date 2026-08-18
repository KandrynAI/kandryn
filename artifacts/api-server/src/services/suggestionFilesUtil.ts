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

/**
 * Render a whole change set (all files, with op + resolved content) for the
 * synthesis prompts, so a multi-file suggestion is scored on its entire change
 * — not just its first file (Phase 2).
 */
export function renderChangeSet(files: SuggestionFile[], maxCharsPerFile = 4000): string {
  if (files.length === 0) return "(no files)";
  return files
    .map((f) => {
      const head = `--- ${f.op} ${f.filePath} ---`;
      if (f.op === "delete") return `${head}\n(file deleted)`;
      return `${head}\n${(f.content ?? "").slice(0, maxCharsPerFile)}`;
    })
    .join("\n\n");
}
