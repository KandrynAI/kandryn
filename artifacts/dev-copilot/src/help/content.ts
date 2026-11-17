/**
 * The /help guide, written for the person who executes runs.
 *
 * Static content in the bundle: no backend, no CMS, no migration. One typed
 * array, rendered by src/pages/HelpPage.tsx.
 *
 * Three rules this file lives by, each enforced by content.test.ts rather than
 * by good intentions:
 *
 *   1. Every label in quotes is a label that exists on screen, verbatim. A
 *      guide that quotes a button nobody can find is worse than no guide,
 *      because the reader stops trusting the rest of it.
 *   2. No model vendor or model name. The product says Raptia, Fovea,
 *      Synthesia, Veria, Aegis, Narratia and Kandryn, and so does this file.
 *      A few of the app's own toasts still name a vendor; where this guide
 *      quotes one of those it paraphrases and says which screen to open.
 *   3. Only shipped behaviour. Anything partial or planned is left out
 *      entirely rather than softened, because a reader cannot tell the
 *      difference between a hedge and a feature.
 *
 * `{projectId}` in an href is filled in at render from the active project. With
 * no project yet, the link falls back to the new-project wizard.
 */

/** Where a section's screen lives. `href` may contain the {projectId} token. */
export interface HelpLink {
  label: string;
  href: string;
}

/** One row of the failure table (section "When something fails"). */
export interface HelpTrouble {
  /** What the app shows you, or a plain description of what you see. */
  message: string;
  meaning: string;
  fix: string;
}

/** One glossary entry. */
export interface HelpTerm {
  term: string;
  definition: string;
}

export interface HelpSection {
  /** Anchor id. Stable: it ends up in a URL fragment. */
  id: string;
  title: string;
  /** The screen this section is about, and how to open it. */
  where?: HelpLink;
  /** One or two sentences before the steps. */
  intro?: string;
  steps?: string[];
  troubles?: HelpTrouble[];
  terms?: HelpTerm[];
  /** An amber caution. Never a failure, always something to look out for. */
  watchFor?: string;
  /** True when the whole section is only visible to a team admin. */
  admin?: boolean;
}

export const HELP_INTRO =
  "This guide follows the order you will actually use Kandryn: connect your tools, create a project, run the agents on a work item, review what they produced, and merge. Each section says which screen it is about and how to open it.";

