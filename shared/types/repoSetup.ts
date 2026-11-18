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
 * `index_scan_review` is deliberately absent until the whole-repository code
 * review exists. An option that silently does nothing is worse than an option
 * that is not offered yet.
 */
export const REPO_SETUP_CHOICES = ["none", "index", "index_scan"] as const;

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
  return choice === "index" || choice === "index_scan";
}

/** Whether this choice asks for a baseline security scan of the whole codebase. */
export function wantsBaselineScan(choice: RepoSetupChoice): boolean {
  return choice === "index_scan";
}
