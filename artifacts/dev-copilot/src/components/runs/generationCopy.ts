/**
 * Copy for the in-progress generation view, and only that view.
 *
 * The backend exposes no stage/phase field (see runs schema), so these lines are
 * keyed to elapsed-time bands rather than to real pipeline stages — a band says
 * roughly how long this has been going, which is true, and never claims to know
 * which step an agent is on, which would not be. The honest facts (file names,
 * elapsed time, stack) are rendered above these lines, not replaced by them.
 *
 * Nothing here is imported by the failed/canceled branches. Wit next to an error
 * reads as the product not understanding what just happened to you.
 */

export interface CopyBand {
  /** Lower bound in seconds, inclusive. Bands are checked newest-first. */
  fromSeconds: number;
  lines: string[];
}

/** Ordered low → high; `bandFor` walks it in reverse. */
export const COPY_BANDS: CopyBand[] = [
  {
    fromSeconds: 0,
    lines: [
      "Teaching Raptia to read your codebase's handwriting",
      "Both agents just opened the same three files. This will get competitive",
      "Reading the plan twice, the way you'd hope someone would",
      "Working out which conventions you actually follow, not the ones in the README",
      "Fovea is forming an opinion. Raptia already has three",
      "Loading context. The good kind, not the 200k-token kind",
      "Establishing what done looks like before writing anything",
      "Skimming the acceptance criteria like they matter, because they do",
    ],
  },
  {
    fromSeconds: 30,
    lines: [
      "Fovea is arguing with itself about naming conventions",
      "Raptia has written the easy part and is now staring at the hard part",
      "Somewhere in here a variable is being renamed for the fourth time",
      "Both agents independently decided your existing pattern was worth keeping",
      "Writing the code, then reading it back like a reviewer would",
      "Fovea took the scenic route through a related file. It usually pays off",
      "Resisting the urge to refactor something you didn't ask about",
      "Raptia is being precise. Fovea is being thorough. Neither is wrong",
    ],
  },
  {
    fromSeconds: 120,
    lines: [
      "Still going. Bigger change sets take longer, and this one earned it",
      "Nobody has crashed. This is just what careful looks like",
      "Raptia and Fovea are both past the point of showing off",
      "Long runs usually mean a lot of context, not a lot of trouble",
      "Two full implementations, written independently. That takes a minute",
      "Synthesia doesn't get to score anything until both finish",
      "Still writing. You'll get a ranked shortlist, not a coin flip",
      "Taking its time on the file you'd have taken time on too",
    ],
  },
];

/** The band covering `seconds` elapsed. Never returns undefined — band 0 is the floor. */
export function bandFor(seconds: number): CopyBand {
  for (let i = COPY_BANDS.length - 1; i >= 0; i--) {
    if (seconds >= COPY_BANDS[i].fromSeconds) return COPY_BANDS[i];
  }
  return COPY_BANDS[0];
}

/**
 * Shuffled-without-replacement rotation: every line in a band is shown once
 * before any repeats, so a long run doesn't loop the same two jokes. Re-shuffles
 * when exhausted, and starts a fresh cycle whenever the band changes.
 */
export function makeRotation(lines: string[]): () => string {
  let queue: string[] = [];
  return () => {
    if (queue.length === 0) {
      queue = [...lines];
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    return queue.pop()!;
  };
}

/** "0:07" / "4:31" — elapsed, not a countdown, because we can't predict the end. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
