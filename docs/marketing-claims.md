# Marketing claim ledger

The source of truth for what `website/` is allowed to say. Every user-facing
sentence about what Kandryn does must trace to a `SHIPPED` row here. Keep it
current: when a feature lands, add or move its row **before** any copy is
written about it.

Two rules govern the public site.

1. **Shipped claims only.** `PARTIAL` is written exactly as far as it is true.
   `IN PROGRESS` and `PLANNED` are not published at all. No "coming soon", no
   roadmap section.
2. **Disclosures stay accurate.** Marketing copy names no AI vendor or model.
   The privacy policy, terms and the Trust page still name them, deliberately,
   because removing a named processor from those pages would make them
   misleading. Those lines are listed in
   `website/scripts/copy-allowlist.json` with the reason each one is kept, and
   `npm run check:copy` (in `website/`) fails on a vendor or model name
   anywhere else.

Last reconciled: 2026-11-26, against `main` through migration `0053`.

**The site's position, as of the 2026-11-26 repositioning:** Kandryn helps teams
deliver business improvements sooner by identifying, building and maintaining
the business context behind software changes. Both halves have to stay true.
"Sooner" is never quantified anywhere on the site, because no measurement
exists. "Maintains" is carried by rows b and p below and by nothing else, so
read them before writing the word again.

---

## Ledger

Re-keyed on 2026-11-27 to the rows a to r named in the phased redesign brief.
Rows s onward are claims the brief does not enumerate but the site may touch.
Status is one of SHIPPED, PARTIAL, IN PROGRESS, PLANNED. "Proving file" is the
code that was read, not a doc that describes it.

