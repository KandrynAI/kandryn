/**
 * Homepage copy.
 *
 * Separate from site.ts because the homepage carries one idea per section and
 * defers depth to a linked page, rather than summarising every page inline.
 * site.ts still holds the copy the inner pages share.
 *
 * Repositioned 2026-11-26: the page now leads with the outcome (improvements
 * delivered sooner) and names the mechanism (the business context behind a
 * change), rather than leading with the mechanism alone.
 *
 * Every claim here traces to a SHIPPED or PARTIAL row in
 * docs/marketing-claims.md, by letter. Nothing asserts automatic scanning,
 * enforced merge-blocking, model vendors, speed, cost, or customers.
 */

/**
 * Which hero treatment is live.
 *
 * 'headline' types the h1 itself. 'snippet' leaves the h1 static and renders
 * the preview card beside it. Both are built; this picks the one that ships.
 */
export const HERO_VARIANT: 'headline' | 'snippet' = 'snippet';

export const HERO = {
  headline: 'Deliver business improvements sooner.',
  supporting:
    'Kandryn builds and maintains the business context behind each software request. It brings together your requirements, business rules, and existing code to prepare a change for review, so your team can spend less time piecing the story together.',
  primary: { label: 'Request a walkthrough', href: '/contact' },
  secondary: { label: 'Explore a sample change', href: '#preview' },
};

/**
 * The card beside the headline.
 *
 * It replaced a typed code diff. The diff showed the output to someone who
 * already knew what they were looking at; this shows the shape of the problem
 * to someone who does not. Three rows in the order the work happens, then the
 * worked number, because the number is the argument: the same claim reads as
 * six days or three depending on whether the rule reached the code, and no
 * amount of describing that is as convincing as showing it.
 *
 * The card carried the word "fictional" twice and a citation, "section 4.2".
 * The word was there to defuse the citation, which is the one shape a reader
 * assumes is real. The citation is gone, so the word is not needed: there is
 * no company, no document and no section number left to mistake for a
 * customer's. What remains is a worked example, labelled as an example, built
 * from a rule of a kind every claims operation has.
 */
export const HERO_PREVIEW = {
  label: 'Example',
  tag: 'CLAIMS',
  rows: [
    { k: 'The request', v: 'Show how long each claim has spent in review.' },
    {
      k: 'What the ticket does not say',
      v: 'The review clock pauses while the team is waiting on information it asked the customer for.',
    },
    {
      k: 'What that changes',
      v: 'Count the time a claim spends in review states, not the days it has been open.',
    },
  ],
  // The same claim, scored both ways. Six days open: two in review, three
  // waiting on the customer, one more in review.
  worked: {
    lead: 'A claim open six days: two in review, three waiting on the customer, one more in review.',
    without: { label: 'Without the rule', value: '6 days' },
    with: { label: 'With it', value: '3 days' },
  },
  source: 'The rule lives in a claims operating policy. The ticket does not mention it.',
  link: { label: 'See a sample change', href: '#preview' },
};

export const PREVIEW = {
  title: 'One work item, one proposed change',
  lead:
    'A story from the board, the change Kandryn proposes for it, and the pull request it would open. Sample project. Click through it.',
};

/**
 * Section 2. The three capabilities, in buyer language, each tied to a step of
 * the delivery the sponsor is waiting on.
 *
 * Ledger rows a, b, c, d, e, f and p. The third point is the one that needed
 * the most care: the repository map is refreshed after a commit, but the
 * refresh is queued and drained by a scheduled sweep rather than running at
 * the moment of the commit, so the copy says "after commits land" and never
 * "instantly". What the customer keeps current themselves is stated outright,
 * because nothing in the product re-checks an uploaded document against the
 * code.
 */
