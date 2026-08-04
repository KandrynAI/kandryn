// All marketing copy, mock data and static arrays live here. Components import
// from this file and never inline strings. (Rebuild spec — site.ts.)

export const SITE = {
  name: 'Blue Mantis',
  tagline: 'An AI delivery assistant for teams whose backlog is bigger than their week.',
  domain: 'getbluemantis.com',
  email: 'sales@bluemantis.io',
};

export const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'Resources', href: '/resources' },
  { label: 'Security', href: '/security' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Contact', href: '/contact' },
];

export const HERO_STATS = [
  { value: 'Epic → PR', body: 'One thread from the work item to the branch, the commit and the review.' },
  { value: '2 agents', body: 'Raptia and Fovea run in parallel; Synthesis ranks the answers.' },
  { value: 'Every 5 min', body: 'The dispatcher claims scheduled runs around the clock, then emails you the result.' },
  { value: 'Tests too', body: 'Given/When/Then cases pushed back to the tracker, the script stacked on the same PR.' },
];

export const STEPS = [
  { n: '01', title: 'Connect', body: 'Paste your GitHub and tracker credentials. They are stored against your user, never shared.' },
  { n: '02', title: 'Bind a project', body: 'A three-step wizard ties one tracker project to one repository, validating both live.' },
  { n: '03', title: 'Sync', body: 'The epic→story→task tree lands on a board, parents resolved, closed items cleaned up.' },
  { n: '04', title: 'Author', body: 'Write items locally or push them upstream, or have an epic broken down into children you approve.' },
  { n: '05', title: 'Run', body: 'Now, or scheduled up to thirty days out. Two agents, one ranked shortlist.' },
  { n: '06', title: 'Commit', body: 'The chosen suggestion becomes a branch, a commit and a pull request; the item moves to review.' },
  { n: '07', title: 'Test', body: 'Given/When/Then cases and a runnable script, stacked onto the same pull request.' },
  { n: '08', title: 'Repeat', body: 'The dispatcher sweeps every five minutes and emails you when a scheduled run lands.' },
];

export const HOW_SECTIONS = [
  {
    n: 'STAGE 01', title: 'Context',
    body: 'Before an agent sees anything, the run assembles the case file: the work item, its parents, the acceptance criteria, and the files in the bound repository that the keyword extractor judges relevant. The detected stack profile rides along, so the agent writes Express and Drizzle rather than generic pseudocode.',
    detailLabel: 'WHAT GOES IN',
    details: ['Work item title, description and acceptance criteria', 'The epic and story above it, for intent', 'Relevant repository files and the detected stack', 'Your refinement prompt, if you wrote one'],
  },
  {
    n: 'STAGE 02', title: 'Two answers',
    body: 'Raptia and Fovea run in parallel against the same case file. They reason differently by design — when one misreads the acceptance criteria, the other usually does not.',
    detailLabel: 'WHY PARALLEL',
    details: ['One shared context, two independent reasoning paths', 'No sequential prompting, so no shared blind spot', 'Either answer is committable — Synthesis tells you which', 'Both are kept on the run for later comparison'],
  },
  {
    n: 'STAGE 03', title: 'Ranking',
    body: 'Synthesis scores each suggestion on stack fit, blast radius and how much of the acceptance criteria it actually covers, then flags the leader as Recommended. The score is visible; you are free to disagree with it.',
    detailLabel: 'SCORED ON',
    details: ["Fit with the repository's existing patterns", 'Size and reach of the change', 'Coverage of the stated acceptance criteria', 'Whether it invents APIs that do not exist'],
  },
  {
    n: 'STAGE 04', title: 'Commit',
    body: 'Committing creates the deterministic branch task/<id>, writes the change, and opens a pull request titled with the work item. The item moves to review and the run records which suggestion won.',
    detailLabel: 'WHAT LANDS',
    details: ['Branch task/<id>, from the default-branch head', 'One commit containing the chosen suggestion', 'PR titled [Blue Mantis] <work item title>', 'Work item moved to review, run marked succeeded'],
  },
  {
    n: 'STAGE 05', title: 'Schedule and sweep',
    body: 'A run can be queued up to thirty days out. Every five minutes the dispatcher claims what is due, runs it, and emails you the outcome — including the failures, with the reason attached.',
    detailLabel: 'THE LOOP',
    details: ['Up to twenty pending runs per user', 'Claimed two at a time, no double-dispatch', 'Runs stuck over twenty minutes are failed', 'Completion and failure both send email'],
  },
];

export const ATTENTION = [
  { value: '30 sec', body: 'Opening the panel, writing a refinement line, pressing Run.' },
  { value: '2 answers', body: 'What comes back to review — not a transcript, not a chat log.' },
  { value: '1 review', body: 'The pull request, in the tool you already review pull requests in.' },
];