| | Claim | Status | Proving file | Wording limit |
|---|---|---|---|---|
| a | Parent story and epic read per run | **SHIPPED** | `services/contextService.ts` (`loadAncestors`, `maxDepth = 3`), `services/contextPack.ts`, injected once at `taskSection()` in `stack/prompts.ts` plus `buildPlannerPrompt`; `docs/db/0040_context_manifest.sql` | Three hops, so epic and story. The 1800-token pack is **shared with document passages**; each field is clipped at 700 chars and the most distant ancestor is dropped first. An item with no parents gets exactly the prompt it got before. Resolved through the **project owner**, not the actor. Parents are background, not authority |
| b | Repository file selection per run | **SHIPPED** | `services/planningService.ts` `CANDIDATE_CAP = 25`, `rankCandidatePaths`, `buildCandidatesFromGraph`, `FILE_CAP`, `TREE_CAP`; `gitService.fetchFileContext` / `fetchFileContextWithGraph` | A **capped set** the change planner selects as relevant, never the whole repository. The planner additionally sees the directory listing, **file names only and capped**. A large file body is truncated with a visible marker. Do not state an exact file count on the site; say "a small set the planner selects" |
| c | Project document upload and retrieval | **SHIPPED**, env-gated | `docs/db/0041_project_knowledge.sql`; `routes/knowledge.ts`; `services/documentParser.ts`, `knowledgeStorage.ts`, `knowledgeRetrieval.ts` | Types: exactly `.md .txt .csv .pdf .docx`, confirmed by **magic bytes on the server**, not the extension. Limits: 15 MB per file, 25 documents per project, 400 chunks per document, at most 6 passages per run, 1000 of the pack's 1800 tokens with the parent chain claiming its share first. Roles: read is owner or a team member of a team-visible project, **write is admin**. Retrieval is **Postgres full-text** (`websearch_to_tsquery`, OR-joined, `ts_rank_cd`, rank floor 0.25), not embeddings and not training; below the floor a run carries **no passages at all**. No-op unless `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set |
| d | Acceptance criteria override background documents | **SHIPPED as prompt instruction** | Literal text in `services/contextPack.ts`: "the acceptance criteria win" (parents) and "the work item's acceptance criteria govern" (references) | It is an instruction in the prompt, **not an enforced check**. "Govern" and "take precedence" are fair. "Guaranteed", "enforced" and "cannot" are not |
| e | Run records context references as identifiers and counts | **SHIPPED** | `PersistedContextManifest` in `lib/db/src/schema/runs.ts`; written in `services/runService.ts`; rendered as the run-detail Context cell; manifest version 2 adds `uiStyle` | `refs` are **identifiers only**: a tracker key or `#id`, and `<sourceId>:<chunkId>` for a passage. Never titles, headings or text. A reviewer can see **what** informed a change, not read it. Wherever a marketing illustration shows a policy excerpt, say that the product records the reference, not the excerpt |
| f | Repository index refresh: trigger and frequency | **PARTIAL** | `services/graphifyService.ts` (`triggerRepoIndex`, `queueRepoIndex`, `isGraphServable`, `INDEX_CLAIM_STALE_MINUTES`); call sites in `routes/repositories.ts`, `routes/projects.ts`, `services/runService.ts:824,1105`; dispatcher step 7 in `routes/internal.ts` | Triggers are: repository connect, repository URL change, **after a Kandryn commit**, and the Rebuild button. The post-commit refresh is **queued**, and drained by a cron dispatcher on a **five-minute tick**. A run uses the index only when its status is `succeeded` **and** it is fresher than 24 hours; otherwise retrieval falls back to keyword selection. The whole feature is a **no-op unless `GRAPHIFY_SERVICE_URL` and `GRAPHIFY_SERVICE_SECRET` are set**. So A4's candidate sentence must be narrowed: write "the repository index is refreshed after a Kandryn commit and picked up within about five minutes", never "instantly", "continuously" or "as you commit". Kandryn does not detect a change pushed by someone else |
| g | Stack detection and supported stacks | **PARTIAL** | `stack/detector.ts`, `services/stackPromptBuilder.ts`, `repositories.stack_profile`; `runs.stack_desc` (`0013`) | Detects language, test framework, package manager and database from path and content markers, and prepends a conventions block to both generation prompts. **`stack_profile.frontend` is not a framework detector**: it reports `react` for any repository with a `package.json`. Never publish a list of supported frameworks from it. Safe wording: "writes in the language, test framework and package manager already in your repository". Everything degrades to a no-op when the profile is null |
| h | UI style profile | **SHIPPED** | `docs/db/0042_ui_style_profiles.sql`; `services/uiStyle/*`; decided after planning in `runService.resolveStyleGuide`; project settings UI style tab | **Static parsing only. No model, and nothing from the repository is executed, imported, required or evaluated.** No file contents are stored, only validated values with evidence. Injected into **generation only**, and only when the plan touches a UI file under the detected root. Used-by counts read "not measured" without a servable index. Never "learns your design system" |
| i | Run order checks and recorded overrides | **SHIPPED** | `docs/db/0038_sequence_guard.sql`; `services/sequenceService.ts` (deterministic, model-free), `sequenceGate.ts`, `sequenceImpactService.ts`; `sequence_checks`, `sequence_overrides`, `work_item_links` | Say "recorded with a reason and the person who made it". **Do not say "cannot be altered"**: immutability comes from a DB trigger and `drizzle-kit push` does not create triggers, so it must be confirmed applied. "Done" is read from the tracker, not the pull request. Jira has no backlog rank, so the out-of-rank finding is **Azure Boards only**. No edge in the dependency graph is a model guess |
| j | Competing proposals, and the single-proposal fallback | **SHIPPED, but not as the brief words it** | `services/aiService.ts` `generateSuggestions` (both jobs pushed unconditionally, `Promise.allSettled`, `failures` returned); `services/modelKey.ts` `resolveModelKeys`; `runs.agent_failures` (`0039`) | **There is no configuration switch.** Both generation agents run on every run. If a key for one provider is missing, that agent's call fails, the failure is recorded on the run and shown as an amber note, and the run completes with **one** proposal. If every agent fails, the run fails rather than reporting success with nothing. Correct wording: "two proposals require a key for each of the two providers; with one key a run still completes, with one proposal instead of two". Do not write "configurable", "optional second agent" or "enable competing proposals" |
| k | Post-commit review, security scan and runbook | **SHIPPED, all three manual** | `routes/runs.ts:914` (`/review`), `:1094` (`/security`), `:1358` (`/runbook`), `:1558` (`/security/remediate`); each guarded on `committedSuggestionId` | All three are **user-triggered on a committed run**. None runs automatically, and a run nobody follows up on has had none of them. Never write "every change is reviewed" or "every change is scanned" |
| l | Status check, and when it blocks | **SHIPPED** | `services/securityStatus.ts` `postSecurityStatus`; `SECURITY_CHECK_CONTEXT === "kandryn/security"` (pinned by `services/branding.guard.test.ts:52`) | A commit status on GitHub, a pull request status on Azure Repos. It **blocks a merge only once the customer requires that check** in a GitHub ruleset or branch protection rule, or an Azure DevOps branch policy. Until then it reports and blocks nothing. On Azure Repos it attaches to the pull request, so a run with no pull request has nothing to post to. Posting is non-fatal: a failure to post does not fail the run |
| m | Manual change selection, and optional auto-commit | **SHIPPED** | `runs.auto_commit` is `boolean NOT NULL DEFAULT false` (`lib/db/src/schema/runs.ts:152`, `docs/db/0001_projects_runs_hierarchy.sql:68`); the RunPanel checkbox is unchecked by default | A person presses Commit. Auto-commit is a **per-run setting, off unless someone turns it on**, and it commits the top-ranked proposal to the run's own branch. It does not merge and it does not change who approves |
| n | Kandryn never merges | **SHIPPED** | No merge call exists: `grep` for `merge`, `mergePullRequest`, `merge_method` across `services/gitService.ts`, `services/securityStatus.ts` and `adapters/` returns nothing. Writes are confined to the branch `task/<id>` | Safe to state plainly and often. The one thing Kandryn overwrites is its own branch: re-committing a work item moves `task/<id>` to the new commit |
| o | Team workspaces, roles and audit log | **SHIPPED** | `docs/db/0017_multitenancy.sql`, `0018_audit_log.sql`, `0031`, `0033`; `teams`, `team_members`, `team_invites`; `TeamRole = "admin" \| "member"`; `teams.audit_retention_days` | Two roles only, admin and member. The audit log is admin-only, exportable as CSV, retained 30 to 365 days with a per-team override. The tamper-evident hash chain is a **DB trigger**, so the same caveat as row i applies: confirm it is applied before claiming it. Retention is currently described on the site in terms of plan names, which conflicts with the commercial model (A9 item 6) |
| p | Workspace-owned credentials | **SHIPPED** | `docs/db/0046_workspace_settings.sql`, `0053`; `TEAM_CONFIG_KEYS` in `routes/teams.ts`; `services/modelKey.ts` `resolveModelKeys`, `services/gitToken.ts` `resolveGitCreds` | An admin can hold tracker, repository and model credentials for the workspace; a personal credential is an **override the workspace permits**, not a fallback. So "your own keys" stays true and **"never ours" does not**. Required wording: "the keys you or your workspace admin saved". `0053` repaired a default that left new workspaces ignoring personal tokens |
| q | Kandryn-supplied model access | **SHIPPED IN CODE, NOT LIVE. Do not publish** | `docs/db/0045_agent_key_source.sql`; `services/modelKey.ts` `platformAvailable()` requires **both** `KANDRYN_ANTHROPIC_API_KEY` and `KANDRYN_OPENAI_API_KEY` | Production has neither set, and the product answers "not available in this environment". A3 forbids advertising it. Keep every page on "the keys you or your workspace admin saved" |
| r | Supported trackers, repositories, documentation tools | **SHIPPED** | `services/plmProjects.ts`, `syncService.ts`, `plmWrite.ts`; `services/gitService.ts`; `narratiaPushService.ts`; `CONFIG_KEYS` in `services/configService.ts` | Trackers: **Jira** and **Azure Boards** (the work-tracking half of Azure DevOps). Repositories: **GitHub** and **Azure Repos**. Documentation, optional: **Confluence** and **Notion**; Markdown to the pull request branch needs no extra credential. Limitations to keep: on Azure Repos a commit edits existing files and **adding a brand-new file can fail**, and the security status needs a pull request to attach to; Jira has no backlog rank, so the out-of-rank finding is Azure Boards only; Jira search uses the enhanced JQL endpoint. **Azure Boards and Azure Repos are two connections with two credentials** and must never share one label |

