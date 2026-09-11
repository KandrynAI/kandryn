// All marketing copy, mock data and static arrays live here. Components import
// from this file and never inline strings. (Rebuild spec — site.ts.)

export const SITE = {
  name: 'Kandryn',
  tagline: 'An AI delivery assistant for teams whose backlog is bigger than their week.',
  domain: 'kandryn.com',
  email: 'hello@kandryn.com',
  // The API lives with the app project (app.kandryn.com); the marketing site is
  // a separate origin, so its form posts are absolute cross-origin calls (A1).
  apiBaseUrl: 'https://app.kandryn.com',
  // The app SPA is a separate Vercel project on its own domain. It builds with
  // BASE_PATH=/, so its sign-in route is /sign-in (App.tsx <Route path="/sign-in">).
  appUrl: 'https://app.kandryn.com',
};

// Four items. The logo is the route home, and FAQ, Contact, Trust, Privacy
// and Terms live in the footer — keeping them in the top nav gave five
// supporting pages the same visual weight as the product itself.
export const NAV_ITEMS = [
  { label: 'Product', href: '/how-it-works' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'Resources', href: '/resources' },
  { label: 'Security', href: '/security' },
];

export const HOW_SECTIONS = [
  {
    n: '01', phase: 'run', title: 'Context',
    body: 'Before an agent sees anything, the run assembles the case file: the work item, its acceptance criteria, and the files in the bound repository that the change planner selects as relevant. The detected stack profile rides along, so the agents write Express and Drizzle rather than generic pseudocode.',
    detailLabel: 'WHAT GOES IN',
    details: ['Work item title, description and acceptance criteria', 'Relevant repository files, chosen by the change planner', 'The directory tree, so the plan targets paths that exist', 'The detected stack profile', 'Your refinement prompt, if you wrote one'],
  },
  {
    n: '02', phase: 'run', title: 'Two answers',
    body: 'Raptia and Fovea run in parallel against the same case file. They reason differently by design — when one misreads the acceptance criteria, the other usually does not.',
    detailLabel: 'WHY PARALLEL',
    details: ['One shared context, two independent reasoning paths', 'No sequential prompting, so no shared blind spot', 'Either answer is committable — Synthesia tells you which, and scores it out of 10', 'Both are kept on the run for later comparison'],
  },
  {
    n: '03', phase: 'run', title: 'Synthesia ranks',
    body: 'Synthesia scores each suggestion on five model-judged dimensions plus a mechanical coherence check, weights them into a single score out of 10, and flags the leader as Recommended with a plain-English explanation of its reasoning. Two behaviour signals — ambiguity handling and surgical precision — are scored alongside it and shown on the run, but carry no weight in the ranking.',
    detailLabel: 'SCORED ON',
    details: ['Correctness — does it solve the stated problem? (30%)', 'Coherence — a mechanical check against the surrounding code (15%)', 'Convention adherence — does it match existing patterns? (15%)', 'AC coverage — how many criteria does it address? (15%)', 'Readability — is it clear and maintainable? (15%)', 'Minimal diff — does it change only what is needed? (10%)'],
  },
  {
    n: '04', phase: 'run', title: 'Commit',
    body: 'Committing creates the deterministic branch task/<id>, writes the change, and opens a pull request titled with the work item. The item moves to review and the run records which suggestion won.',
    detailLabel: 'WHAT LANDS',
    details: ['Branch task/<id>, from the default-branch head', 'One commit containing the chosen suggestion', 'PR titled [Kandryn] <work item title>', 'Work item moved to review, run marked succeeded'],
  },
  {
    n: '05', phase: 'scheduled', title: 'Schedule and sweep',
    body: 'A run can be queued up to thirty days out. Every five minutes the dispatcher claims what is due, runs it, and emails you the outcome — including the failures, with the reason attached.',
    detailLabel: 'THE LOOP',
    details: ['Up to twenty pending runs per user', 'Claimed two at a time, no double-dispatch', 'Runs stuck over twenty minutes are failed', 'Completion and failure both send email'],
  },
  {
    n: '06', phase: 'ondemand', title: 'Veria reviews',
    body: 'After you commit a suggestion, Veria reads the committed code against the acceptance criteria and writes a structured review: what was addressed, what was missed, and what the human reviewer should focus on.',
    detailLabel: 'WHAT VERIA CHECKS',
    details: ['Which acceptance criteria are fully covered', 'Which are partially addressed or missing', 'Specific strengths in the committed code', 'Risks or gaps to watch in code review'],
  },
  {
    n: '07', phase: 'ondemand', title: 'Aegis secures',
    body: 'Run Aegis on a committed run and it scans each changed file on its own for injection flaws, hardcoded secrets, authentication bypasses and other OWASP Top 10 categories. High and Critical findings fail the status check it posts to the pull request; that check blocks a merge once your branch rules require it. Medium and Low findings create sub-tasks in your tracker. Remediate Now creates the ticket, syncs it to the board, and starts a new run with the remediation brief pre-filled — closing the security loop without leaving Kandryn.',
    detailLabel: 'WHAT AEGIS CHECKS',
    details: ['Injection: SQL, NoSQL, command, LDAP, XPath', 'Hardcoded secrets, API keys, and credentials', 'Authentication and authorisation flaws', 'Cryptographic weaknesses and insecure data exposure', 'SSRF, XXE and deserialization issues', 'Missing input validation and rate limiting', 'Categorised against OWASP Top 10 (2021)', 'Each changed file is scanned independently; a file that cannot be scanned fails the gate rather than passing it'],
  },
  {
    n: '08', phase: 'ondemand', title: 'Narratia documents',
    body: 'Narratia generates an operational runbook from the completed run: what changed and why, deployment steps specific to this change, rollback procedure, validation commands, and a summary of Veria and Aegis findings. Pushed to Confluence via REST API, Notion via the Notion API, or committed as docs/runbooks/ITEM-KEY.md to the same PR branch — zero extra credentials for the Markdown option.',
    detailLabel: 'RUNBOOK SECTIONS',
    details: ['Summary — the change in two or three sentences', 'What changed — the files and the reasoning', 'Deployment steps — specific to this change', 'Rollback procedure — referencing the branch and PR', 'Validation — how to verify it is working in production', 'Test cases — from the generated test suite', 'Security notes — Aegis gate status and findings', 'References — work item key, branch, commit hash, PR link'],
  },
];