export const INTEGRATIONS = [
  { name: 'Jira', tag: 'TRACKER', body: 'Syncs the epic→story→task hierarchy into a board, resolves parents in two passes, and writes new items and test cases back when you ask it to.', creds: 'JIRA_DOMAIN · JIRA_EMAIL · JIRA_API_TOKEN', note: 'Uses the enhanced JQL search endpoint; your domain is normalised for you.' },
  { name: 'Azure DevOps', tag: 'TRACKER', body: 'The same sync against Azure Boards, with Feature mapped onto epic so the hierarchy lines up with Jira projects.', creds: 'AZURE_DEVOPS_ORG · AZURE_DEVOPS_PROJECT · AZURE_DEVOPS_PAT', note: 'Work-item creation and test-case push both supported.' },
  { name: 'GitHub', tag: 'PRIMARY REPO', body: 'Branch, commit and pull request. Stack detection reads the repository on connect, and the test-script commit stacks onto the existing PR rather than overwriting it.', creds: 'GITHUB_TOKEN (PAT) or the OAuth token from sign-in', note: 'The primary provider, and the one we test first on every release.' },
  { name: 'Azure Repos', tag: 'REPO', body: 'Commits and pull requests against an existing file tree, for teams whose code lives beside their boards.', creds: 'AZURE_REPOS_ORG · AZURE_REPOS_TOKEN', note: 'Edits to existing files are reliable; brand-new file adds can fail.' },
  { name: 'Raptia', tag: 'AGENT', body: 'The first of two agents that runs on every Blue Mantis pipeline. Raptia is optimised for precision — it reads the work item, the acceptance criteria, and the repository context, then commits to a single well-reasoned answer.', creds: 'Configured automatically — no separate credential needed', note: 'Raptia and Fovea always run together. You cannot run one without the other.' },
  { name: 'Fovea', tag: 'AGENT', body: 'The second agent. Fovea takes a wider view of the same context — it considers more of the repository before settling on an approach, which means it often catches what Raptia misses.', creds: 'Configured automatically — no separate credential needed', note: 'The Synthesis engine scores both agents and flags the stronger answer.' },
];

export const CAPABILITY_MATRIX = [
  { cap: 'Read hierarchy', jira: 'Yes', ado: 'Yes', gh: '—', ar: '—' },
  { cap: 'Create work items', jira: 'Yes', ado: 'Yes', gh: '—', ar: '—' },
  { cap: 'Push test cases', jira: 'Yes', ado: 'Yes', gh: '—', ar: '—' },
  { cap: 'Status write-back', jira: 'On close', ado: 'On close', gh: '—', ar: '—' },
  { cap: 'Branch and commit', jira: '—', ado: '—', gh: 'Yes', ar: 'Existing files' },
  { cap: 'Open pull request', jira: '—', ado: '—', gh: 'Yes', ar: 'Yes' },
  { cap: 'Stack detection', jira: '—', ado: '—', gh: 'Yes', ar: 'Yes' },
];

export const RESOURCES = [
  { kind: 'GUIDE', cat: 'Guides', meta: '9 min', title: 'Connecting Jira without over-scoping the token', body: 'The three Jira permissions Blue Mantis needs, and the four it will never ask for.', cta: 'Read' },
  { kind: 'GUIDE', cat: 'Guides', meta: '12 min', title: 'From epic to eight children in one breakdown', body: 'How to review an AI breakdown quickly: what to accept, what to rewrite, what to delete outright.', cta: 'Read' },
  { kind: 'PATTERN', cat: 'Patterns', meta: '6 min', title: 'Refinement prompts that survive code review', body: 'Short, repository-specific instructions beat long style essays. Nine examples with their diffs.', cta: 'Read' },
  { kind: 'PATTERN', cat: 'Patterns', meta: '7 min', title: 'When to switch auto-commit on', body: 'A rule of thumb: auto-commit for mechanical work, review-first for anything touching money or auth.', cta: 'Read' },
  { kind: 'ENGINEERING', cat: 'Engineering', meta: '11 min', title: 'How Synthesis ranks two answers', body: 'Scoring on stack fit, blast radius and test surface — and why the second answer sometimes wins.', cta: 'Read' },
  { kind: 'ENGINEERING', cat: 'Engineering', meta: '8 min', title: 'Scheduling, dispatch and the five-minute sweep', body: 'What happens between pressing Schedule and finding a pull request the next morning.', cta: 'Read' },
  { kind: 'TEMPLATE', cat: 'Templates', meta: 'Download', title: 'Acceptance-criteria template for agent runs', body: 'A Given/When/Then skeleton that maps cleanly onto generated tests.', cta: 'Get it' },
  { kind: 'TEMPLATE', cat: 'Templates', meta: 'Download', title: 'Pilot checklist for the first two weeks', body: 'What to instrument, which items to point it at, and how to tell whether it is working.', cta: 'Get it' },
  { kind: 'POSTMORTEM', cat: 'Engineering', meta: '10 min', title: 'Runs that failed, and why', body: 'Expired tokens, ambiguous tickets, a rebase that ate a commit. What we changed after each.', cta: 'Read' },
];

