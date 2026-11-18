/**
 * What a customer asked Kandryn to do with a repository when they connected it.
 *
 * The choice is made twice, in two different places, and it means slightly
 * different things in each:
 *
 *  - On `projects.setup_choice` it is a DEFAULT. The project wizard asks before
 *    a repository exists (the common path: a new customer has no repository to
 *    pick yet), so the answer is remembered and the connect form arrives with
 *    it already selected.
 *  - On `repositories.setup_choice` it is an INSTRUCTION, acted on once and
 *    then stamped with `setup_completed_at`.
 *
 * `index_scan_review` arrived with the whole-repository code review (0051). It
 * was deliberately absent until then, because an option that silently does
 * nothing is worse than an option not yet offered.
 */
export const REPO_SETUP_CHOICES = ["none", "index", "index_scan", "index_scan_review"] as const;

export type RepoSetupChoice = (typeof REPO_SETUP_CHOICES)[number];

/** The default when nobody chose: index, which is what connect already did. */
export const DEFAULT_SETUP_CHOICE: RepoSetupChoice = "index";

/**
 * Read a stored value back.
 *
 * Every row that predates the column reads as the default rather than as
 * `none`, because indexing on connect is what those repositories already got.
 * An unrecognised value also reads as the default: a column written by a newer
 * deploy and read by an older one must not turn into "do nothing".
 */
export function readSetupChoice(value: unknown): RepoSetupChoice {
  return REPO_SETUP_CHOICES.includes(value as RepoSetupChoice)
    ? (value as RepoSetupChoice)
    : DEFAULT_SETUP_CHOICE;
}

/** Whether this choice asks for the code graph to be built. */
export function wantsIndex(choice: RepoSetupChoice): boolean {
  return choice !== "none";
}

/** Whether this choice asks for a baseline security scan of the whole codebase. */
export function wantsBaselineScan(choice: RepoSetupChoice): boolean {
  return choice === "index_scan" || choice === "index_scan_review";
}

/** Whether this choice asks for a code review of the whole codebase (0051). */
export function wantsCodeReview(choice: RepoSetupChoice): boolean {
  return choice === "index_scan_review";
}

/**
 * Whether anything beyond the connect request itself is outstanding.
 *
 * The one predicate the connect routes use to decide whether to stamp
 * setup_completed_at immediately, so adding a future choice cannot leave a row
 * stamped complete with work still to do.
 */
export function needsDispatch(choice: RepoSetupChoice): boolean {
  return wantsBaselineScan(choice) || wantsCodeReview(choice);
}