/**
 * The phases a reader has to be able to tell apart.
 *
 * Stages 01-04 run every time. 06-08 only run when someone presses the button
 * on a committed run. Presenting all eight as one undifferentiated list is how
 * "Aegis scans every committed change" became plausible enough to publish.
 */
export const STAGE_PHASES = [
  { key: 'run', label: 'Every run', note: 'Happens each time you press Run, in this order.' },
  { key: 'scheduled', label: 'If you schedule it', note: 'The same pipeline, claimed by the dispatcher instead of by you.' },
  {
    key: 'ondemand',
    label: 'After the commit, when you ask',
    note: 'None of these start on their own. Each is a button on the run, and each needs your Anthropic key.',
  },
];

/** What Kandryn will not do — each one checkable in the product. */
export const LIMITS = [
  { title: 'It does not merge', body: 'Kandryn opens the pull request and stops. Merging is your review, your rules and your CI.' },
  { title: 'It does not touch your default branch', body: 'Work lands on task/<id>, and nothing else is ever written. Re-committing a work item moves that branch to the new commit, so keep your own work elsewhere.' },
  { title: 'It does not read your whole repository', body: 'A handful of files selected as relevant to the work item. The planner also sees the directory listing — names only, capped.' },
  { title: 'It does not run the post-commit agents by itself', body: 'Review, security and runbook generation are three buttons. A run that nobody follows up on has none of them.' },
  { title: 'It does not write to your tracker uninvited', body: 'New items and test cases go up only when you push them. The single automatic write-back is a status change when an item closes.' },
  { title: 'It does not hold a model contract on your behalf', body: 'Every call uses the API keys you saved, so the usage, the terms and the retention settings are all on your own account.' },
];