/** The shortest real path from signing in to a merged pull request. */
export const QUICK_START: string[] = [
  "Sign in. Kandryn opens on the Dashboard.",
  "Open Settings and save your GitHub token, then \"Agent A credentials\" and \"Agent B credentials\". Each card reads \"Not set\" until you save it.",
  "Create a project: pick the tracker project, then the repository.",
  "Open the board and click \"Sync\" to load your work items.",
  "Pick an item, choose \"Run agents\", then \"Run now\".",
  "Watch \"Activity\". When the run finishes, read the ranked suggestions and commit the one you want.",
  "Read the pull request in GitHub, run the security scan if you need it, then merge.",
];

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-around",
    title: "Getting around",
    where: { label: "Dashboard", href: "/dashboard" },
    intro:
      "Three pieces of furniture, left to right: the icon rail, the project panel, and the page itself.",
    steps: [
      "The icon rail on the far left is the main navigation: Dashboard, Board, Runs, Repositories, History and Reports, with Settings and your account at the bottom.",
      "Board and Runs are project-scoped. They open whichever project you are currently working in. With no project yet they send you to the new-project wizard instead.",
      "The panel beside the rail belongs to the current project. It holds the project switcher, live counts for the board columns, Bugs and Runs, the connected repository, and small status dots for your tracker and GitHub credentials.",
      "Your team name sits at the bottom of that panel with an \"ADMIN\" or \"MEMBER\" badge. That badge decides which screens you can open.",
      "The bar across the top shows the page title. Buttons for the current page appear on its right.",
    ],
  },
  {
    id: "credentials",
    title: "Settings: credentials",
    where: { label: "Settings", href: "/settings" },
    intro:
      "Settings has two tabs, split by who owns the decision rather than who types the value. \"Workspace\" holds what your organization decides. \"My account\" holds only what is about you.",
    steps: [
      "\"Workspace\" is where repository access, agent credentials, trackers and documentation live. Every member can read it; only an admin can change it, and a member sees the controls disabled under one amber line.",
      "Under \"Agents\", an admin picks \"Use Kandryn Agents\" (Kandryn supplies the credentials, nothing to set up) or \"Use our own credentials\" and saves them below.",
      "Under \"Repository access\", an admin saves the credential Kandryn commits and opens pull requests with.",
      "\"Allow members to use their own credentials\" decides whether you may override any of that with your own. Turning it off deletes nothing: saved credentials stay, they simply stop being used.",
      "\"My account\" shows your workspace and role, and, when the policy allows it, your own credentials. Save a personal repository token there if you want commits attributed to you rather than to the workspace.",
      "Every card shows a pill: \"Not set\" before you save, \"Configured\" after. Use \"Test connection\" where a card offers it.",
      "With no workspace, everything is yours: My account is the whole of Settings and behaves as it always has.",
    ],
    watchFor:
      "A change of credential source applies to the next run. Runs already in flight finish on the credentials they started with.",
  },
  {
    id: "create-project",
    title: "Creating a project",
    where: { label: "New project", href: "/projects/new" },
    intro:
      "A project binds one tracker project to one repository. That pairing is what every run reads from and writes to.",
    steps: [
      "Step one, \"PLM provider\": choose Jira or Azure DevOps. If the tracker is not connected yet, the step links you to Settings.",
      "Step two, \"PLM project\": pick the project from the live list pulled from your tracker.",
      "Step three, \"Repository\": pick the repository the agents will read and commit to. If you have none connected, the step links you to Repositories.",
      "Click \"Create project\". If that tracker project is already bound to another Kandryn project you get \"Already connected\" and a link to open the existing one, rather than a duplicate.",
      "Kandryn detects the repository stack when you connect the repository, and reads the repository's interface styling in the background so generated screens match what is already there.",
      "After creating, Kandryn offers the optional documents step. You can skip it and go straight to the board.",
    ],
    watchFor:
      "The whole-codebase security scan is not automatic. You start it yourself from the repository screen with \"Scan this codebase\".",
  },
  {
    id: "documents",
    title: "Project documents",
    where: { label: "Project settings, Knowledge", href: "/p/{projectId}/settings?tab=knowledge" },
    intro:
      "Upload the architecture or requirements documents you already have. A run pulls in the passages that bear on the work item it is building.",
    steps: [
      "Drop files in, or use the picker. You can queue several at once and set a type for all of them.",
      "Accepted types are .md, .txt, .csv, .pdf and .docx, up to 15 MB each, and up to 25 documents per project.",
      "Give each document a type: \"Architecture\", \"Business requirements\", \"Design\" or \"Other\".",
      "A document moves through \"Pending\" and \"Processing\" to \"Ready\". Only a \"Ready\" document is searched during a run.",
      "Use \"Change document\" to rename one, change its type, or replace the file. The replacement is indexed before the old one is removed, so a failed replace leaves the original in place.",
    ],
    watchFor:
      "Documents are background, not instructions. The acceptance criteria on the work item always win where the two disagree.",
  },
  {
    id: "board",
    title: "The board",
    where: { label: "Board", href: "/p/{projectId}/board" },
    intro: "Your tracker's work items, in four columns, with the run controls on each card.",
    steps: [
      "Click \"Sync\" to pull the epic, story and task hierarchy from your tracker. An empty board says \"No items. Click Sync to load your board.\"",
      "The columns are \"Open\", \"In progress\", \"Review\" and \"Done\". Blocked items sit in Open.",
      "The pills above the columns filter the board by epic.",
      "Card badges tell you the item's state at a glance: the type, the tracker key, a clock when a run is scheduled, \"Security blocked\" when a security gate is holding its pull request, and a \"Waits on\" chip naming anything that should land first.",
      "Hover a card for its actions: \"Run agents\", \"Schedule run\", and \"Break down\" on an epic or story.",
      "\"Run order\" switches the board to the dependency view, which groups open work into waves so you can see what is safe to start.",
      "Click a card to open the work item panel.",
    ],
  },
  {
    id: "work-item",
    title: "The work item",
    where: { label: "Board, then click a card", href: "/p/{projectId}/board" },
    intro: "Everything the agents will read about this piece of work, in one panel.",
    steps: [
      "\"Description\" and \"Acceptance criteria\" are what the agents are held to. Thin acceptance criteria are the single most common reason a run produces something you did not want.",
      "\"Run history\" lists this item's previous runs. \"View run\" opens one.",
      "Use \"Open in PLM\" to jump to the issue in Jira or Azure DevOps. Edit the ticket text there and re-sync the board.",
      "To steer one run without changing the ticket, put your instruction in \"Refinement (optional)\" when you start the run.",
      "Press Escape or use \"Close\" to dismiss the panel.",
    ],
  },
  {
    id: "starting-a-run",
    title: "Starting a run",
    where: { label: "Board, then \"Run agents\"", href: "/p/{projectId}/board" },
    intro: "A run is one pass of the pipeline over one work item. You can start it now or set it for later.",
    steps: [
      "\"Run agents\" opens the run sheet. \"Refinement (optional)\" is a free-text nudge, for example a constraint or an approach to prefer.",
      "\"Auto-commit the top suggestion\" is off by default. Leave it off while you are learning what the agents produce: it opens a branch and a pull request as soon as the run finishes, with no review step.",
      "\"Run now\" starts immediately and takes you to the run page.",
      "\"Schedule for later\" takes a date and time, up to 30 days out. A scheduled run is picked up in the background, and the owner is emailed when it finishes.",
      "If the item looks out of order, Kandryn stops first and shows what it found, graded \"Warning\" or \"Caution\", with a \"Do this first\" list and \"What running it now could cause\".",
      "To run anyway, pick a reason and confirm. That decision is stored permanently with your name against it.",
    ],
    watchFor:
      "A run generates against the repository's default branch. Work that has not landed there yet is invisible to the agents, which is exactly what the order check is warning you about.",
  },
  {
    id: "watching-a-run",
    title: "Watching a run",
    where: { label: "Runs, then open a run", href: "/p/{projectId}/runs" },
    intro:
      "The \"Activity\" section is a live record of what each agent did, step by step. It keeps working after the run ends, so a finished run replays the same way.",
    steps: [
      "Kandryn reads the work item, its parent items, any matching passages from your documents, and the repository, then plans which files to change.",
      "Raptia and Fovea each propose a change against that plan. They run at the same time and their steps interleave in the feed.",
      "Synthesia scores both proposals and ranks them.",
      "Veria reviews the committed change. You start it from the run page after committing.",
      "Aegis scans the committed change for security problems. You start it the same way.",
      "Narratia writes the runbook. Also started by you, after a commit.",
      "The status strip at the top reads \"queued\", \"running\", \"needs review\", \"succeeded\", \"failed\" or \"canceled\". The \"Context\" cell tells you what background the run carried, for example two parent items and one document.",
      "Steps that need your attention are amber. Finished steps collapse; scroll up and the feed stops following so you can read, with a way back to the latest.",
    ],
  },
  {
    id: "reviewing",
    title: "Reviewing and approving",
    where: { label: "Runs, then open a run", href: "/p/{projectId}/runs" },
    intro:
      "Two different review points. One happens before any code is written, the other after.",
    steps: [
      "Before generating, Kandryn scores its own plan. If the score is below your project's threshold the run stops at \"This plan needs review before generating code\" and waits. The status reads \"needs review\".",
      "\"Approve & generate\" runs the agents against exactly that plan. \"Reject\" ends the run with no code. \"Edit plan\" lets you add or remove files, then \"Save & regenerate\".",
      "After generation you get one card per agent, labelled \"Raptia\" or \"Fovea\", with the top one badged \"Recommended\".",
      "\"Synthesis confidence\" shows the verdict (\"Strong\", \"Adequate\" or \"Needs work\") and the six dimensions behind it: \"Correctness\", \"Coherence\", \"Conventions\", \"AC coverage\", \"Readability\" and \"Surgical precision\".",
      "Read the diff on the card you prefer, then commit it. Kandryn opens a branch for the work item and a pull request titled with a \"[Kandryn]\" prefix, and the item moves to \"Review\" on the board.",
      "Merging is yours to do in GitHub. Kandryn never merges.",
    ],
    watchFor:
      "A low plan score is a signal that Kandryn is unsure which files the change belongs in, not that the code will be wrong. Reading the plan and editing the file list is usually faster than rejecting and starting over.",
  },
  {
    id: "security",
    title: "Security results",
    where: { label: "Runs, then open a run", href: "/p/{projectId}/runs" },
    intro:
      "Aegis is the security agent. It runs on a committed change, when you ask it to, and reports under \"Aegis · Security\".",
    steps: [
      "Click \"Run Aegis security scan\". You need a committed suggestion first.",
      "Any High or Critical finding shows \"Security gate blocked\" with the counts and \"resolve to unblock PR\".",
      "Kandryn posts the result to your repository as a commit status named \"kandryn/security\". It only blocks a merge once someone requires that check in a GitHub branch protection rule or an Azure DevOps branch policy. Until then it is advisory.",
      "\"Push to PLM\" files a finding into your tracker. High and Critical become a Bug, Medium and Low become a Sub-task. Nothing is filed until you ask for it.",
      "\"Remediate Now\" files the ticket and starts a fix run against it, then takes you to that run.",
      "To proceed despite the gate, use the override. It asks for a reason, records who cleared it, and freezes the findings as they stood.",
    ],
    watchFor:
      "A file Aegis could not scan counts against the gate in the same way as a finding. That is deliberate: an unscanned file is an unknown, not a pass.",
  },
  {
    id: "runbooks",
    title: "Runbooks",
    where: { label: "Runs, then open a run", href: "/p/{projectId}/runs" },
    intro:
      "Narratia writes the runbook for a committed change: what changed, how to verify it, and how to roll it back.",
    steps: [
      "Pick a target: \"Markdown (PR)\", \"Confluence\" or \"Notion\".",
      "Click \"Generate runbook\". You need a committed suggestion first.",
      "\"Markdown (PR)\" commits the runbook onto the same pull request branch, so it ships with the change.",
      "\"Confluence\" and \"Notion\" publish to the space or page an admin configured on the Team tab. If neither is set up, the runbook is still generated and saved on the run.",
      "Use \"Show runbook\" to read it on the page before you publish it anywhere.",
    ],
  },
  {
    id: "audit",
    title: "The audit trail",
    where: { label: "Settings, Audit log", href: "/settings?tab=audit" },
    admin: true,
    intro: "Every action that changed something, in one filterable list.",
    steps: [
      "The \"Activity\" view lists actions with who did them and when: credentials saved, boards synced, plans edited, scans run, members invited, overrides recorded.",
      "Filter by \"All actions\" or \"All members\" to narrow it.",
      "\"Load 50 more\" pages back through history.",
      "The \"Decisions\" view lists run-order overrides on their own, with the reason each person gave, and exports to CSV.",
      "The log is hash-chained, so a row cannot be altered after the fact without it showing.",
    ],
  },
  {
    id: "reports",
    title: "Reports",
    where: { label: "Reports", href: "/reports" },
    intro: "Delivery metrics over a date range, for one project or all of them.",
    steps: [
      "The main Reports screen is open to everyone in the team. Pick a range and a project, or leave it on \"All projects\".",
      "Panels cover agent win rate, plan acceptance rate, confidence distribution, the scoring dimensions, retrieval attribution and planning cost per run. A panel with no data for the range says so rather than drawing an empty chart.",
      "\"Export PDF\" prints the current view.",
      "\"Admin reports\" and \"Executive\" are extra views for team admins. They have their own sidebar once you are in them.",
      "\"Delivery rate\" on the Executive view is runs that produced a committed pull request, over runs that reached an outcome. It says nothing about whether those pull requests were merged or accepted.",
    ],
  },
  {
    id: "team",
    title: "Team and roles",
    where: { label: "Settings, Workspace", href: "/settings?tab=workspace" },
    intro: "Two roles: member and admin.",
    steps: [
      "A member can do all the delivery work: sync a board, run agents, review, commit, scan, generate runbooks, and read the main Reports screen.",
      "An admin can additionally manage members, set the shared tracker and documentation credentials, read the audit log, and open the admin and executive reports.",
      "\"Team members\" lists everyone with their role. An admin can change a role or remove a member.",
      "\"Invite members\" sends an invite by email. A pending invite can be canceled.",
      "Shared credentials live on this tab because they belong to the organization: repository access, agent credentials, the tracker connection and the documentation targets for runbooks.",
      "An admin also sets how security findings are filed into the tracker, and how long the audit log is kept.",
    ],
  },
  {
    id: "troubleshooting",
    title: "When something fails",
    intro:
      "What the app tells you, what it means, and what to do. Where a message names a specific credential, the screen to open is Settings.",
    troubles: [
      {
        message: "\"Not set\" on a credential card",
        meaning: "That credential has never been saved, so anything depending on it will refuse to start.",
        fix: "Open Settings, fill the card in, and use \"Test connection\" before saving.",
      },
      {
        message: "\"Add your Agent A credentials in Settings to run Veria.\" (also Aegis, Narratia)",
        meaning: "Those three agents run on the credentials saved in the Agents group.",
        fix: "Open Settings, Workspace, Agents, or save your own under My account when the policy allows it.",
      },
      {
        message: "A run refused because your workspace has no agent credentials set up",
        meaning: "Nothing could be resolved: no personal credential, and none on the workspace either.",
        fix: "An admin opens Settings, Workspace, Agents. A member asks an admin, since the controls are theirs.",
      },
      {
        message: "\"Kandryn Agents is not available in this environment.\"",
        meaning: "This deployment has no platform credentials, so the option cannot be chosen here.",
        fix: "Use your own credentials for now. Nothing you have saved is affected.",
      },
      {
        message: "\"Commit a suggestion before running Veria.\" (also Aegis, Narratia)",
        meaning: "All three work on committed code. There is nothing to look at yet.",
        fix: "Commit one of the ranked suggestions first, then start the agent.",
      },
      {
        message: "A message that Jira or Azure DevOps is not connected",
        meaning:
          "The shared tracker credentials are missing. The app's wording points at \"Integrations\", which is now the Team tab in Settings.",
        fix: "Ask a workspace admin to fill in the tracker credentials on Settings, Workspace.",
      },
      {
        message: "\"Could not sync from the PLM.\"",
        meaning: "The tracker rejected the request, usually an expired token or a changed project key.",
        fix: "Check the tracker credentials on the Team tab, then click \"Sync\" again.",
      },
      {
        message: "A credential error quoting GitHub, such as bad credentials",
        meaning: "Your GitHub token is invalid or expired. Tokens expire by design.",
        fix: "Replace it under My account, or ask an admin to update the workspace credential on Settings, Workspace, Repository access.",
      },
      {
        message: "\"Repository needs reconfiguration\"",
        meaning: "The project's repository has no usable URL, so the run has nowhere to read or write.",
        fix: "Open Repositories, edit the repository, and set a valid URL.",
      },
      {
        message: "\"No agent produced a suggestion.\"",
        meaning: "Both agents failed on this run. Usually a missing or rejected credential, or a work item with too little to go on.",
        fix: "Check both agent credentials, then re-run. If it repeats, add detail to the acceptance criteria and try again.",
      },
      {
        message: "\"Planning did not produce a plan\"",
        meaning: "Kandryn could not work out which files to change, so it generated without one.",
        fix: "Read the result carefully before committing. Naming the files in \"Refinement (optional)\" on a re-run usually fixes it.",
      },
      {
        message: "\"Security gate blocked\"",
        meaning: "Aegis found a High or Critical issue, or could not scan one of the changed files.",
        fix: "Fix the finding and re-run, use \"Remediate Now\" to start a fix run, or override with a recorded reason.",
      },
      {
        message: "\"Run timed out\"",
        meaning: "The run stopped without recording an outcome and was closed out automatically.",
        fix: "Use \"Re-run this item\". If it repeats on a large change, split the work item into smaller ones.",
      },
      {
        message: "\"Run was never started\"",
        meaning: "The browser closed in the moment between creating the run and starting it.",
        fix: "Use \"Re-run this item\".",
      },
      {
        message: "A run sitting at \"queued\" and not moving",
        meaning: "Nothing picked the run up, usually because the tab closed at the wrong moment.",
        fix: "Start the item again from the board. The stuck row is harmless.",
      },
    ],
  },
  {
    id: "glossary",
    title: "Glossary",
    terms: [
      { term: "Workspace", definition: "Your team and everything in it: projects, repositories, members and the audit log." },
      { term: "Project", definition: "One tracker project bound to one repository. Runs happen inside a project." },
      { term: "Work item", definition: "One epic, story, task or bug, synced from your tracker. The unit a run works on." },
      { term: "Run", definition: "One pass of the pipeline over one work item, from reading the item to ranked suggestions." },
      { term: "Plan", definition: "The list of files Kandryn intends to change, written before any code is generated." },
      { term: "Confidence", definition: "Kandryn's own score for how sure it is about a plan. Below your project's threshold, the run stops and waits for you." },
      { term: "Raptia", definition: "One of the two agents that propose a change." },
      { term: "Fovea", definition: "The other proposing agent. Both run at once and you choose between their results." },
      { term: "Synthesia", definition: "The agent that scores and ranks the proposals across six dimensions." },
      { term: "Veria", definition: "The agent that reviews a committed change against the acceptance criteria." },
      { term: "Aegis", definition: "The security agent. Scans a committed change and reports a gate decision." },
      { term: "Narratia", definition: "The agent that writes the runbook for a committed change." },
      { term: "Gate", definition: "A point where work stops and waits: the plan review before generation, and the security gate after a commit." },
      { term: "Override", definition: "Proceeding past a gate on purpose, with a reason recorded permanently against your name." },
      { term: "Runbook", definition: "The written record of a change: what it does, how to verify it, how to roll it back." },
      { term: "Suggestion", definition: "One agent's proposed change for a run, with its diff, its explanation and its score." },
    ],
  },
];