export const QUICKSTART = [
  { n: '01', title: 'Connect your credentials', body: 'Tracker and repository credentials, tested as you save them.', time: '5 min' },
  { n: '02', title: 'Bind your first project', body: 'One tracker project to one repository, validated live.', time: '2 min' },
  { n: '03', title: 'Sync and read the board', body: 'The hierarchy arrives; check the parents look right.', time: '1 min' },
  { n: '04', title: 'Run one small item', body: 'Pick something mechanical for the first run, not the payments rewrite.', time: '4 min' },
  { n: '05', title: 'Review the pull request', body: 'Normal review, normal CI. Nothing merges itself.', time: 'Your call' },
];

export const CHANGELOG = [
  { date: '2026-07-24', title: 'Test scripts stack on the open PR', body: 'The generated script now commits onto the branch head instead of the default branch.' },
  { date: '2026-07-11', title: 'Scheduled runs email on failure', body: 'Failures carry the reason and a link straight to the run.' },
  { date: '2026-06-29', title: 'Epic breakdown is editable before it saves', body: 'Proposals arrive as rows you can rewrite, retype or delete.' },
  { date: '2026-06-15', title: 'Duplicate project bindings return a friendly 409', body: 'With a link to the project that already holds the binding.' },
];

export const SECURITY_PRINCIPLES = [
  { title: 'Credentials are per user', body: 'Every key is stored against your user record in an isolated config table. There is no shared pool, no fallback to an environment variable in production, and no key is ever written to a log line.' },
  { title: 'Every query is scoped', body: 'Projects, work items, runs and suggestions are all filtered by user on every read and write. There is no global collection a bug could expose.' },
  { title: 'Write access is narrow', body: 'Blue Mantis creates branches, commits and pull requests. It does not merge, force-push, or touch your default branch.' },
  { title: 'The tracker stays yours', body: 'Items and test cases are pushed only when you ask. The single automatic write-back is a status change when an item closes.' },
  { title: 'Agents see a case file, not a repository', body: 'Only the files selected as relevant to the work item, plus the detected stack profile, are passed to the agent pipeline — scoped to the files selected as relevant to the work item.' },
  { title: 'Failures are contained', body: 'A run that fails records the error and stops. Nothing half-written reaches your repository, and stuck runs are swept after twenty minutes.' },
];

export const PROCESSORS = [
  { name: 'Supabase (Postgres)', purpose: 'Application database', sees: 'Work items, runs, suggestions, your encrypted-at-rest config' },
  { name: 'Clerk', purpose: 'Authentication', sees: 'Email, session, OAuth identity' },
  { name: 'Blue Mantis Agent Pipeline', purpose: 'Code generation', sees: 'The case file for a run — work item, acceptance criteria, and selected repository files' },
  { name: 'Resend', purpose: 'Transactional email', sees: 'Your address and the run outcome' },
];

export const FAQS = [
  { q: 'Does Blue Mantis merge code?', a: 'No. It creates a branch named task/<id>, commits the suggestion you chose, and opens a pull request. Merging stays with your review rules and your CI.' },
  { q: 'Whose API keys does it use?', a: 'Tracker credentials (Jira, Azure DevOps) and repository credentials (GitHub, Azure Repos) are stored per user, tested when you save them, and never written to a log line. Agent infrastructure is managed by Blue Mantis.' },
  { q: 'How much of my repository do the agents see?', a: 'The files the keyword extractor selects as relevant to the work item, plus the detected stack profile. Not the whole tree, and nothing outside the repository you bound to the project.' },
  { q: 'What happens if a scheduled run fails?', a: 'The run row records the error, the item is left untouched, and the owner gets an email. Runs stuck longer than twenty minutes are swept to failed by the dispatcher.' },
  { q: 'Can it write to my tracker?', a: 'Only where you ask it to: new items and test cases you explicitly push, and a status change when an item closes. Nothing else propagates upstream.' },
  { q: 'Which providers work best?', a: 'GitHub is the primary, auto-synced provider. Azure Repos works for edits to existing files; adding a brand-new file can fail there.' },
  { q: 'Two agents — why not one?', a: 'Raptia and Fovea reason differently by design. Running both in parallel and ranking the results gives Synthesis something to compare — and gives you a second option when the first answer is wrong.' },
  { q: 'Can I try it on one project?', a: 'That is how every pilot starts: one tracker project, one repository, one real work item run end to end on a shared call.' },
];