export const INTEGRATIONS = [
  { name: 'Jira', tag: 'TRACKER', body: 'Syncs the epic→story→task hierarchy into a board, resolves parents in two passes, and writes new items and test cases back when you ask it to.', creds: 'JIRA_DOMAIN · JIRA_EMAIL · JIRA_API_TOKEN', note: 'Uses the enhanced JQL search endpoint; your domain is normalised for you.' },
  { name: 'Azure DevOps', tag: 'TRACKER', body: 'The same sync against Azure Boards, with Feature mapped onto epic so the hierarchy lines up with Jira projects.', creds: 'AZURE_DEVOPS_ORG · AZURE_DEVOPS_PROJECT · AZURE_DEVOPS_PAT', note: 'Work-item creation and test-case push both supported.' },
  { name: 'GitHub', tag: 'PRIMARY REPO', body: 'Branch, commit and pull request. Stack detection reads the repository on connect, and the test-script commit stacks onto the existing PR rather than overwriting it.', creds: 'GITHUB_TOKEN (PAT) or the OAuth token from sign-in', note: 'The primary provider, and the one we test first on every release.' },
  { name: 'Azure Repos', tag: 'REPO', body: 'Commits and pull requests against an existing file tree, for teams whose code lives beside their boards.', creds: 'AZURE_REPOS_ORG · AZURE_REPOS_TOKEN', note: 'Edits to existing files are reliable; brand-new file adds can fail.' },
  { name: 'Raptia', tag: 'AGENT', body: 'The first of two generation agents that runs on every Kandryn pipeline. Raptia is optimised for precision — it reads the work item, the acceptance criteria, and the repository context, then commits to a single well-reasoned answer. Stack-aware: detects React, Angular, Vue, Node.js, .NET, Java Spring Boot, Python, and Go — and writes idiomatic code for each without being told.', creds: 'Your Anthropic API key, saved in Settings', note: 'Raptia and Fovea always run together in parallel.' },
  { name: 'Fovea', tag: 'AGENT', body: 'The second generation agent. Fovea takes a wider view of the same context — it considers more of the repository before settling on an approach, which means it often catches what Raptia misses. Also stack-aware — uses the same detected profile to ensure both suggestions follow the same framework conventions.', creds: 'Your OpenAI API key, saved in Settings', note: 'The Synthesia agent scores both and flags the stronger answer.' },
  { name: 'Synthesia', tag: 'AGENT', body: 'The ranking agent. After Raptia and Fovea complete, Synthesia scores both suggestions on correctness, readability, diff size, convention adherence, and acceptance-criteria coverage — then recommends the better one with a confidence score. Two behaviour signals — ambiguity handling and surgical precision — flag whether an agent silently assumed something or changed more than the work item required.', creds: 'Your Anthropic API key — the same one Raptia uses', note: 'Synthesia runs automatically after every generation. Its verdict is visible on every run, and you can always override it.' },
  { name: 'Veria', tag: 'AGENT', body: 'The review agent. After you commit a suggestion, Veria reads the committed code against the work item\'s acceptance criteria and produces a structured review: strengths, gaps, risks, and a one-sentence focus note for the human reviewer.', creds: 'User-triggered post-commit — runs on demand, not automatically', note: 'Veria only activates after a suggestion is committed to a branch. Veria explicitly checks for scope creep, silent assumptions, and over-engineering in the committed code.' },
  { name: 'Aegis', tag: 'AGENT', body: 'The security agent, run on demand once a suggestion is committed. Scans each changed file independently for OWASP Top 10 vulnerabilities, hardcoded secrets, injection flaws, and authentication bypasses. Outputs structured findings with severity, OWASP category, line reference, and remediation steps. High and Critical findings fail the status check it posts to the pull request. Remediate Now creates a tracker ticket, syncs the board, and starts a new run to fix the issue — without leaving Kandryn.', creds: 'Your Anthropic API key, saved in Settings', note: 'Aegis runs on a safeguarded frontier model, and falls back to a second one for organisations on zero data retention. Require the check in a branch rule once to turn the gate into a block.' },
  { name: 'Narratia', tag: 'AGENT', body: 'The documentation agent. After a run completes, Narratia generates an operational runbook: a summary of what changed, deployment steps specific to this change, rollback procedure, validation commands, test cases from the generated suite, and security findings from Aegis. Pushed to Confluence, Notion, or committed as Markdown to the PR branch.', creds: 'Confluence: CONFLUENCE_DOMAIN · CONFLUENCE_EMAIL · CONFLUENCE_API_TOKEN · CONFLUENCE_SPACE_KEY\nNotion: NOTION_API_TOKEN · NOTION_PARENT_PAGE\nMarkdown: no credentials required', note: 'The Markdown option commits docs/runbooks/ITEM-KEY.md directly to the PR branch — visible in the PR with no extra setup.' },
];

