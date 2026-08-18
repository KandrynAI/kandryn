import { structuredPatch, diffWordsWithSpace } from "diff";
import type { DiffHunk, DiffLine } from "../../../../shared/types/codeSuggestion.js";

// Include every unchanged line in the diff so the client can collapse/expand
// context without ever needing the original file content (spec 3.3 / "the UI
// must not compute diffs client-side"). jsdiff clamps this to the file length.
const FULL_CONTEXT = 1_000_000;

function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Word-level ranges of the changed tokens between a paired del/add line. */
function computeIntraline(oldLine: string, newLine: string): {
  oldRanges: Array<[number, number]>;
  newRanges: Array<[number, number]>;
} {
  const oldRanges: Array<[number, number]> = [];
  const newRanges: Array<[number, number]> = [];
  let oldPos = 0;
  let newPos = 0;
  for (const part of diffWordsWithSpace(oldLine, newLine)) {
    const len = part.value.length;
    if (part.added) {
      newRanges.push([newPos, newPos + len]);
      newPos += len;
    } else if (part.removed) {
      oldRanges.push([oldPos, oldPos + len]);
      oldPos += len;
    } else {
      oldPos += len;
      newPos += len;
    }
  }
  return { oldRanges, newRanges };
}

/**
 * Pair each run of consecutive `del` lines with the `add` lines that follow it
 * and attach token-level intraline ranges. A pure add or pure del run (e.g. a
 * created file — every line an addition) is left alone.
 */
function attachIntraline(lines: DiffLine[]): void {
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== "del") {
      i++;
      continue;
    }
    let d = i;
    while (d < lines.length && lines[d].type === "del") d++;
    let a = d;
    while (a < lines.length && lines[a].type === "add") a++;
    const dels = lines.slice(i, d);
    const adds = lines.slice(d, a);
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const { oldRanges, newRanges } = computeIntraline(dels[k].content, adds[k].content);
      if (oldRanges.length) dels[k].intraline = oldRanges;
      if (newRanges.length) adds[k].intraline = newRanges;
    }
    i = a > i ? a : i + 1;
  }
}

/**
 * Structured, server-computed diff between two file versions (Phase 1 PR2).
 * Returns full-context hunks (all unchanged lines included) plus accurate
 * added/removed counts. Intraline highlighting is attached for modified lines.
 */
export function computeFileDiff(
  oldContent: string,
  newContent: string,
): { hunks: DiffHunk[]; linesAdded: number; linesRemoved: number } {
  const patch = structuredPatch("a", "b", toLf(oldContent), toLf(newContent), "", "", {
    context: FULL_CONTEXT,
  });

  let linesAdded = 0;
  let linesRemoved = 0;

  const hunks: DiffHunk[] = patch.hunks.map((h) => {
    const lines: DiffLine[] = [];
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const raw of h.lines) {
      const marker = raw[0];
      const content = raw.slice(1);
      if (marker === "\\") continue; // "\ No newline at end of file"
      if (marker === "-") {
        lines.push({ type: "del", oldNumber: oldNo++, newNumber: null, content });
        linesRemoved++;
      } else if (marker === "+") {
        lines.push({ type: "add", oldNumber: null, newNumber: newNo++, content });
        linesAdded++;
      } else {
        lines.push({ type: "context", oldNumber: oldNo++, newNumber: newNo++, content });
      }
    }
    attachIntraline(lines);
    return {
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines,
    };
  });

  return { hunks, linesAdded, linesRemoved };
}
