/**
 * Search/replace hunk application for operation-based edits (Phase 1).
 *
 * Rules (deliberately strict — a wrong edit is worse than a failed one):
 *  - Line endings are normalised to \n before matching; the file's original
 *    ending style is detected and restored on output (this repo is developed on
 *    Windows, so CRLF/LF mismatches must not cause silent match failures).
 *  - Exact substring match only. No fuzzy or whitespace-insensitive fallback.
 *  - A search must occur exactly once: zero → no_match, two+ → multiple_matches.
 *  - All hunks are located against the ORIGINAL text's offsets; overlapping
 *    ranges are rejected. Replacements are then spliced by offset, so one hunk
 *    never shifts another's match.
 */

export interface Hunk {
  search: string;
  replace: string;
}

export type ApplyResult =
  | { ok: true; content: string }
  | {
      ok: false;
      failedIndex: number;
      reason: "no_match" | "multiple_matches" | "overlap";
      search: string;
    };

/** The dominant line ending of a blob (CRLF if any \r\n is present). */
export function detectEol(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function applyHunks(original: string, hunks: Hunk[]): ApplyResult {
  const eol = detectEol(original);
  const text = toLf(original);

  // 1. Locate every hunk against the original text; enforce uniqueness.
  const ranges: Array<{ index: number; start: number; end: number; replace: string }> = [];
  for (let i = 0; i < hunks.length; i++) {
    const search = toLf(hunks[i].search);
    const first = text.indexOf(search);
    if (first === -1) {
      return { ok: false, failedIndex: i, reason: "no_match", search: hunks[i].search };
    }
    const second = text.indexOf(search, first + Math.max(search.length, 1));
    if (second !== -1) {
      return { ok: false, failedIndex: i, reason: "multiple_matches", search: hunks[i].search };
    }
    ranges.push({ index: i, start: first, end: first + search.length, replace: toLf(hunks[i].replace) });
  }

  // 2. Reject overlapping ranges (checked on the original offsets).
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].start < sorted[k - 1].end) {
      return {
        ok: false,
        failedIndex: sorted[k].index,
        reason: "overlap",
        search: hunks[sorted[k].index].search,
      };
    }
  }

  // 3. Splice replacements by offset.
  let out = "";
  let cursor = 0;
  for (const r of sorted) {
    out += text.slice(cursor, r.start) + r.replace;
    cursor = r.end;
  }
  out += text.slice(cursor);

  return { ok: true, content: eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out };
}

/** A human-readable, UI-facing reason for a failed apply (includes the search block). */
export function applyErrorMessage(res: Extract<ApplyResult, { ok: false }>, path: string): string {
  const label =
    res.reason === "no_match"
      ? `The text below was expected in ${path} but was not found.`
      : res.reason === "multiple_matches"
        ? `The text below matches more than once in ${path}; it needs more surrounding context to be unique.`
        : `This change overlaps another change to ${path}.`;
  return `${label}\n\n${res.search}`;
}