export const CAPABILITY_MATRIX = [
  { cap: 'Read hierarchy', jira: 'Yes', ado: 'Yes', gh: '—', ar: '—' },
  { cap: 'Create work items', jira: 'Yes', ado: 'Yes', gh: '—', ar: '—' },
  { cap: 'Push test cases', jira: 'Yes', ado: 'Yes', gh: '—', ar: '—' },
  { cap: 'Status write-back', jira: 'On close', ado: 'On close', gh: '—', ar: '—' },
  { cap: 'Branch and commit', jira: '—', ado: '—', gh: 'Yes', ar: 'Existing files' },
  { cap: 'Open pull request', jira: '—', ado: '—', gh: 'Yes', ar: 'Yes' },
  { cap: 'Stack detection', jira: '—', ado: '—', gh: 'Yes', ar: 'Yes' },
  { cap: 'Security gate (stop gate)', jira: '—', ado: '—', gh: 'Yes', ar: 'Yes' },
  { cap: 'Runbook push', jira: '—', ado: '—', gh: 'Markdown to PR', ar: 'Markdown to PR' },
];

export const CAPABILITY_FOOTNOTE =
  'Security gate: Aegis posts the kandryn/security check on both providers, ' +
  'and it blocks a merge only once you require it — a GitHub ruleset or ' +
  'branch protection rule, or an Azure DevOps branch policy. On Azure Repos ' +
  'the check attaches to the pull request, so a run with no pull request has ' +
  'nothing to post to. Runbook push to Confluence and Notion requires ' +
  'separate credentials in Settings.';

export const QUICKSTART = [
  { n: '01', title: 'Connect your credentials', body: 'An Anthropic key and an OpenAI key for the agents, plus your tracker and repository credentials — all tested as you save them. Optional: Confluence or Notion credentials for runbook push.', time: '5 min' },
  { n: '02', title: 'Bind your first project', body: 'One tracker project to one repository, validated live.', time: '2 min' },
  { n: '03', title: 'Sync and read the board', body: 'The hierarchy arrives; check the parents look right.', time: '1 min' },
  { n: '04', title: 'Run one small item', body: 'Pick something mechanical for the first run, not the payments rewrite.', time: '4 min' },
  { n: '05', title: 'Review the pull request', body: 'Normal review, normal CI. Nothing merges itself.', time: 'Your call' },
  { n: '06', title: 'Run Aegis after commit', body: 'Click Run Aegis on the committed run. Review findings, push Medium/Low to your tracker, or hit Remediate Now for High findings — the loop closes in the same session.', time: '2 min' },
];

