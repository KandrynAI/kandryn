/**
 * Homepage copy.
 *
 * Separate from site.ts because the homepage was rebuilt against a different
 * information architecture: the page carries one idea per section and defers
 * depth to a linked page, rather than summarising every page inline. site.ts
 * still holds the copy the inner pages share.
 *
 * Every claim here is one the verification pass confirmed against the running
 * product. Nothing asserts automatic scanning, enforced merge-blocking, model
 * vendors, speed, cost, or customers.
 */

/**
 * Which hero treatment is live.
 *
 * 'headline' types the h1 itself. 'snippet' leaves the h1 static and types a
 * short diff beneath it. Both are built; this picks the one that ships.
 */
export const HERO_VARIANT: 'headline' | 'snippet' = 'snippet';

export const HERO = {
  headline: 'Kandryn writes the code. Your team decides what merges.',
  // One line. Deliberately not a paragraph.
  supporting:
    'Kandryn writes only to the repository you connect — nothing merges without your authorization.',
  primary: { label: 'Book a walkthrough', href: '/contact' },
  secondary: { label: 'Explore the demo', href: '#preview' },
};

/**
 * The diff typed beneath the headline in the 'snippet' variant.
 *
 * Shaped like the change the demo below actually produces — a missing
 * validation check added to an endpoint — so the motion previews the product
 * rather than decorating the page. Labelled illustrative in the UI because it
 * is written for this space, not captured from a run.
 */
export const HERO_SNIPPET = {
  file: 'src/routes/refunds.ts',
  lines: [
    { op: ' ', text: 'export async function createRefund(req, res) {' },
    { op: '+', text: "  const key = req.header('Idempotency-Key');" },
    { op: '+', text: "  if (!key) return res.status(400).json({ error: 'idempotency_key_required' });" },
    { op: ' ', text: '' },
    { op: ' ', text: '  return await db.transaction(async (tx) => {' },
  ],
  caption: 'Illustrative — the same change the demo below walks through.',
};

export const PREVIEW = {
  title: 'One work item, one proposed change',
  lead:
    'A story from the board, the change Kandryn proposes for it, and the pull request it would open. Sample project — click through it.',
};

/**
 * Section 3 — jobs, not adjectives.
 *
 * Each is a task type the product genuinely handles: a scoped change to an
 * existing codebase, driven from one work item. Nothing here implies greenfield
 * work, autonomous refactors, or anything the change planner caps out of.
 */
export const USE_CASES = [
  {
    tag: 'STORY',
    title: 'Add an idempotency guard to an endpoint that never had one.',
  },
  {
    tag: 'TASK',
    title: 'Write the reporting query behind a column someone asked for.',
  },
  {
    tag: 'TASK',
    title: 'Add a field to a table, plus the migration that ships it.',
  },
  {
    tag: 'BUG',
    title: 'Cover an endpoint with the tests it went to production without.',
  },
];

export const USE_CASES_HEADING = 'Where Kandryn fits';
export const USE_CASES_LEAD =
  'Scoped work from a backlog you already keep — the tickets that are clear enough to do and never quite urgent enough to start.';

/**
 * Section 4. What Kandryn knows about the project before it writes.
 *
 * Every line here maps to a shipped feature in docs/marketing-claims.md: the
 * ancestor chain (0040), uploaded documents with per-run retrieval (0041), the
 * repository index and stack detection (Graphify + stack profile), the UI style
 * profile (0042), the per-run context manifest (0040) and run-order checking
 * (0038). Nothing here describes a domain model, and nothing is trained: the
 * documents are background, retrieved per run, and the acceptance criteria win.
 */
export const CONTEXT = {
  heading: 'Kandryn reads your project before it writes a line.',
  lead:
    'Kandryn indexes the repository when you connect it, and keeps that index current as commits land. You can add the architecture notes and requirements your team already wrote. Each run pulls only the parts that bear on the item in front of it.',
  points: [
    {
      title: 'Work item hierarchy',
      body: 'A story is read with the parent story and epic above it, not on its own.',
    },
    {
      title: 'Repository map',
      body: 'Structure, stack and existing styling are mapped when you connect the repository and mapped again after each commit, so generated code looks like it belongs.',
    },
    {
      title: 'Your documents',
      body: 'Upload what your team already wrote. Each run finds the passages that relate to the item. Documents are background. The acceptance criteria on the work item always win.',
    },
    {
      title: 'A record of what it used',
      body: 'Every run lists the context behind it, so a reviewer can see what informed the change.',
    },
  ],
  closing: 'Kandryn also checks run order, and records the reason when someone overrides it.',
};

export const STAGES = [
  {
    n: '01',
    title: 'Select scoped work',
    body: 'Point Kandryn at one item on your board. It reads the title, description and acceptance criteria, and pulls in the repository files that relate to them, before anything is written.',
  },
  {
    n: '02',
    title: 'Compare proposals',
    body: 'Two independent attempts at the same change, scored against each other on correctness, diff size and convention fit — with the reasoning shown.',
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
 * Section 5 — a pointer, not a summary.
 *
 * Reworded from the brief's draft, which read "Every change is
 * security-scanned and gated for review before it reaches your codebase."
 * The verification pass established that scanning is triggered per run rather
 * than automatic, and that blocking a merge requires a branch rule the customer
 * configures. The wording below claims only what the product does on its own.
 */
export const GOVERNANCE = {
  heading: 'Built to be reviewed',
  body:
    'Kandryn opens pull requests and never merges them. A security scan of the committed change posts a status check your branch rules can require before anyone can merge, and every action is written to an audit log your admins can read.',
  link: { label: 'See how Kandryn is governed', href: '/trust/' },
};

export const CLOSING = {
  headline: 'See it run on one of your own tickets.',
  body: 'A walkthrough on a real work item from your board — not a canned recording.',
  cta: { label: 'Book a walkthrough', href: '/contact' },
};