### Rows the brief does not enumerate

| | Claim | Status | Proving file | Wording limit |
|---|---|---|---|---|
| s | Confidence gate on a weak plan | **SHIPPED, publish the gate and not the number** | `docs/db/0029_confidence_gate.sql`; `services/confidenceScore.ts`; `projects.confidence_threshold` default 0.6 | The weights and the 0.6 default are **uncalibrated placeholders**. Describe the behaviour: a plan that scores as weak parks the run for a person to approve, edit or reject before anything is generated. No score, no threshold, no percentage. A run with no ready plan is not gated |
| t | Live run timeline | **SHIPPED** | `docs/db/0044_run_events.sql`; `services/runEventCore.ts`, `runEvents.ts`; `GET /runs/:id/events` | Carries names, paths, counts, categories, statuses and durations, and **never** the text of a work item, document, prompt, diff or model reply. Polled, not streamed |
| u | Whole-repository security scan and code review | **SHIPPED** | `0035` to `0037`, `0049` to `0051`; `services/baselineScanService.ts`, `reviewScanService.ts` | Both are priced before they start and record actual spend. Code review has eight categories and three severities with **no critical**; security findings are deliberately out of its scope. A file whose reply will not parse is marked **unreviewed, not clean** |
| v | Domain or functional model extraction with human review | **PLANNED. Do not publish** | `docs/db/0052_domain_rules.sql` creates `domain_extractions`, `domain_rules`, `domain_rule_evidence`; the extractor writes `proposed` rows and **nothing reads them**. There is no review queue and no injection into any prompt | A schema is not a feature. The site describes hierarchy and documents as **background**, never as a model, a rule library or discovered policy |
| w | Jira panel inside Jira, read-only | **SHIPPED IN CODE, NOT LIVE. Do not publish** | `middlewares/forgeAuth.ts`, `services/jiraExt/*`, `integrations/jira-forge/` | Every `/api/ext/*` route is **503 until `FORGE_APP_ID` is set**. The install is still outstanding |
| x | Drift detection between code and documents | **NOT SHIPPED. Do not publish** | A repository URL change marks the index `stale`; a Kandryn commit touching a styling file marks the UI style profile `stale`. Neither compares code to documents, and `knowledge_sources` has no staleness concept | What the customer keeps current is the customer's: nothing re-checks an uploaded document against the code, and the tracker hierarchy is only as current as the last sync |