export const CHANGELOG = [
  { date: '2026-08-07', title: 'Aegis remediation loop — Remediate Now', body: 'Security findings can now be pushed to your tracker or fixed immediately with Remediate Now — one click creates the ticket, syncs the board, and starts a new run.' },
  { date: '2026-08-05', title: 'Narratia runbook generation', body: 'After every committed run, Narratia generates an operational runbook and pushes it to Confluence, Notion, or the PR branch as Markdown.' },
  { date: '2026-08-03', title: 'Aegis security agent with stop gate', body: 'Aegis scans committed code for OWASP Top 10 vulnerabilities. High findings block the PR via a GitHub status check until resolved.' },
  { date: '2026-08-01', title: 'Stack-aware generation for all major frameworks', body: 'Raptia and Fovea now detect your stack — React, Node, .NET, Java Spring Boot, Python, Go — and write idiomatic code for each without being told.' },
  { date: '2026-07-24', title: 'Test scripts stack on the open PR', body: 'The generated script now commits onto the branch head instead of the default branch.' },
  { date: '2026-07-11', title: 'Scheduled runs email on failure', body: 'Failures carry the reason and a link straight to the run.' },
  { date: '2026-06-29', title: 'Epic breakdown is editable before it saves', body: 'Proposals arrive as rows you can rewrite, retype or delete.' },
  { date: '2026-06-15', title: 'Duplicate project bindings return a friendly 409', body: 'With a link to the project that already holds the binding.' },
];

export const SECURITY_PRINCIPLES = [
  { title: 'Credentials are per user', body: 'Every key is stored against your user record in an isolated config table. There is no shared pool, no fallback to an environment variable in production, and no key is ever written to a log line.' },
  { title: 'Every query is scoped', body: 'Projects, work items, runs and suggestions are all filtered by user on every read and write. There is no global collection a bug could expose.' },
  { title: 'Write access is narrow', body: 'Kandryn creates branches, commits and pull requests, all on task/<id>. It never merges and never writes to your default branch. The one thing it does overwrite is its own branch: re-committing a work item moves task/<id> to the new commit.' },
  { title: 'The tracker stays yours', body: 'Items and test cases are pushed only when you ask. The single automatic write-back is a status change when an item closes.' },
  { title: 'Agents see a case file, not a repository', body: 'Only the files the change planner selects as relevant to the work item, plus the detected stack profile, are passed to the agent pipeline. The planner additionally sees the directory listing — file names only, capped — so it can target paths that exist.' },
  { title: 'Failures are contained', body: 'A run that fails records the error and stops. Nothing half-written reaches your repository, and stuck runs are swept after twenty minutes. A blocked Aegis gate records every finding and stops without writing anything to main.' },
  { title: 'The stop gate is yours to enforce', body: 'Run Aegis on a committed run and it posts a kandryn/security status check to the pull request — on GitHub and on Azure Repos. Require that check in a branch rule and the platform blocks the merge until a High or Critical finding is resolved. Until you do, the check reports but does not block. Kandryn never merges anything itself.' },
];

export const PROCESSORS = [
  { name: 'Supabase (Postgres)', purpose: 'Application database', sees: 'Work items, runs, suggestions, your encrypted-at-rest config' },
  { name: 'Clerk', purpose: 'Authentication', sees: 'Email, session, OAuth identity' },
  { name: 'Generation pipeline', purpose: 'Code generation, ranking, and review', sees: 'Case file per run: work item, acceptance criteria, selected repository files. Agents: Raptia, Fovea, Synthesia, Veria.' },
  { name: 'Aegis (security pipeline)', purpose: 'Security vulnerability scanning', sees: 'The committed code change only — same file the developer committed. No other repository files.' },
  { name: 'Resend', purpose: 'Transactional email', sees: 'Your address and the run outcome' },
];

