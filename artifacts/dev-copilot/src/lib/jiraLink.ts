/**
 * The Jira link page's state machine and copy (0043, PR-B).
 *
 * Kept out of the `.tsx` so it can be tested — the dev-copilot runner strips
 * types but does not compile JSX, the same reason `knowledgeQueue.ts` and
 * `uiStyleView.ts` exist.
 *
 * Two rules the page inherits from the server and must not soften:
 *
 *  - **One message for every failure.** Wrong, expired, already used, never
 *    existed, rate-limited: all the same words. The server deliberately makes
 *    them indistinguishable, and a UI that said "expired" for one of them
 *    would hand a guesser the signal the API refuses to give.
 *  - **A code is never read from the URL.** Not a query parameter, not a hash,
 *    not a prefill. A clickable link is the attack this whole flow exists to
 *    prevent, so the page has no code input other than the person's keyboard.
 */

export type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; siteUrl: string | null }
  | { kind: "conflict" }
  | { kind: "failed" };

/** What the form shows under the input, and in what tone. */
export interface SubmitMessage {
  tone: "neutral" | "success" | "caution";
  text: string;
}

/** The one failure sentence. Identical for every cause, by design. */
export const FAILURE_TEXT = "That code did not work. Open the Kandryn panel in Jira to get a new one.";

export const SUCCESS_TEXT = "Connected. Go back to Jira and choose Check again.";

export const CONFLICT_TEXT =
  "That Jira account is already connected to a different Kandryn account. Disconnect it there first, or ask an administrator.";

export const TYPED_ONLY_WARNING =
  "Only enter a code that you generated yourself in the Kandryn panel in Jira. Never enter a code someone sent you.";

export function submitMessage(state: SubmitState): SubmitMessage | null {
  switch (state.kind) {
    case "success":
      return { tone: "success", text: SUCCESS_TEXT };
    // A conflict is the one case worth its own words: the person needs to stop
    // retyping a code that can never work. It says nothing about the code.
    case "conflict":
      return { tone: "caution", text: CONFLICT_TEXT };
    case "failed":
      return { tone: "caution", text: FAILURE_TEXT };
    default:
      return null;
  }
}

/**
 * Map a failed request to a state.
 *
 * Only 409 is distinguished. Every other status — 400, 403, 429, 500, a
 * network error with no status at all — collapses to `failed`, because the
 * server's whole contract is that those are not tellable apart.
 */
export function stateFromError(status: number | undefined): SubmitState {
  return status === 409 ? { kind: "conflict" } : { kind: "failed" };
}

/**
 * Whether Connect should be clickable.
 *
 * Length is not validated here: a code the person mistyped must still reach
 * the server, because the server is what counts the attempt. Blocking it
 * client-side would let someone probe codes without ever burning one.
 */
export function canSubmit(input: string, state: SubmitState): boolean {
  return input.trim().length > 0 && state.kind !== "submitting";
}

/** Trim only. The server normalizes case, spaces and dashes. */
export function prepareCode(input: string): string {
  return input.trim();
}

export interface JiraLinkRow {
  id: number;
  siteUrl: string | null;
  linkedAt: string;
}

export type ListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; links: JiraLinkRow[] };

export const EMPTY_LIST_TEXT = "No Jira accounts connected.";

/** "acme.atlassian.net", or a plain fallback when the site is not known. */
export function siteLabel(siteUrl: string | null): string {
  if (!siteUrl) return "Jira site";
  return siteUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** Newest first — the one just connected is the one being looked for. */
export function sortLinks(links: JiraLinkRow[]): JiraLinkRow[] {
  return [...links].sort((a, b) => {
    const diff = new Date(b.linkedAt).getTime() - new Date(a.linkedAt).getTime();
    return diff !== 0 ? diff : b.id - a.id;
  });
}

/**
 * A guard against the mistake this page is designed to prevent.
 *
 * The page must never take a code from the URL. This is asserted by a test
 * rather than left to reviewers noticing, because the failure is silent: a
 * prefilled field looks like a convenience and reopens the whole hole.
 */
export function codeFromLocation(_search: string, _hash: string): null {
  return null;
}