## Banned wording, whatever the ledger shows

"domain model", "functional model", "learns your business", "understands your
domain", "knowledge base that grows over time", "trained on your documents",
"fine-tuned", "proprietary", "model independent". Also: no claim that Kandryn
has its own models, that data never leaves anywhere, or any certification,
audit or compliance status.

---

## Repositioning notes, 2026-11-26

The homepage leads with the outcome and names business context as the
mechanism. Three things constrain how far that can be taken:

- **"Sooner" carries no number anywhere.** No measurement exists. `/pilot/`
  lists three things a customer can measure during a pilot and promises no
  figure for any of them.
- **The hero's "maintains" rests on rows b, s and u.** What is true: the
  repository map is refreshed after commits land (queued, swept on a
  five-minute tick, and a no-op unless the index service is configured), and
  context is selected fresh per run. What is not: that documents or the
  tracker hierarchy keep themselves current. The homepage says both.
- **The claims example** lives in `website/lib/home.ts` (`HERO_PREVIEW`),
  labelled "Example" on screen, and names no company, no document and no
  section. It originally cited "section 4.2" and carried the word "fictional"
  twice to defuse it; the citation went, so the word was not needed. The
  six-days-versus-three figures are a worked illustration, not measured data
  and not a customer's. Do not add a carrier name, a policy title, a section
  number, or anything that reads as regulatory interpretation. If a citation
  goes back in, the disclaimer goes back with it.

## Known gaps on the site, left for a decision

1. **`website/lib/site.ts`, `SECURITY_PRINCIPLES` "Agents see a case file, not
   a repository":** says "**only** the files the change planner selects… plus
   the detected stack profile". Since `0040`/`0041`/`0042` the pack also carries
   the parent chain, retrieved document passages and the UI style guide. The
   word "only" is stale. Backlogged by decision, not fixed, because it is a
   security claim.
2. **`website/lib/site.ts`, FAQ "How much of my repository do the agents see?":**
   ends "nothing outside the repository you bound to the project is read at
   all". Uploaded documents are outside the repository and are read.
   Backlogged with item 1.
3. **Trust page data inventory has no uploaded-documents row.** Document text
   lives in `knowledge_chunks` in Supabase and the files in a private Supabase
   bucket, and neither `INFRA_ROWS` nor `SUBPROC_ROWS` records it. A disclosure
   gap created by `0041`. **For counsel.**
4. **Trust page `MODEL_ROWS` lists five agents; the site says six.** Narratia is
   missing from the table. Disclosure page, left alone.
5. **Trust page says "Last reviewed: September 2026"** and the sub-processor
   table "Last updated: August 2026", while `0040`–`0043` shipped in October.
6. **Changelog entry `2026-08-01`** says "Raptia and Fovea now detect your
   stack — React, Node, .NET, Java Spring Boot, Python, Go". Detection happens
   at repository connect, not inside the agents, and it is a file-marker guess
   rather than framework detection of that breadth.
7. **"Does Kandryn train on our code or documents?"** is deliberately **not** an
   FAQ. It depends on third-party terms. **For counsel.** Note that
   `app/privacy/page.tsx` and the Trust page already carry no-training
   statements that predate this ledger.
8. **`app/trust/page.tsx:386` and `:390` are inaccurate as of `0045`/`0046`.**
   They say "every call uses the keys you saved" and "Kandryn does not proxy or
   aggregate model costs". Row p makes the first conditional on workspace
   policy, and row q means a Kandryn-funded mode exists in the product even
   though this deployment cannot serve it. **For the owner.** Not edited, per
   the disclosure rule.
9. **The entity on `/terms/` and `/privacy/` is Venakan Info Solutions LLC,
   Ohio**, at `terms:40`, `:180`, `:213` and `privacy:33`, `:42`, `:236`, plus
   `website/package.json:5`. **For counsel.**
10. **`app/trust/page.tsx:464` says two co-founders hold database access.**
   **For the owner.**
11. **Plan names Free, Pro, Max and Enterprise** appear at `trust:553-554`,
   `privacy:162` and `terms:148`, and `terms:147` points at pricing on
   kandryn.com, where no pricing page exists. **For the owner.**
12. **`/trust/` has no incident response section.** **For counsel.**
13. **"What happens to the documents we upload?"** is deliberately **not** an FAQ
   either: answering where they are stored cannot be done from existing site
   copy without adding a new storage disclosure, and gap 3 above has to be
   settled first.