export const FAQS = [
  { q: 'Does Kandryn merge code?', a: 'No. It creates a branch named task/<id>, commits the suggestion you chose, and opens a pull request. Merging stays with your review rules and your CI.' },
  { q: 'How are credentials handled?', a: 'Tracker credentials (Jira, Azure DevOps) and repository credentials (GitHub, Azure Repos) are stored against your user, tested when you save them, and never written to a log line. Model credentials are yours too: Kandryn calls Anthropic and OpenAI with the keys you save, so the usage appears on your own account and no key is shared between users.' },
  { q: 'How much of my repository do the agents see?', a: 'A handful of files — the ones the change planner selects as relevant to the work item — plus the detected stack profile. The planner is also shown the directory listing, so it can target paths that exist, but that is file names only and is capped. No other file contents leave the repository, and nothing outside the repository you bound to the project is read at all.' },
  { q: 'What happens if a scheduled run fails?', a: 'The run row records the error, the item is left untouched, and the owner gets an email. Runs stuck longer than twenty minutes are swept to failed by the dispatcher.' },
  { q: 'Can it write to my tracker?', a: 'Only where you ask it to: new items and test cases you explicitly push, and a status change when an item closes. Nothing else propagates upstream.' },
  { q: 'Which providers work best?', a: 'GitHub is the primary, auto-synced provider. Azure Repos works for edits to existing files; adding a brand-new file can fail there.' },
  { q: 'Six agents — why so many?', a: 'Each agent has a distinct role. Raptia and Fovea generate competing suggestions in parallel — they reason differently by design, so when one misreads the ticket, the other usually does not. Synthesia scores both and recommends the stronger answer out of 10. Veria reviews the committed code against the acceptance criteria after commit. Aegis scans for security vulnerabilities and fails its status check on a High finding, which blocks the merge once your branch rules require that check. Narratia writes the operational runbook. Together they cover the full delivery loop from generation to documentation.' },
  { q: 'What does Aegis scan for?', a: 'Aegis checks for OWASP Top 10 (2021) vulnerabilities: injection flaws (SQL, NoSQL, command), broken access control, cryptographic failures, hardcoded secrets, insecure design, authentication bypasses, and SSRF. Each finding has a severity (Critical, High, Medium, Low, Info), an OWASP category, a line reference, and a remediation step. High and Critical findings fail the status check Aegis posts to the pull request — a block once your branch rules require it. Medium and Low findings create tracker tickets.' },
  { q: 'Can Kandryn fix its own security findings?', a: 'Yes — that is what Remediate Now is for. Click it on any Aegis finding and Kandryn creates the tracker ticket, syncs it to the board, and immediately starts a new run with the security finding and its remediation as the brief for Raptia and Fovea. The loop closes in the same session without switching tools.' },
  { q: 'What does Narratia put in the runbook?', a: 'Eight sections: a summary, what changed and why, deployment steps specific to this change, a rollback procedure referencing the branch and PR, validation commands to confirm it is working in production, the generated test cases, security findings from Aegis, and a references section with the work item key, branch, commit hash, and PR link. Pushed to Confluence, Notion, or committed as Markdown to the same PR branch.' },
  { q: 'Can I try it on one project?', a: 'That is how every pilot starts: one tracker project, one repository, one real work item run end to end on a shared call.' },
];

export const FOOTER_COLS = [
  { title: 'PRODUCT', links: [{ label: 'How it works', href: '/how-it-works' }, { label: 'Integrations', href: '/integrations' }, { label: 'Security', href: '/security' }, { label: 'Trust', href: '/trust/' }, { label: 'FAQ', href: '/faq' }] },
  { title: 'RESOURCES', links: [{ label: 'Guides', href: '/resources' }, { label: 'Patterns', href: '/resources' }, { label: 'Changelog', href: '/resources' }, { label: 'Templates', href: '/resources' }] },
  { title: 'COMPANY', links: [{ label: 'Request access', href: '/contact' }, { label: 'Book a walkthrough', href: '/contact' }, { label: 'Trust & Security', href: '/trust/' }, { label: 'Contact', href: '/contact' }, { label: 'Home', href: '/' }] },
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
  { id: '#1042', item: 'PAY-214 Idempotency keys on the refund endpoint', trigger: 'Manual', result: 'Succeeded · Raptia recommended' },
  { id: '#1041', item: 'PAY-209 Split the settlement worker by provider', trigger: 'Scheduled', result: 'Committed · PR #317' },
  { id: '#1040', item: 'PAY-221 Webhook retries duplicate the refund event', trigger: 'Scheduled', result: 'Succeeded · Raptia recommended' },
  { id: '#1039', item: 'PAY-196 Card-network response codes on the receipt', trigger: 'Manual', result: 'Committed · PR #315' },
  { id: '#1038', item: 'PAY-188 Rotate the Stripe webhook secret', trigger: 'Scheduled', result: 'Failed · GitHub token expired' },
];