export const FOOTER_COLS = [
  { title: 'PRODUCT', links: [{ label: 'How it works', href: '/how-it-works' }, { label: 'Integrations', href: '/integrations' }, { label: 'Security', href: '/security' }, { label: 'FAQ', href: '/faq' }] },
  { title: 'RESOURCES', links: [{ label: 'Guides', href: '/resources' }, { label: 'Patterns', href: '/resources' }, { label: 'Changelog', href: '/resources' }, { label: 'Templates', href: '/resources' }] },
  { title: 'COMPANY', links: [{ label: 'Request access', href: '/contact' }, { label: 'Book a walkthrough', href: '/contact' }, { label: 'Contact', href: '/contact' }, { label: 'Home', href: '/' }] },
];

// Demo mock data — used only in DemoSection (client component, no API calls)
export const DEMO_BOARD_ITEMS = [
  { key: 'PAY-201', type: 'EPIC', title: 'Refunds hardening', plmStatus: 'In Progress', col: 'progress', canRun: false },
  { key: 'PAY-214', type: 'STORY', title: 'Idempotency keys on the refund endpoint', plmStatus: 'To Do', col: 'open', canRun: true },
  { key: 'PAY-218', type: 'TASK', title: 'Backfill ledger entries for partial refunds', plmStatus: 'To Do', col: 'open', canRun: true },
  { key: 'PAY-221', type: 'BUG', title: 'Webhook retries duplicate the refund event', plmStatus: 'To Do', col: 'open', canRun: true },
  { key: 'PAY-209', type: 'TASK', title: 'Split the settlement worker by provider', plmStatus: 'In Progress', col: 'progress', canRun: true },
  { key: 'PAY-196', type: 'STORY', title: 'Card-network response codes on the receipt', plmStatus: 'In Review', col: 'review', canRun: false },
  { key: 'PAY-188', type: 'TASK', title: 'Rotate the Stripe webhook secret', plmStatus: 'Done', col: 'done', canRun: false },
  { key: 'PAY-174', type: 'STORY', title: 'Refund reason codes in the admin view', plmStatus: 'Done', col: 'done', canRun: false },
  { key: 'PAY-160', type: 'TASK', title: 'Drop the legacy /v1/refund alias', plmStatus: 'Done', col: 'done', canRun: false },
];

export const DEMO_CODE_RAPTIA = `export async function createRefund(req, res) {
  const key = req.header('Idempotency-Key');
  if (!key) return res.status(400).json({ error: 'idempotency_key_required' });

  const existing = await db.query.refunds.findFirst({
    where: and(eq(refunds.userId, req.userId), eq(refunds.idempotencyKey, key)),
  });
  if (existing) return res.status(200).json(existing);

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(refunds).values({ ...req.body, idempotencyKey: key }).returning();
    await tx.insert(ledger).values(entriesFor(row));
    return res.status(201).json(row);
  });
}`;

export const DEMO_CODE_FOVEA = `const seen = new Map();

export function refundOnce(key, fn) {
  if (seen.has(key)) return seen.get(key);
  const p = fn();
  seen.set(key, p);
  return p;
}`;

export const DEMO_TESTS = [
  { given: 'a refund request carrying an unseen Idempotency-Key,', when: 'the endpoint is called once,', then: 'a refund row and its ledger entries are written.' },
  { given: 'the same key replayed within the retry window,', when: 'the endpoint is called again,', then: 'the stored refund is returned and no second ledger entry appears.' },
  { given: 'a request with no Idempotency-Key header,', when: 'the endpoint is called,', then: 'it fails with 400 idempotency_key_required.' },
];

export const DEMO_DASH_STATS = [
  { value: '38', label: 'RUNS THIS WEEK' },
  { value: '21', label: 'SUGGESTIONS COMMITTED' },
  { value: '6', label: 'PULL REQUESTS OPEN' },
  { value: '7m', label: 'MEDIAN ITEM TO PR' },
];

export const DEMO_RECENT_RUNS = [
  { id: '#1042', item: 'PAY-214 Idempotency keys on the refund endpoint', trigger: 'Manual', result: 'Succeeded · 2 suggestions' },
  { id: '#1041', item: 'PAY-209 Split the settlement worker by provider', trigger: 'Scheduled', result: 'Committed · PR #317' },
  { id: '#1040', item: 'PAY-221 Webhook retries duplicate the refund event', trigger: 'Scheduled', result: 'Succeeded · 2 suggestions' },
  { id: '#1039', item: 'PAY-196 Card-network response codes on the receipt', trigger: 'Manual', result: 'Committed · PR #315' },
  { id: '#1038', item: 'PAY-188 Rotate the Stripe webhook secret', trigger: 'Scheduled', result: 'Failed · GitHub token expired' },
];