export const CONTEXT = {
  heading: 'How business context speeds up delivery',
  lead:
    'A request arrives as a ticket that holds part of the story. The objective sits in a parent initiative, a rule sits in a document, and the existing code decides how that rule is applied today. Kandryn brings those pieces together before anyone starts writing.',
  points: [
    {
      title: 'Identify the context',
      body: 'Kandryn follows a work item up to its parent story and initiative, and finds the repository files, document passages and existing behaviour that bear on it. The team starts from a change whose meaning was spread across several places.',
    },
    {
      title: 'Build the context for the change',
      body: 'Those inputs are combined with the acceptance criteria on the ticket to prepare a proposal. A documented exception can change the implementation. Where background material and the acceptance criteria disagree, the acceptance criteria win.',
    },
    {
      title: 'Keep context current',
      body: 'The repository map is refreshed after commits land, and context is selected fresh for every run rather than stored and reused. Each run records which inputs informed it, as identifiers and counts. You keep two things current yourself: the documents you upload, and the parent hierarchy in your tracker.',
    },
  ],
  closing: 'Kandryn also checks run order, and records the reason when someone overrides it.',
  link: { label: 'The full pipeline, stage by stage', href: '/how-it-works' },
};

/**
 * Section 4 - where it fits.
 *
 * Replaced four mechanical examples (an idempotency guard, a reporting query,
 * a column plus migration, missing tests) with work a business sponsor
 * recognises. Each is still scoped, still driven from one work item, and still
 * something the change planner can hold. The industries are the first two
 * Kandryn is selling into. No real company names.
 */
export const USE_CASES = [
  {
    tag: 'REPORTING',
    title: 'Change how a report counts time, when the rule says some of it does not count.',
  },
  {
    tag: 'ELIGIBILITY',
    title: 'Apply a documented exception that sends some applications to a second approver.',
  },
  {
    tag: 'VALIDATION',
    title: 'Enforce a rule at the point of entry that is written down but not in the code.',
  },
  {
    tag: 'COVERAGE',
    title: 'Write the tests for a rule the business depends on and nobody has covered.',
  },
];

export const USE_CASES_HEADING = 'Where Kandryn fits';
export const USE_CASES_LEAD =
  'Scoped work whose meaning depends on something written outside the ticket. The requests that are clear enough to do and never quite urgent enough to start.';

export const STAGES = [
  {
    n: '01',
    title: 'Select scoped work',
    body: 'Point Kandryn at one item on your board. It reads the title, description and acceptance criteria, and pulls in the repository files that relate to them, before anything is written.',
  },
  {
    n: '02',
    title: 'Compare proposals',
    body: 'Two independent attempts at the same change, scored against each other on correctness, diff size and convention fit, with the reasoning shown.',
  },
  {
    n: '03',
    title: 'Review the change',
    body: 'The one you choose becomes a branch, a commit and a pull request. Your normal review and your normal CI take it from there.',
  },
];

export const STAGES_HEADING = 'How it works';
export const STAGES_LINK = { label: 'The full pipeline, stage by stage', href: '/how-it-works' };

/**
 * Section 5 - built to be reviewed.
 *
 * Claims only what the product does on its own: scanning is triggered per run
 * rather than automatic, and blocking a merge requires a branch rule the
 * customer configures. "Your team decides what merges" moved here out of the
 * old headline, where it was answering a question the visitor had not asked
 * yet. This is where it answers one.
 */
export const GOVERNANCE = {
  heading: 'Built to be reviewed',
  body:
    'A change reaches your repository when someone commits it. Kandryn opens a pull request on its own branch and never merges it. Run the security scan on a committed change and it posts a status check your branch rules can require before anyone can merge. Every action is written to an audit log your admins can read.',
  pull: 'Your team decides what merges.',
  link: { label: 'See how Kandryn is governed', href: '/trust/' },
};

export const CLOSING = {
  headline: 'Start with one work item.',
  body: 'Bring a ticket whose meaning depends on something written elsewhere. We will run it end to end with you and you keep whatever it produces.',
  cta: { label: 'Pilot on one work item', href: '/pilot' },
  secondary: { label: 'Request a walkthrough', href: '/contact' },
};
