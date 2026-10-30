# Kandryn — Project Knowledge for AI Assistants

> Single source of truth for continuing development. Covers **what the product does**,
> the **UI/UX**, the **functional flows**, and the **technical architecture**. Kept current
> with the shipped app (kandryn.com + app.kandryn.com). Last reconciled against the
> codebase on 2026-10-30, through migration `0043`.

---

## 1. What this project is

Kandryn is an **AI-powered developer delivery assistant**. It connects to Azure DevOps, Jira, and GitHub, syncs a project's work-item hierarchy (epic → story → task), and uses multiple AI agents (Claude + OpenAI) to generate, rank, and commit code. From a work item a user can:

- **Run** the agent pipeline — now (inline) or on a **schedule** (background, via cron).
- Review ranked suggestions and **commit** the chosen one → branch + PR.
- **Create** work items from Kandryn (optionally pushed into the PLM) and **break down** an epic/story into children with AI.
- **Generate tests** for a committed change, commit the test script to the same PR, and **push test cases** back into the PLM.
- Be **warned when an item is out of order** — a prerequisite that has not landed on the default branch is invisible to a run — then override with a reason, which is stored as an immutable, attributed decision record.

Three deployables share one backend + database:
- **Marketing website** (`website/`) — public Next.js site at `/` (kandryn.com)
- **App** (`artifacts/dev-copilot`) — authenticated React SPA at `/` on app.kandryn.com
- **API** (`artifacts/api-server`) — Express 5 REST server at `/api` on app.kandryn.com

> `artifacts/kandryn` (older Vite marketing site) and `artifacts/mockup-sandbox` still exist but are **not deployed** — the Next.js `website/` superseded the Vite site.

---

## 2. Deployment & routing (Vercel)

**Two** Vercel projects (Vercel **Pro**), split by #127. **No shared reverse proxy** — each project has its own `vercel.json`:

| Project | Root dir | Domain | Serves |
|---|---|---|---|
| `kandryn_marketing` | `website/` | **kandryn.com** | Next.js 15 static export (`out`), `website/vercel.json` |
| `kandryn-ai-app` | repo root | **app.kandryn.com** | root `vercel.json`: `/api/*` → `artifacts/api-server/api/index.js` (`@vercel/node`, `maxDuration: 300`); `/*` → `artifacts/dev-copilot` Vite static (`dist/public`) |

The app project builds with `BASE_PATH=/`, so the SPA and its sign-in route live at the
root of app.kandryn.com (`/sign-in`, not `/app/sign-in`). It also needs
`ENABLE_EXPERIMENTAL_COREPACK=1` and Node 24 — Vercel otherwise infers pnpm 9 from
`lockfileVersion: 9.0` and the pnpm-workspace overrides fail to match.

- **Cron:** `vercel.json → crons: [{ path: "/api/internal/dispatch-runs", schedule: "*/5 * * * *" }]`.
- Always use **relative URLs** (`/api/...`) or `import.meta.env.BASE_URL` in app code.
- **Runtime testing happens on the Vercel deploy.** The sandbox has no live Supabase/Clerk/PLM/Git/Resend/cron — verify with typecheck + build + the esbuild bundle, then smoke-test flows after deploy. (You *can* stand up an ephemeral local Postgres for data-layer checks: `initdb`/`pg_ctl` as the `nobody` user, `drizzle-kit push`, then a `tsx` script inside `artifacts/api-server`.)

---

## 3. Monorepo layout

```
website/            Next.js 15 marketing site (/) — standalone npm project, NOT in the pnpm workspace
artifacts/
  api-server/       Express 5 REST API (/api); esbuild → dist/serverless.mjs for Vercel
  dev-copilot/      React + Vite app (/app)
  kandryn/      Legacy Vite marketing site — not deployed
  mockup-sandbox/   Local component preview — not deployed
lib/
  api-spec/  api-client-react/  api-zod/   OpenAPI + Orval codegen (LEGACY task flow only)
  db/               Drizzle ORM schema + Supabase Postgres client
shared/types/       task.ts, codeSuggestion.ts, stack.ts
docs/
  ARCHITECTURE.md   End-to-end structure (companion doc)
  db/*.sql          Idempotent DDL to apply in Supabase by hand
scripts/            @workspace/scripts
```

---

## 4. Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 · TypeScript 5.9 (strict) |
| Package manager | pnpm workspaces (except `website/` = npm) |
| API | Express 5 |
| DB | PostgreSQL (Supabase) + Drizzle ORM |
| Validation | Zod (`zod/v4`) — inline in newer routes; `drizzle-zod` for insert schemas |
| App frontend | React + Vite + **wouter** + **TanStack Query** + Tailwind + shadcn/ui |
| Marketing | Next.js 15 (static export) |
| Auth | Clerk (standalone **production** instance, `pk_live`, domain kandryn.com) |
| Email | Resend |
| Models | Claude `claude-sonnet-4-5`, OpenAI `gpt-4o` |

---

## 5. Authentication

Standalone **Clerk production instance** (`pk_live_…`), Frontend API at `clerk.kandryn.com`, not Replit-managed.
- **The publishable key is the single source of truth** — it base64-encodes its own Frontend API host. Do **not** derive it from the request/browser host (removed in `d2f13ed`): on app.kandryn.com that yields `clerk.app.kandryn.com`, which does not exist. `CLERK_PUBLISHABLE_KEY` must be set server-side or `clerkMiddleware()` throws "Publishable key is missing" on every request.
- **Backend:** `@clerk/express` — `clerkMiddleware` in `app.ts`; `requireAuth` gates all authenticated `/api` routes and sets `req.userId`.
- **Frontend:** `@clerk/react` — `ClerkProvider` wraps the app; unauthenticated → `/app/sign-in`.
- **Sign-in is intentionally simplified** (`App.tsx` + `HideClerkDevBadge`): Clerk "Development mode" badge hidden, GitHub/Google social logins hidden, "Sign up" replaced by **"Request Your Access"** → a full-page link to the marketing **`/contact/`** page. Clerk sign-up still exists at `/app/sign-up`.
- **GitHub OAuth auto-sync:** `POST /api/auth/github-sync` upserts the Clerk-held token as `GITHUB_TOKEN` (via `useGitHubSync`). Since GitHub login is hidden, in practice users paste a `GITHUB_TOKEN` PAT in **Settings**.
- Env: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`.

---

## 6. Database schema

PostgreSQL on **Supabase**. Schema in `lib/db/src/schema/`. **All PKs are `serial` integers** (a uuid FK can't reference a serial PK). **Every query scoped to `userId`** — no global data.

`pnpm run db:migrate` = **`drizzle-kit push`**. For **additive** prod changes, also add an idempotent `docs/db/NNNN_*.sql` and apply it in the Supabase SQL editor before deploying (else the new column 500s the write path). Applied so far: `0001_projects_runs_hierarchy.sql`, `0002_runs_committed_suggestion.sql`. Later additive migrations to apply in Supabase before deploy: `0007_test_cases.sql`, `0008_score_breakdown.sql`, `0009_veria_review.sql`, `0010_graphify_graph.sql`, `0011_run_graph_context.sql`, `0012_test_script.sql`, `0013_run_stack.sql`, `0014_aegis.sql`, `0015_narratia.sql`, `0016_aegis_remediation.sql`, `0017_multitenancy.sql`, `0018_audit_log.sql`, `0019_repositories_project_scope.sql`, `0020_per_project_repositories.sql`, `0021_graph_status.sql`, `0022_suggestion_files.sql`, `0023_suggestion_file_source_sha.sql`, `0024_suggestion_file_diff.sql`, `0025_change_plans.sql`, `0026_suggestion_file_deviation.sql`, `0027_suggestion_superseded.sql`, `0028_coherence.sql`, `0029_confidence_gate.sql`, `0030_model_pinning.sql`, `0031_audit_retention_override.sql`, `0032_segregation_of_duties.sql`, `0033_audit_hash_chain.sql`, `0034_aegis_override.sql`, `0035_baseline_scan.sql`, `0036_baseline_file_paths.sql`, `0037_baseline_model.sql`, `0038_sequence_guard.sql`, `0039_agent_failures.sql`, `0040_context_manifest.sql`, `0041_project_knowledge.sql`, `0042_ui_style_profiles.sql`, `0043_jira_forge.sql`.

> **`drizzle-kit push` does not create triggers.** `0033` (audit hash chain) and `0038` (override immutability) both install one, and a database brought up by push alone has the tables without them — every other check passes while the rows are silently mutable. Those two must be applied by hand.

| Table | Key columns |
|---|---|
| `repositories` | `id`, `user_id`, `name`, `provider` (`github`\|`azure-repos`), `url` (nullable — cleared when flagged), `default_branch`, `project_id` (**owning project — single source of truth for the binding (0020); resolve via `repositories WHERE project_id=…`**, plain int FK in SQL only), `needs_reconfiguration` bool, `needs_verification` bool (set on migration-cloned rows), `stack_profile` jsonb, `graph_json`/`graph_built_at`/`graph_node_count`, `graph_status` (`idle`→`indexing`→`succeeded`\|`failed`, 0021)/`graph_error`, `created_at` |
| `projects` | `id`, `user_id`, `name`, `plm_provider` (`jira`\|`azure-devops`), `plm_project_key`, `plm_project_name`, `repository_id` (**@deprecated 0020 — no longer written; nullable; the binding lives on `repositories.project_id`**), `default_target`, `last_synced_at`. **Unique (user_id, plm_provider, plm_project_key)** |
| `tasks` (= work items) | base task fields + `project_id` FK (cascade), `parent_id` self-FK (set null), `item_type` (`epic`/`story`/`task`/`bug`/`test_case`), `plm_url`, `plm_status`, `plm_updated_at`. Status: `open`/`in-progress`/`review`/`done`/`blocked`. Indexed on user_id, project_id, parent_id |
| `runs` | `id`, `user_id`, `project_id`, `work_item_id`, `repository_id` (**snapshot of the target repo taken at run creation (0020); `executeRun`/`commitFromSuggestion` read it via `getRunRepository`**, plain int FK in SQL), `status` (`scheduled`/`queued`/`running`/`succeeded`/`failed`/`canceled`), `trigger` (`manual`\|`scheduled`), `refine_prompt`, `auto_commit`, `scheduled_at`/`started_at`/`finished_at`, `error`, `pr_url`, `commit_hash`, `committed_suggestion_id` (plain int, no FK — avoids a schema import cycle), `context_manifest` jsonb (**what project context the run's prompts carried (0040) — identifiers, paths and counts only, never the pack text**). Indexed on user_id, (status, scheduled_at) |
| `suggestions` | `id`, `run_id` FK, `agent` (`claude`/`openai`/`copilot`/`antigravity`), `explanation`, `language`, `score`, `recommendation`. **`code`/`file_path` @deprecated (0022) — nullable, no longer written; the change set lives in `suggestion_files`** |
| `suggestion_files` | `id`, `suggestion_id` FK (cascade), `seq`, `op` (`create`/`edit`/`delete`), `file_path`, `content` (resolved content for create/edit), `hunks` jsonb (edit search/replace pairs, 0023), `source_blob_sha` (source read at generation, for staleness, 0023), `diff` jsonb (structured server-computed diff, 0024), `resolved`, `apply_status` (`pending`/`applied`/`failed`), `apply_error`, `lines_added`, `lines_removed` (0022). **Unique (suggestion_id, seq)**. Generation emits one file. Read via `loadSuggestionFiles`/`suggestionPrimaryFile` (`services/suggestionFiles.ts`) |
| `teams` / `team_members` / `team_invites` / `team_integrations` | multi-tenancy (0017). `teams.audit_retention_days` (0031), `teams.sequence_policy` (`off`\|`warn`\|`admin_override_only`, 0038) |
| `audit_log` | immutable action trail (0018) + tamper-evident per-team hash chain `prev_hash`/`row_hash`, set by a DB trigger (0033). Writes are **fire-and-forget, never awaited** |
| `change_plans` / `change_plan_files` | the pre-generation plan (0025): `candidate_files` jsonb, `retrieval_mode`, `confidence_score`/`confidence_signals` (0029), `notes` (records context truncation) |
| `aegis_overrides` | immutable record of a cleared security gate (0034) — frozen findings, mandatory reason, `same_actor` |
| `baseline_scans` | whole-codebase security scan via Anthropic Message Batches (0035–0037) |
| `work_item_links` | dependency edges (0038). `link_type` `blocks`\|`parent`\|`relates`, `source` `tracker`\|`inferred`\|`manual`. Only `blocks`/`tracker` is written today; `source` is in the unique key so a human-confirmed edge can coexist with the tracker's |
| `sequence_checks` | snapshot of a run-order check as **shown to a user** (0038) — findings, facts, `fingerprint` (staleness), cached `impact`, 15-min expiry |
| `sequence_overrides` | **immutable** decision record (0038). A DB trigger blocks every UPDATE except the four `ON DELETE SET NULL` FKs, so deleting a run leaves the record standing. `record_hash` excludes those FKs for that reason |
| `integration_configs` | composite PK (`user_id`, `key`), `value` — **encrypted at rest** via `configCrypto.ts` (AES-256-GCM) when `CONFIG_ENCRYPTION_KEY` is set. **Never log** |
| `knowledge_sources` | an uploaded project document (0041): `doc_type` (`architecture`\|`requirements`\|`design`\|`other`), `title`, `file_name`, `mime_type`, `size_bytes`, `storage_path`, `content_hash`, `status` (`pending`→`parsing`→`ready`\|`failed`), `error`, `chunk_count`, `parsed_at`. **Partial unique (project_id, content_hash) WHERE content_hash IS NOT NULL** — one upload of the same bytes per project. **Document text never lives here** |
| `knowledge_chunks` | a retrievable passage (0041) — the **only** place document text lives. `source_id` FK (cascade), `user_id`/`project_id` **denormalised so retrieval filters both without a join**, `seq`, `heading` (path, e.g. "Architecture > Billing"), `page` (pdf), `text`, `tsv` **stored generated tsvector + GIN index**. Unique (source_id, seq) |
| `ui_style_profiles` | how a project's UI is already styled (0042) — **one row per project** (`UNIQUE (project_id)`). `status` (`pending`→`extracting`→`ready`\|`not_applicable`\|`failed`), `stale`, `enabled`, `revision`, `ui_root`/`ui_root_options`, `source_ref` (HEAD at extraction), `framework`/`tokens`/`components`/`conventions`/`exemplars`/`warnings` jsonb, `claimed_at` (the claim three callers race for). **Extracted by static parsing only — no repository code is ever executed, and no file CONTENT is stored**, only validated values with evidence (file, line) |
| `jira_installations` | a Jira site with the Forge app installed (0043). `installation_id` (**unique**), `cloud_id`, `site_url` (from the token's signed `context.siteUrl`, normalized), `environment`, `status` (`active`\|`disabled`), `installed_at`/`last_seen_at`. Created on the first verified call, so a missed install event is not a broken install |
| `jira_account_links` | which Jira user is which Kandryn user (0043). `installation_id` FK, `atlassian_account_id` (**the token's `principal` claim** — Atlassian does not document it as the account id, so it is an opaque bounded string), `user_id` (Clerk), `revoked_at`. **Partial unique (installation_id, atlassian_account_id) WHERE revoked_at IS NULL** — revoked rows stay for audit, and a second active link raises 23505 → 409 |
| `jira_link_codes` | the typed linking codes (0043). **`code_hash` only — the code itself is never stored**; `installation_id`, `atlassian_account_id`, `expires_at` (10 min), `used_at`, `failed_attempts` (dead at 5) |
| `jira_site_map` | `cloud_id` → normalized `site_url` (0043), fed from the signed token claim. A cache for display and normalization, never a substitute for the token |
| `waitlist` | marketing signups |

### Config keys (`configService.ts → CONFIG_KEYS`)
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GEMINI_API_KEY`, `GITHUB_COPILOT_TOKEN`, `GITHUB_TOKEN`, `AZURE_REPOS_ORG`, `AZURE_REPOS_TOKEN`, `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_PAT`, `JIRA_DOMAIN`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `CONFLUENCE_DOMAIN`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`, `CONFLUENCE_SPACE_KEY`, `NOTION_API_TOKEN`, `NOTION_PARENT_PAGE`. All AI/Git/PLM/docs creds are **per-user** here, not env vars. The Zod schema for `PUT/PATCH /api/config` is auto-built from this array.

---

## 7. Functional flows (the product lifecycle)

The end-to-end user journey, mapped to the code paths:

1. **Connect** — in **Settings**, save per-user credentials (Anthropic, GitHub PAT, Jira or ADO). Connect a **repository** (stack auto-detected).
2. **Create a project** (`/projects/new`) — 3-step wizard binds one **PLM project** + one **repository**. Create validates both bindings live and rejects a duplicate PLM binding with a friendly 409.
3. **Sync** (`POST /projects/:id/sync`) — pulls the epic→story→task hierarchy from Jira/ADO into `tasks`, keyed on `(project_id, external_id)`; resolves parents; cancels pending runs on items that closed upstream.
4. **Author work** — **New item** (local or pushed to the PLM) and **Break down** an epic/story into AI-proposed children you edit/approve.
5. **Run** — from a work item, **Run now** (inline) or **Schedule**. The **run-order check** (0038) runs first: clear items start with no dialog, out-of-order ones open the Sequence dialog and need an explicit, recorded override. `runService.executeRun` fetches Git context, runs Claude + OpenAI, ranks with the SynthesisEngine, and persists suggestions. Scheduled runs are claimed by the cron dispatcher.
6. **Commit** — commit the chosen suggestion → branch `task/<id>` → PR `[Kandryn] <title>`; the item moves to **review**; `committed_suggestion_id` is recorded.
7. **Test** — generate Given/When/Then cases + a runnable script, commit the script onto the **same PR**, and push selected cases back to the PLM (mirrored locally as `test_case`).

---

## 8. API endpoints

Public (mounted **before** `requireAuth`): `POST /api/waitlist`, `POST /api/contact`, and the cron dispatcher. Everything else requires `requireAuth`.

- **Repositories:** `GET/POST /api/repositories`, `GET/PATCH/DELETE /api/repositories/:id`, `GET /api/repositories/:repoId/stack`. **Graphify:** `GET /api/repositories/:repoId/graph` (status: `built`/`builtAt`/`nodeCount`/`stale`), `POST /api/repositories/:repoId/graph` (upload graph.json), `POST /api/repositories/:repoId/graph/rebuild` (re-index via the microservice; `202`, or `503` when unconfigured).
- **Projects:** `GET /api/projects` (with counts), `POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `POST /api/projects/backfill`, `GET /api/plm/:provider/projects`, `POST /api/projects/:id/sync`, `GET /api/projects/:id/work-items`, `POST /api/projects/:id/work-items` (`pushToPlm`).
- **Work items:** `PATCH /api/work-items/:id` (local edit; `done` propagates via `closeTask`), `POST /api/work-items/:id/breakdown` (proposals, not saved), `POST /api/work-items/:id/push-to-plm` (promote a local-only item into Jira/ADO → records externalId/source/plmUrl; `409` if already linked).
- **Runs:** `POST /api/work-items/:id/runs` (inline → `{run,suggestions}`; `scheduledAt` future ≤30d → `202`; ≤20 pending/user). **Gated by Sequence Guard (0038):** an out-of-order item is refused `409 SEQUENCE_CHECK_REQUIRED` / `403 OVERRIDE_NOT_PERMITTED` / `409 SEQUENCE_STALE`, each carrying a freshly recomputed `check`; an optional `sequence` block overrides, and the run + decision row are written in **one transaction**, `GET /api/runs?projectId=&status=&limit=`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel`, `POST /api/runs/:id/commit`, `POST /api/runs/:id/review` (Veria), `POST /api/runs/:id/security` (Aegis), `POST /api/runs/:id/runbook` (Narratia; body `{target: markdown|confluence|notion}`). **Confidence gate (Phase 4):** `POST /api/runs/:id/plan/approve` (generate the parked plan as-is), `POST /api/runs/:id/plan/reject` (run → `canceled`, no suggestions); edit-then-approve reuses `POST /api/runs/:id/plan/revise`.
- **Sequence Guard (0038):** `POST /api/work-items/:id/sequence-check` → `SequenceCheck`; `POST .../sequence-check/:checkId/impact` → `ImpactAnalysis`; `POST .../sequence-check/:checkId/event` (`heeded`\|`canceled`, 204). `GET /api/projects/:id/run-order` (waves + `waitsOn` per item). `GET|PUT /api/team/sequence-policy` (PUT admin-only). Admin reads: `GET /api/sequence-overrides`, `/:id`, `/export.csv`.
- **Project knowledge (0041):** `GET /api/projects/:id/knowledge` (sources only, never chunk text; also returns `storageConfigured` + `canUpload`), `POST /api/projects/:id/knowledge/uploads` (→ `{sourceId, uploadUrl, expiresIn}`; validation then access then capability, so a bad file is `400` and an unconfigured deploy `503`), `POST .../uploads/:sourceId/complete` (download, **magic-byte type check**, sha256, parse+chunk inline; duplicate → `409`), `PATCH /api/projects/:id/knowledge/:sourceId` (title and/or docType; at least one), `DELETE /api/projects/:id/knowledge/:sourceId`. **Replace a file** by passing `replaceSourceId` to `uploads` *and* to `complete`: the new source is indexed first and the old one deleted only once the new one is `ready`, so a failed replace leaves the original untouched; a replace does not consume a second slot against the 25-document cap. **Storage failures are classified**: `503 STORAGE_BUCKET_MISSING` (names the bucket + `KNOWLEDGE_BUCKET`), `503 STORAGE_AUTH`, `502 STORAGE_ERROR` — the key and project URL never appear in a response or a log. Read uses the *list* rule (owner or team member of a team-visible project); **write uses `canAdminister`**; anything out of scope is `404`, never `403`.
- **UI style (0042):** `GET /api/projects/:id/ui-style` (profile, or `{status:'none'}`), `POST /api/projects/:id/ui-style/extract` (atomic claim then extract inline; `202` + the current row when another caller holds a claim under 5 min), `PATCH /api/projects/:id/ui-style` (`enabled`, `uiRoot` — must be one of `ui_root_options`; a new root re-queues the extraction). Read uses the *list* rule; write uses `canAdminister` (**403** when the project is visible but not the caller's to change, unlike Knowledge's 404-everything).
- **Jira app (Forge, 0043) — `/api/ext/*` uses `forgeAuth`, NOT `requireAuth`:** `POST /api/ext/jira/v1/link/start` (mints a typed code; returns `pageUrl` with **no code in it**), `GET /api/ext/jira/v1/issue?key=&issueId=` (→ `not_linked` \| `not_in_kandryn` \| `ready`; `issueId` is validated but unused — see §9), `POST /api/ext/jira/v1/lifecycle/uninstalled` (the `preUninstall` endpoint; idempotent, 204). Mounted **before `requireAuth`** with the public routes, because the caller is Atlassian with a signed Forge token, not a browser with a Clerk session. Kandryn-side, under normal `requireAuth`: `POST /api/integrations/jira/link/complete` (body `{code}`), `GET /api/integrations/jira/links`, `DELETE /api/integrations/jira/links/:id` (404 for a non-owner, never 403).
- **Tests:** `POST /api/work-items/:id/tests/generate`, `.../tests/commit-script` (same branch/PR), `.../tests/push`.
- **Legacy task flow (still mounted):** `POST /api/tasks/:taskId/suggestions` (rate-limited 20/min), `.../commit`, `.../complete`; `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id`.
- **Internal (cron):** `GET|POST /api/internal/dispatch-runs` — `CRON_SECRET` bearer-guarded, before `requireAuth`.
- **Config/stats/health:** `GET /api/config`, `PUT|PATCH /api/config`, `DELETE /api/config/:key`, `POST /api/config/test/:integration`, `POST /api/auth/github-sync`, `GET /api/dashboard/stats`, `GET /api/healthz`.

---

## 9. Server architecture

```
artifacts/api-server/src/
  app.ts             Express setup: clerk middleware, routes, error handler, rate limit
  index.ts           Local entry; Vercel uses api/index.js → dist/serverless.mjs
  lib/env.ts         Startup env validation      lib/logger.ts  pino singleton
  middlewares/       requireAuth.ts, team.ts (attachTeam + requireAdmin), clerkProxyMiddleware.ts,
                     forgeAuth.ts (Forge invocation tokens — the Jira app's only gate)
  routes/            index.ts (mounts: public before requireAuth, then attachTeam, rest after)
                     repositories, projects, runs, sequence, workItems, knowledge, tests, baseline,
                     teams, reports, audit, tasks, taskActions, stats, config,
                     waitlist, contact, internal, health
  services/
    configService    per-user credential store (+ configCrypto: AES-256-GCM at rest)
    gitService       GitHub (Octokit) + Azure Repos; branch/commit/PR; commitChanges(baseSha), branchHeadSha
    repoResolver     getProjectRepository / getRunRepository (0020 binding)
    aiService        AIOrchestrator + SynthesisEngine + generateBreakdown + generateTests (+ AIFormatError)
    patchService     search/replace hunk application (strict: exact, once, no fuzzy)
    diffService      server-side structured diffs    commitResolver  staleness re-check before commit
    planningService  runPlanning + candidate retrieval + assemblePlanContext
    confidenceScore  pure scoring core  ·  confidence  db-backed signals
    contextPack      pure project-context pack compiler  ·  contextService  loadAncestors + per-run pack
    documentParser   pure: magic-byte sniff, private-key refusal, md/txt/csv/pdf/docx chunking
    knowledgeStorage private Supabase bucket: signed upload URLs, download, delete (no-op unless configured)
    knowledgeRetrieval  websearch_to_tsquery + ts_rank_cd over knowledge_chunks
    uiStyle/         pure extractors: cssTokens (postcss), tailwind (@babel/parser, NEVER executed),
                     manifest, components, validate; styleGuide = the prompt block, the
                     injection rule and the staleness predicate (PR-B)
                     uiStyleService  claim + extract + dispatch + loadProfileForRun
    jiraExt/         the Jira app's backend (0043): codes (pure: alphabet, normalize,
                     hash), entitlement (canUseJiraApp — the one gating hook),
                     installations (registry, retention, limiter), linking,
                     issueView (the panel's read model)
    coherence/       static cross-file coherence check
    plmService       closeTask across ADO + Jira
    plmProjects      list/validate PLM projects; normalizeJiraDomain(); PlmError
    plmWrite         create PLM work items + test cases (Jira/ADO)
    plmItemType      db-free type mapping (test-case label handling)
    plmLinks         db-free parsing of Jira issuelinks / ADO relations (0038)
    syncService      project-scoped PLM hierarchy sync → tasks (+ reconcileTrackerLinks)
    runService       executeRun() + commitFromSuggestion() + approvePlan/rejectPlan (+ RunError)
    veriaService     post-commit review      aegisService / aegisPlmService / aegisOverrideService
    baselineScanService (+ baselineScanCore)  whole-codebase scan via Message Batches
    narratiaService / narratiaPushService     runbooks → markdown/Confluence/Notion
    graphifyService  knowledge-graph indexing (+ graphUsability)
    securityStatus   db-free commit-status publishing (GitHub/ADO)
    pullRequestState db-free live PR state lookup (0038)
    sequenceService  run-order analysis (+ sequenceGraph, pure)
    sequenceImpactService (+ sequenceImpact, pure)  grounded impact narrative
    sequenceGate     the run-request gate + scheduled hold + outcome hooks
    sequenceRecordHash  pure canonical hash for the decision record
    auditService     fire-and-forget audit log + retention + chain verification
    teamService / resourceAdmin               teams, and canAdminister(actor, resource)
    emailService     Resend: contact, waitlist, run-completed/failed/parked/held
  adapters/          gitService, azureDevOpsAdapter, jiraAdapter  (LEGACY task flow only)
  scripts/           sequence-verify/  data-layer checks needing DATABASE_URL (see its README)
  stack/             detector.ts (path-based StackProfile), prompts.ts
```

### Subsystem notes
- **Runs engine** (`runService.executeRun`, never throws — failures land on the run row): load (scoped to `run.userId`) → keyword-extract → Git context → Claude+OpenAI → SynthesisEngine rank → persist suggestions → if `auto_commit`, commit top (branch `task/<id>` → PR), set `committed_suggestion_id`, item → `review` → mark `succeeded`; scheduled runs email the owner. **Dispatcher** (`routes/internal.ts`, cron 5-min, `CRON_SECRET`): sweep `running` >20 min → `failed`, then claim ≤2 due `scheduled` rows with `FOR UPDATE SKIP LOCKED` → `queued` → run each.
- **Sync engine** (`syncService.syncProject`): project-scoped fetch, upsert on `(project_id, external_id)`, two-pass parent resolution, ADO `Feature`→`epic`, cancels pending runs on close. Jira uses the **enhanced** `GET /rest/api/3/search/jql` (classic `/search` is **410 Gone**), paginating by `nextPageToken`/`isLast`; domains normalized via `normalizeJiraDomain` (users enter `acme.atlassian.net` without a scheme).
- **AI shapes:** `AIOrchestrator.generateSuggestions` runs both models in parallel; `SynthesisEngine` scores/ranks, flags top as `Recommended`. `generateBreakdown`/`generateTests` are zod-validated with one retry → else `AIFormatError` → 422. Mock agents (`antigravity`,`copilot`) gated behind `ENABLE_DEMO_AGENTS=true`.
- **Stack-aware prompting:** the run's `repositories.stack_profile` is threaded through the whole pipeline — `services/stackPromptBuilder.ts` (`buildStackAwarePrompt` + `describeStack`) prepends a language/framework/db/test/package-manager conventions block (+ "don't introduce a new stack" guardrail) inside `stack/prompts.ts:buildPrompt`, shared by both agents; SynthesisEngine's convention dimension is stack-explicit via `describeStack`; `gitService.fetchFileContext` already filters context files by stack extension. `runService.executeRun` logs the stack and persists `runs.stack_desc` (`0013`), surfaced in the run-detail **Stack** info cell. All graceful no-ops when `stack_profile` is null.
- **Aegis** (`aegisService.ts`, `aegisPlmService.ts`): the sixth agent — a post-commit security scan on `POST /runs/:id/security` (mirrors Veria's guard: needs `committedSuggestionId`, per-user `ANTHROPIC_API_KEY`, model **`claude-fable-5`**). Persists `runs.security_scan`/`security_scan_status`/`security_gate` (`0014`). The **stop gate** blocks on any High/Critical finding; each High/Critical finding files a PLM child (`bug`, via `createPlmWorkItem` with `parentExternalId`) and the result posts a GitHub commit status check `kandryn/security` (`postSecurityStatus` in `gitService.ts` — non-fatal). Surfaced on run detail (gate banner + findings); repo detail shows a one-time branch-protection setup notice. **Remediation loop** (`POST /runs/:id/security/remediate`, body `{findingId, action: push|remediate-now}`, `0016`): per-finding **Push to PLM** (or bulk) files the ticket + mirrors a board `bug` task (`ensureFindingTask`, keyed on project+externalId so a later sync upserts) + syncs the board; **Remediate Now** additionally starts a remediation run on the new task (`triggerContext='remediation'`, `parentRunId`, fix-only `buildRemediationPrompt`) via `executeRun` in the background, then navigates to that run. Board cards for `[SECURITY]` items show a red square. `GET /runs` gains `?trigger=&parentRunId=` filters.
- **Narratia** (`narratiaService.ts`, `narratiaPushService.ts`): the seventh agent — post-commit runbook generation on `POST /runs/:id/runbook` (per-user `ANTHROPIC_API_KEY`, model `claude-sonnet-4-5`, guard on `committedSuggestionId`). Enriches the prompt with Veria/Aegis findings + generated test cases. Persists `runs.runbook`/`runbook_status`/`runbook_target`/`runbook_url` (`0015`). Targets: **markdown** (commits `docs/runbooks/<key>.md` onto the PR branch via `branchHeadSha`+`commitChanges`), **confluence**, **notion** (both push via per-user creds — new `CONFLUENCE_*`/`NOTION_*` `CONFIG_KEYS`; each returns `null` when unconfigured, so the runbook still saves). Surfaced on run detail (target pills, generate, gate/preview with an inline md→html render). Settings gains a Documentation group.
- **Commit/PR:** branch is deterministic `task/<id>`. `GitService.commitChanges(baseSha?)` defaults to the default-branch HEAD; the **test-script commit** passes the branch's own HEAD (`branchHeadSha`) so it stacks on the existing PR instead of overwriting the implementation commit.
- **Graphify** (`graphifyService.ts`, `graphify-service/` microservice): a per-repo knowledge graph (`repositories.graph_json`/`graph_built_at`/`graph_node_count`) gives runs precise, low-token file context. `runService` picks the graph path when `isGraphServable(graphStatus, graphBuiltAt)` — **`graph_status='succeeded'` AND fresh <24h** → `git.fetchFileContextWithGraph` returns `{context, usedGraph}`; a graph marked **`stale`** (set on a repository **URL change**, since the old graph reflects different content), or `indexing`/`failed`/`idle`, is refused and retrieval falls back to tree-only (`retrievalMode='keyword'`). A URL change also fires a self-healing `triggerRepoIndex` when the microservice is configured (`stale`→`indexing`→`succeeded`). So `retrievalMode='graph'` on a plan means the graph is **current**, not merely that one exists. (`isGraphUsable` remains the age-only helper used for the repo-detail staleness badge.) `usedGraph` persists to `runs.used_graph_context` (surfaced as a "Graph context" badge on run detail). **Phase 2:** the Python microservice (`/index`) clones + runs `graphify extract` and POSTs the graph to `POST /api/internal/graphify-callback` (guarded by `GRAPHIFY_SERVICE_SECRET`); triggered fire-and-forget on repo connect. **Phase 3:** `triggerRepoIndex()` (shared helper) also re-indexes after every commit (auto + manual) and on the **Rebuild graph** button (`POST /repositories/:repoId/graph/rebuild`, `503` when `GRAPHIFY_SERVICE_URL` unset). Re-indexing is a full re-extract via `/index` (a partial sparse-checkout would drop cross-file edges); developers without the microservice can still upload a `graph.json` by hand. Graph work is a **no-op unless `GRAPHIFY_SERVICE_URL` + `GRAPHIFY_SERVICE_SECRET` are set** — the keyword fallback (`fetchFileContext`) always runs otherwise.
- **Confidence gate** (`confidenceScore.ts` pure core + `confidence.ts`, Phase 4): a pre-generation HITL check. `runPlanning` scores each `ready` plan 0–1 and persists `change_plans.confidence_score`/`confidence_signals` (raw inputs, for recalibration). Score = renormalised weighted average over available signals (absent = neutral, not a penalty): **score gap** 0.40 (top-two candidate scores, retained on `candidate_files.score`), **retrieval_mode** 0.20 (graph=1.0/keyword=0.5, relative), **candidate density** 0.20, **historical acceptance** 0.20 (exact file-set-match on prior committed, un-revised plans; neutral at 0 priors). Weights + the `projects.confidence_threshold` default **0.6 are uncalibrated placeholders**. `executeRun` gates AFTER the plan is written, BEFORE generation, covering interactive + scheduled alike: `confidence_score < threshold` → plan + run become **`awaiting_review`** (a distinct `RunStatus`, so the dispatcher's `running`-only stuck-sweep can't reap it) and generation does not start. A run with **no `ready` plan** (no key / planning failure) is not gated — Phase 1 fallback. **Exits:** approve (`executeRun(reusePlan)` — no re-plan/re-gate), edit-then-approve (`/plan/revise`), reject (run → `canceled`, nothing downstream since all guard on `committedSuggestionId`). Scheduled parks email the owner (`sendRunParked`); no auto-approve/retry/expiry — it waits indefinitely. Surfaced by the run-detail banner (signal-derived reason via `confidenceReason`), the runs-list "Needs review" badge, the left-rail counter, and the right-panel `awaiting_review` view (tags scheduled vs manual).

- **Sequence Guard** (`sequenceService` + pure `sequenceGraph`, `sequenceImpactService` + pure `sequenceImpact`, `sequenceGate`, `0038`): run-order checking with an audited override. Kandryn generates against the **default branch**, so a prerequisite that has not landed there is invisible to a run — the whole feature follows from that one fact. `analyzeWorkItem` is deterministic and model-free (≈19 ms on a 400-item project) and produces eight finding types: `unmet_blocker`, `blocker_pr_unmerged`, `blocker_gate_blocked`, `children_incomplete`, `file_overlap`, `dependency_cycle`, `out_of_rank`, `inferred_prerequisite` (the last is unused — step 9 was skipped, so **every edge in the graph came from a tracker or a human**). A **blocked Aegis gate is tested before an open PR**, because a gate-blocked item always has a PR and checking the PR first would silently demote it from warning to caution. `sequenceGate.evaluateGate` is the single place the run-request rules live, shared by the route and the dispatcher; the server recomputes on every request and **never reads a client-supplied verdict**. A `clear` verdict writes no rows at all (`computeCheck` is split from `persistCheck` for this). **Impact** is two layers: a deterministic template assessment that is always available, then an optional `claude-sonnet-4-5` narrative, zod-validated, 8 s abort, with every risk required to cite fact ids — anything citing a fact not in the bundle is dropped, and if nothing survives the deterministic layer is used. The override flow therefore never depends on a model being up. Tracker titles and acceptance criteria travel as `untrusted` facts and render inside `<untrusted>` tags; facts carry **paths, never file contents**. **Scheduled runs are re-checked at dispatch** (`holdIfOrderChanged`) — a warning the scheduling user never acknowledged sets the run to `held` and emails them; cautions do not hold. Aegis remediation is **exempt** and audited as such. Known limits: "done" is read from the tracker, not the PR (Kandryn never learns a PR merged — the impact step does a live lookup and corrects it, so the error is in the safe direction); Jira has no backlog rank, so `out_of_rank` is ADO-only; parent edges are not stored because `tasks.parent_id` already is the source of truth.
- **Project context (0040, part 1):** a run's prompts now carry the work item's **ancestor chain** — the epic and story above it — compiled once per run and given to the planner and both generators, so a plan is never made from different background than the implementation. `contextPack.ts` is the pure compiler (budget **1800 tokens**, `ceil(chars/4)`, each field clipped at 700 chars, the most **distant** ancestor dropped first because the nearer one constrains the item more); `contextService.ts` is the db-backed half — `loadAncestors(userId, projectId, taskId, maxDepth=3)` walks `tasks.parent_id` with **every hop filtered by user_id AND project_id** (a repointed parent must not pull another tenant's item into a prompt), cycle-guarded, and `buildRunContextPack` never throws. Ancestor text is tracker-authored, so it renders inside `<untrusted>` tags and the delimiter is neutralised in the text. Injection is a single point — `taskSection()` in `stack/prompts.ts`, shared by `buildPrompt` and `buildPlanPrompt` — plus `buildPlannerPrompt`. `runs.context_manifest` records what went in (counts, tracker keys, token cost); an item with no ancestors gets exactly the prompt it got before, and a null manifest. Surfaced as the run-detail **Context** info cell.
- **Project knowledge (0041, part 1 PR-B):** a customer uploads the architecture or requirements documents they already have, and a run retrieves the passages that bear on its work item. Upload is a **signed-URL** flow (browser → bucket directly) because `@vercel/node` caps a request body at 4.5 MB and a real architecture PDF is larger; the server mints the path (`<userId>/<projectId>/<random>/<sanitized name>`) and the client never chooses it. `complete` verifies the **real type by magic bytes** (not the extension, not the client's mime type), hashes, parses and indexes inline. Retrieval is **Postgres full-text, not embeddings** — `websearch_to_tsquery` with the terms **OR-joined** (an AND query over a title plus acceptance criteria matches no single passage) ranked by `ts_rank_cd`, with a **rank floor of 0.25** so weakly-matching noise is not injected; below the bar the pack simply carries no reference section. References get **1000 of the pack's 1800 tokens**, the parent chain claims its share first, and the budget drops the **lowest-ranked** passage first. **Framing is deliberate: documents are REFERENCE, never authority** — unreviewed, often out of date, and the work item's acceptance criteria govern. Reviewed authoritative knowledge is a later feature; no UI or prompt text here may call a document a rule. Two refusals: a file whose bytes contradict its extension, and any document containing a private key block (object deleted, match never echoed). Everything is a **no-op unless `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set**.
- **UI style profile (0042, part 2 PR-A):** what a project's interface already looks like, read from the repository so a generated UI matches it instead of inventing a second design language. **Everything is deterministic — no model extracts the profile**, because a style rule the model guessed is exactly the failure the domain-context design notes warn about, and a wrong token is visible on every screen. The customer's repository is untrusted input and is **never executed, imported, required or eval'd**: `uiStyle/cssTokens.ts` parses CSS variables with postcss and keeps the declaring **selector** (`:root`, `.dark`, `[data-theme=…]`, `@theme`) so the light and dark value of one name stay distinct; `uiStyle/tailwind.ts` reads a Tailwind or theme config with `@babel/parser` (`errorRecovery`) and walks the AST — a value that is not a literal (a spread, `require()`, a computed group) becomes a **warning**, never a guess; `uiStyle/manifest.ts` reads `package.json`, `components.json` and tsconfig path aliases (a `catalog:`/`workspace:` specifier is a resolution, not a version, so it reads as null); `uiStyle/components.ts` finds UI roots by **file markers** (a package.json with a UI dependency, `angular.json`, a `.csproj` beside `.razor`), picks the root with the most component files, resolves import paths through the aliases, and reports used-by counts **only from a servable Graphify graph** — `null`, rendered "not measured", rather than a fabricated number. `stack_profile.frontend` is deliberately **not** used as the applicability signal: it is `has("angular.json") ? angular : has("vue.config") ? vue : has("package.json") ? react : none`, so every repository with a package.json claims react. Bounded by construction: **40 files, 200 KB each, a 60 s budget**, and per-category caps (40 colours, 12 typography, 8 radius, 12 spacing, 6 shadows, 20 other) applied *after* theming is computed from the uncapped set. Every extracted string is validated before storage (`uiStyle/validate.ts`: a conservative CSS value pattern, max 80 chars, rejecting `url(`, `expression(`, `javascript:`, angle brackets and backticks; names `^[A-Za-z0-9_.$@/-]{1,80}$`; paths must appear in the fetched tree) and anything that fails is dropped and counted. **Values and evidence only — no file contents are stored**; exemplars are `{path, sha}`. `uiStyleService.ts` is the db half: `claimProfile` is a **single conditional UPDATE**, so the three things that can start an extraction (the row written at project creation, the settings page, the cron dispatcher) produce one winner and one no-op without a lock table; a claim older than 10 min is reclaimable, a fresh one is answered `202`. `runExtraction` never throws — a failure lands on the row, like `executeRun`. `dispatchPendingProfiles` is an additive **step 5** in the dispatcher, after the run claim, so a slow extraction can never delay a scheduled run. A repository **URL change** resets the profile in the same block where the graph goes `stale`.
- **UI style in a run (0042, part 2 PR-B):** the profile reaches the **generation prompt only** — both agents and the edit-repair hook — and never the planner, Veria, Aegis, Narratia, test generation or breakdown. It travels as its own `styleGuide` field on the prompt `Task` rather than folded into the part-1 context pack string, so `buildPlannerPrompt` (which takes only `contextPack`) **cannot** receive it by accident; `taskSection()` renders it, which is why both generation prompts are byte-identical. `buildStyleGuideBlock` (pure, in `uiStyle/styleGuide.ts`) emits a `<ui_style_guide>` block inside **700 tokens**, trimming spacing → shadows → lowest-ranked components → lowest-ranked colours, and carries only component names that were genuinely **read from source**: the extractor falls back to the file stem for files it did not sample, and `button from "@/components/ui/button"` in a prompt reads as the HTML element. (The extractor now samples **primitives first** for the same reason — a path-order sample never reached `components/ui`.) **The decision is made after planning**, in `runService.resolveStyleGuide`, because the plan's file list is what says whether the change touches the interface at all: inject when the profile is `ready` + `enabled` + has a `uiRoot` **and** at least one planned file is a UI file under that root (`.tsx .jsx .vue .svelte .html .css .scss .razor`, `*.component.ts`); with **no plan at all**, fall back to `stack_profile.frontend` present **AND** UI words in the item text — conjoined because `frontend` alone reports `react` for every repo with a package.json. A `uiRoot` of `""` is the repository root, so the test is `!= null`, not truthiness. A **stale** profile is still used: out-of-date tokens are still this project's tokens, and the tab already says so. The profile is resolved through the **project owner** (`loadProfileForRun`), not `run.userId` — the same tenancy trap 0040 hit. Everything is best-effort: a profile that cannot be read leaves the run with exactly the prompt it had before. `runs.context_manifest` gains `uiStyle: {profileId, revision, injected, approxTokens}` via the pure `mergeUiStyleManifest`, and the manifest **version moves to 2** (readers tolerate 1, 2 and null); the run-detail **Context** cell adds "UI style rN". A Kandryn commit touching a styling file (`.css/.scss/.sass/.less`, `tailwind.config.*`, `theme.*`, `tokens.*`, `components.json`, anything inside a `ui/` folder) marks the profile **stale** via `markStaleIfStyling` — fire-and-forget beside the existing `triggerRepoIndex`, on both the auto-commit and manual-commit paths, and deliberately **not** a re-extraction.
- **Jira app (Forge), phase 1 (0043):** Kandryn appears inside Jira Cloud as a **read-only** issue panel. Nothing is written to Jira and nothing can be started from Jira; later phases add a Run button, a board view and Azure DevOps. Every request from the panel arrives as a **Forge Invocation Token**, and `middlewares/forgeAuth.ts` is the only thing that says who is calling: the whole JWT is verified against Atlassian's key set (`forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json`, issuer `forge/invocation-token`, audience `FORGE_APP_ID`) with the **algorithm pinned** and `alg: none` and HS256 confusion refused, then and only then are the claims read. **The panel cannot assert its own identity** — installation, Jira user (`principal`) and Jira site (`context.siteUrl`) all come out of the signed token, and a `siteUrl` in the query is ignored. A key-server outage is **503, never an allow**; an unset `FORGE_APP_ID` is 503 too, because a middleware that cannot check the audience must not pass anything. **Identity is a one-time link, by a TYPED code.** `/link/start` mints a 10-character code from an alphabet with no `0/O`, `1/I/L` or `U`, stores **only its sha256**, and returns a `pageUrl` carrying **no code**. That is the whole security design: a clickable link would let an attacker mint a code against their own Jira account, send the URL to a Kandryn user, and have that user's click bind the attacker's Jira account to the victim's data — so the code must be read off the person's own panel and typed into their own session. Codes die after 10 minutes, one use, or 5 wrong guesses; a new code burns the old one; every failure answers with **identical text**, because the difference between "wrong" and "expired" is what a guesser wants. A Jira account already linked to another Kandryn user is a **409, never an overwrite**. The issue endpoint reads **as the linked user** under the same predicate the Knowledge routes use (owner, or a member of the team owning a team-visible project), and **"no access" and "no match" are byte-identical** — saying an issue exists in a project someone cannot open is itself a leak. Matching is **site + key**: the site is compared against the host inside `tasks.plm_url` (which sync writes as `<domain>/browse/<KEY>`), the only site identifier Kandryn stores, which keeps this feature away from the PLM credentials in `integration_configs` — **the extension never uses them**. `tasks.external_id` holds the Jira **key**, not the numeric id, so **moving an issue between Jira projects breaks the link until the next sync** (a known, accepted limit; `issueId` is accepted by the route so the contract need not change when it is fixed). Only the contract's fields leave `issueView.ts` — no logs, diffs, prompts, context pack or document names — and a failing sub-service degrades that one section into `degraded[]` with a **200**, because a 500 in a Jira sidebar reads as "Kandryn is broken". **Kill switch:** `JIRA_EXT_ENABLED=false` answers 503 on every ext route *before* any token or database work, so the feature turns off in Vercel without a deploy. **Entitlement:** `canUseJiraApp(userId)` returns true for everyone today and exists so a plan check lands in one file. Retention is an additive **step 6** in the dispatcher: an installation disabled 30 days loses its links and unused codes, keeping the installation row for audit. Declaring a Forge remote means egress, which **forfeits the "Runs on Atlassian" badge** — accepted deliberately.
- **Generation resilience (0039):** `generateSuggestions` returns `{suggestions, failures}` rather than swallowing a rejected agent. Failures persist to `runs.agent_failures` and surface as an amber note on run detail, because a run quietly dropping from two candidates to one is what turns a single bad reply into a failed run. A run where **every** agent failed now throws instead of reporting success with zero suggestions. Both providers share one `OUTPUT_CONTRACT` system prompt (the Claude call previously had none), and a reply that stops on `max_tokens` says it was cut off mid-JSON instead of surfacing as a parse error. An edit whose search block is not in the file gets **one** corrective attempt against the real content (`resolveFileOps`'s `repair` hook) — only `no_match`, since `multiple_matches`/`overlap` mean the model read the file correctly; a repair that also fails leaves the original error and stores nothing.

### Error-handling conventions
- Express 5 auto-propagates async throws → global handler in `app.ts` returns `{ error }`. Use try/catch only to return a non-500.
- Typed errors → HTTP: `PlmError` → 424 (`not_connected`) / 502; `RunError` → its `.status`; `AIFormatError` → 422.
- **Unique-constraint (pg `23505`) → 409.** Drizzle wraps the pg error in `DrizzleQueryError`, so the SQLSTATE is on **`err.cause.code`**, not `err.code` — the global handler and route catches check both. Routes also pre-check (e.g. duplicate project binding) for a friendlier message + `existingProjectId`.
- **Logging:** never `console.log` — `req.log.*` in handlers, `logger.*` elsewhere. **Rate limit:** only `POST /api/tasks/:taskId/suggestions` (20/min).

---

## 10. UI/UX — the app (`/app`, dev-copilot)

**Shell** = `AppShell` (Sidebar + TabBar + scrollable `<main>`), a **tabbed** interface driven by `TabsContext.open(href)`. Global `Toaster`. Routing = **wouter** (base `/app`), data = **TanStack Query** + a plain-`fetch` client.

### Design language (Claude-Code-inspired)
- Dense, quiet, monochrome. Tokens live in **`src/index.css`** (dark is default `.dark`; light mirrors). Accent is **teal** `--accent-blue:#19c39a` (misnamed). Key dark tokens: `--bg-app:#0b1110`, `--bg-surface:#0f1614`, `--bg-raised:#141b18`, `--bg-hover:#1b2420`, `--hairline:#1e2a26`, `--text-primary:#e6efea`, `--text-secondary:#8fa39a`, `--text-muted:#5c6e66`. Type scale `--fs-2xl…--fs-xs` (22→11px). Fonts **Inter** + **JetBrains Mono**. **Do not** re-point to the legacy `src/styles/tokens.css` blue palette.

### Sidebar (`components/layout/Sidebar.tsx`)
Small type, **monochrome single-color SVG icons** (muted, brighten to primary on hover/active), quiet bordered actions. Top→bottom: logo + "Kandryn" wordmark; **Projects** switcher (dropdown → board / "New project…"); **repository** switcher (dropdown → set active / "Manage"); a quiet bordered **New task** button; **Search tasks** (⌘K → `/tasks`); **Workspace** nav (Dashboard/Tasks/Repositories/History) with a subtle active background; footer with **Azure/Jira** status dots (green when connected), **theme toggle** ("Light/Dark mode"), user avatar+name, and **Settings** + **Sign out** icon buttons. Collapses to an icon rail below 1100px.

### TabBar (`components/layout/TabBar.tsx`)
Renders open views as tab chips (icon + label + close ✕) with a "+" dropdown to open Tasks/Repositories/Dashboard/History/Settings. `open(href)` focuses an existing tab or opens a new one.

### Routes & pages (`src/App.tsx`)
| Route | Page | UX |
|---|---|---|
| `/dashboard` | `dashboard.tsx` | Stats overview (`GET /api/dashboard/stats`) |
| `/projects/new` | `new-project.tsx` | **3-step wizard**: Name → PLM project → Repository. Stepper header (check/active states). Step 2 = provider toggle (Jira/ADO) + live project list (skeletons; not-connected → link to Settings; error; empty). Step 3 = repo list (empty → connect link), plus one line: "Next you can add documents for background (optional)." Create → **Project settings → Knowledge with `&welcome=1`** (the optional post-create document step), not the board. **On 409 duplicate → "Already connected" toast + "Open project" action** (unchanged). |
| `/p/:projectId/board` | `project-board.tsx` | **Kanban**: header (name, provider·key, N items, last-synced) + actions (Runs, Sync, New item). Epic **filter pills**. 4 columns: Open(+blocked)/In progress/Review/Done. Cards: type badge, externalId, title, plmStatus, external PLM link, **scheduled clock badge**; hover actions **Break down** (epic/story) and **Run** (non-epic). States: loading skeletons, empty ("Click Sync…"), error. |
| `/p/:projectId/runs` | `runs.tsx` | Runs list — rows (title, #id, trigger, time, status badge, cancel ✕ for scheduled/queued); live-refresh while any run is active; empty state; click → run detail |
| `/p/:projectId/settings` · `/projects/:projectId/settings` | `ProjectSettingsPage.tsx` | **Project settings**, tabbed on `?tab=` (same read-once pattern as the user Settings page — the URL is not rewritten on switch). **General** = name, PLM binding, confidence threshold, segregation of duties, model pinning, governance link, repository, delete. **Knowledge** = `components/knowledge/KnowledgePanel.tsx` — the single home for project documents (0041). A drop zone + **multi-file** picker builds a **queue** (one row per file: name, size, type select, title, remove), with a "Type for all" select above it; client validation flags a bad file *on its row* and never blocks the others. Uploads run **3 at a time** with per-row progress (XHR `upload.onprogress` — `fetch` cannot report request progress in Safari), states queued → uploading → processing → done/failed; a done row leaves the queue for the table, a failed row stays with a **Retry**. Below sits the **documents table** (Title, Type, File, Size, Status, Chunks, Added, Actions) sorted newest-first, sortable by header, polling every 3 s only while a row is pending or parsing. Actions are two icon buttons: **Change** (pencil → Radix dialog: rename, retype, optionally replace the file) and **Delete** (trash → Radix alert dialog; the confirm button is neutral, not red). The pure logic — `validateFile`, the queue reducer, `sortSources`, the display helpers — lives in `lib/knowledgeQueue.ts` so it can be tested (a `.tsx` cannot be). A storage misconfiguration shows an amber banner and hides the add area; the table still works. Both path shapes render the same page. `GET /projects/:id` is **owner-only**, so for a non-owner team member the General tab is hidden and only Knowledge opens — it has its own server-side rule and must not lose the read access 0041 granted. With `?welcome=1` the Knowledge tab shows the optional post-create banner: "Add project documents (optional)", primary **Skip for now** → board (label becomes **Continue to board** once a document exists), secondary **Add documents** → scrolls to and focuses the upload area. The banner is driven **only** by the URL flag — nothing is stored, reloading shows it again, opening the tab normally never does. Storage unconfigured ⇒ no banner, straight to the board. **UI style** = `components/uistyle/UiStylePanel.tsx` — the project's read-only UI style profile (0042): a status chip (Ready / Analyzing / Out of date / Not applicable / Failed) with the commit it was read at, a **Re-extract** button, an **enabled** switch (whether runs carry it), and a **UI location** select when more than one UI root was found — changing it re-queues the extraction, because the tokens on the row describe the old root. Below, collapsible sections: framework + libraries, design tokens as **swatches grouped light/dark** (a token declared under `.dark` is the dark value of the same name, so one list would put two colours under one label), the components table (name, group, import path, used-by — **"not measured"** when no graph is servable, never a faked count), conventions, and exemplar files. Each value hovers to its evidence (`src/index.css:14`). Extraction warnings render in **amber**; the swatches show the customer's own colours as data, which is the one place colour outside the token set is allowed. The display logic — `statusLabel`, `isSettling`, `groupColorsByScheme`, `swatchColor`, `orderComponents`, `evidenceLabel` — lives in `lib/uiStyleView.ts` for the same reason `knowledgeQueue.ts` does. A non-owner team member reads the tab and sees the controls disabled (`canEdit: false`). |
| `/p/:projectId/knowledge` | — | **Redirect** to `/p/:projectId/settings?tab=knowledge`, query string preserved so `welcome=1` survives. Kept so older links and bookmarks still land in the one place documents live. |
| `/p/:projectId/governance` | `GovernancePage.tsx` | Read-only governance-policy summary, linked from the General tab |
| `/runs/:runId` | `run-detail.tsx` | Run workspace — status badge, run info card (trigger, auto-commit, scheduledAt, refinePrompt, error, PR link; the **Context** cell reads the manifest and shows "2 parent items · 1 document · UI style r3"), **polls while in progress**, suggestion cards (agent, Recommended badge, score, filePath, explanation, code, **Commit**), then **TestStage** once succeeded + committed |
| `/tasks`, `/tasks/new`, `/tasks/:id` | `tasks.tsx`, `new-task.tsx`, `task-detail.tsx` | **Legacy** single-task flow (pre-projects) |
| `/workspace/:taskId` | `WorkspacePage.tsx` | **Legacy** 3-column workspace (uses `components/workspace/Stepper.tsx`) |
| `/repositories`, `/repositories/:id` | `repositories.tsx`, `repository-detail.tsx` | Repo list + detail with the detected stack panel (`components/dc/StackBadge.tsx`) |
| `/history` | `HistoryPage.tsx` | Past activity |
| `/settings` | `SettingsPage.tsx` | Per-user integration credentials (the `CONFIG_KEYS`) + connection tests |
| `/sign-in`, `/sign-up` | Clerk pages (simplified, see §5) | |

### Key dialogs/panels
- **RunPanel** (`components/runs/RunPanel.tsx`, Sheet) — refinement textarea, **auto-commit** checkbox (off by default), **Schedule for later** checkbox → `datetime-local` (default +1h, ≤30d), footer **Run now** / **Schedule run**. Run now → navigate to run detail; Schedule → toast + refresh the board's scheduled badges.
- **NewItemDialog** (`components/workitems/NewItemDialog.tsx`) — type (epic/story/task/bug), parent (epics/stories), title, description, acceptance criteria, **"Also create in Jira/ADO"** toggle.
- **BreakdownDialog** (`components/workitems/BreakdownDialog.tsx`) — calls breakdown on open (loading), shows editable proposal rows (checkbox, type select, title, description, AC bullets), batch **"Also create in PLM"**, creates approved children under the parent.
- **SequenceDialog** (`components/sequence/SequenceDialog.tsx`, 0038) — the run-order gate, on the **Radix dialog** so focus trapping, Esc and aria come from a primitive that already gets them right. Step 1: findings (severity in **words** as well as colour) + "Do this first". Step 2: impact, reason category, free-text reason, acknowledgement checkbox. Warnings use the **amber** token — never red; this is a caution about ordering, not a failure. Closing posts `canceled`, opening a blocker posts `heeded`. The submit rule lives in `lib/overrideReady.ts` (extracted so it can be tested — a `.tsx` cannot be, since the dev-copilot runner strips types but does not compile JSX) with its minimum pinned to the server's by a test.
- **RunOrderView** (`components/board/RunOrderView.tsx`) — open work grouped into waves, cycle group separate. A board view toggle, not the legacy `/tasks` page, because `run-order` is project-scoped. The board's "Waits on PAY-A" chips come from the **same single call**, so there is no request per row.
- **SequenceDecisions / SequencePolicySection** (`components/settings/`) — the Decisions sub-view on the audit tab (detail drawer + CSV export) and the admin-only policy radio on the team tab.
- **TestStage** (`components/tests/TestStage.tsx`) — **Generate tests** → editable test **script** (filePath + code, framework badge, Regenerate, **Commit to PR**) + **test cases** (Given/When/Then checkbox rows, **Push to PLM**; blocked with a note + **Push item to PLM** promote button when the work item isn't PLM-linked). Generated cases + script persist on the committed suggestion (`suggestions.test_cases`/`test_script`, migration `0012`), so the run detail **rehydrates** them on reload; per-case PLM push status (`plmKey`/`plmUrl`, stored on each `test_cases` entry) shows as a **Pushed · KEY** badge across reloads. Regenerate replaces both and clears push status.

### Contexts + client
`ConfigContext` (loads `/api/config`; `isAzureConnected`/`isJiraConnected`), `RepoContext` (active repo), `TabsContext` (tabs). API client = `src/services/api.ts` — `request<T>` + **`ApiError { status, body }`** (now carries the parsed error body), relative URLs, covering repositories/tasks/projects/work-items/runs/tests. Toasts via `hooks/use-toast` (+ `ToastAction`).

---

## 11. UI/UX — the marketing website (`/`, Next.js)

`website/` — Next.js 15 **static export** (`output:'export'` → `out/`, `trailingSlash:true`), app router. Sans-serif design; fonts **Archivo** (display/body) + **JetBrains Mono** (mono). Layout wraps: `SiteHeader`, `CtaBanner`, `SiteFooter`, plus JSON-LD (`organizationLd` + `softwareApplicationLd`). Pages: home (`app/page.tsx`), `how-it-works`, `faq`, `security`, `contact`, `privacy`, `terms`; metadata routes `sitemap.ts` / `robots.ts` / `opengraph-image.tsx` (both metadata routes need `export const dynamic = 'force-static'` under static export). Central copy is **final** in `lib/site.ts` (`SITE`, nav, FAQ, steps, benefits, security rows). Contact/Request-Access + Book-a-Walkthrough → `POST /api/contact` → `emailService` (Resend) → `arvind.kandula@venakaninfo.com` + `accounts@venakaninfo.com`. Waitlist → `POST /api/waitlist`. **Marketing copy must avoid fabricated metrics/traction** — product-fact/directional framing only. Build: `cd website && npm install && npm run build`.

---

## 12. Environment variables

| Variable | Critical | Notes |
|---|---|---|
| `PORT` | ✅ (local) | Local API port; Vercel manages the function |
| `DATABASE_URL` | ✅ | Supabase Postgres |
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk |
| `CRON_SECRET` | ⚠️ | Bearer for the dispatcher — **scheduled runs need it**; inline runs don't |
| `RESEND_API_KEY` / `WAITLIST_FROM_EMAIL` | ⚠️ | Email; without the key, email is a no-op |
| `APP_BASE_URL` | ❌ | Email link origin (default `https://app.kandryn.com`) |
| `ENABLE_DEMO_AGENTS` | ❌ | `true` adds mock agents (default off) |
| `AEGIS_FORCE_FAIL_PATH` | ❌ | Diagnostic fault-injection (default **unset**). When set, any changed file whose path contains this substring is forced to fail its Aegis scan → lands in `unscannedFiles` → **fail-closed block**. For reproducing the fail-closed gate on a real run; never set in normal prod. |
| `SUPABASE_URL` | ❌ | Supabase project URL for the private project-knowledge bucket (0041) |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ | Signs knowledge upload URLs — **never logged**. Unset ⇒ the knowledge routes 503 and the page says so |
| `KNOWLEDGE_BUCKET` | ❌ | Private bucket name (default `project-knowledge`) |
| `FORGE_APP_ID` | ❌ | The Forge app id (`ari:cloud:ecosystem::app/<uuid>`) from `forge register`. **Unset ⇒ every `/api/ext/jira` route is 503** — without it the token audience cannot be checked |
| `ALLOW_FORGE_DEV_ENV` | ❌ | `true` accepts DEVELOPMENT/STAGING Forge tokens while `NODE_ENV=production`. Default false — a developer install carries a real signed token |
| `JIRA_EXT_ENABLED` | ❌ | Kill switch for the Jira app. `"false"` ⇒ 503 before any token or database work |
| `GRAPHIFY_SERVICE_URL` | ❌ | Graphify microservice base URL (optional; enables server-side auto-indexing) |
| `GRAPHIFY_SERVICE_SECRET` | ❌ | Shared secret for Graphify microservice auth (`x-service-secret`) |
| `SESSION_SECRET` | ❌ | Session signing |
| `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GITHUB_TOKEN`/`AZURE_REPOS_TOKEN`/`ADO_*`/`JIRA_*` | ❌ | Fallbacks only — real values are **per-user** in `integration_configs` |

---

## 13. Key commands

```bash
pnpm run typecheck            # libs + all artifacts
pnpm run typecheck:libs       # composite libs only (run after editing lib/*)
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/dev-copilot run typecheck
PORT=3000 BASE_PATH=/api node artifacts/api-server/build.mjs               # esbuild bundle (verify API build)
PORT=3000 BASE_PATH=/app pnpm --filter @workspace/dev-copilot run build    # Vite build (needs PORT + BASE_PATH)
pnpm run db:migrate           # drizzle-kit push (prod additive: apply docs/db/*.sql in Supabase)
cd website && npm run build   # Next.js static export
```

---

## 14. Next-step candidates (known gaps — not yet built)

These are the natural next tasks; none are blocking today:
- **"States to design" (spec §7.3):** token-expired failure → banner linking to Integrations; **"Changed in Jira/ADO" conflict badge** + one-click re-sync; failed-scheduled-run **Re-run** action; richer empty states / "Queue work for tonight".
- **Work-item inline edit UI** — `PATCH /api/work-items/:id` exists (local edit; only `done` propagates to the PLM), but there's no board/detail edit form or drag-between-columns yet.
- **PLM status propagation beyond `done`** (e.g. mark In Progress when a run starts) — deferred; adds write scope.
- **Legacy vs. new flow** — the single-task flow (`/tasks`, `/workspace`, `taskActions.ts`, OpenAPI codegen) coexists with the project/board/runs flow; eventual consolidation.
- **Shell consistency** — the sidebar was quieted (Claude-Code style); TabBar and page headers could follow.
- **Git-provider auth errors surface raw.** A commit against an expired PAT
  renders GitHub's own string — `Bad credentials - https://docs.github.com/rest`
  — in the toast (`run-detail.tsx:297`, same shape in `TestStage.tsx:113` and
  `WorkspacePage.tsx:207`). It names neither the cause nor the remedy, and PATs
  expire by design, so this recurs for every pilot. A 401 from the git provider
  should read "Your GitHub token is invalid or expired — update it in Settings",
  with a link. Confirmed in production once already.
- **`github-sync` can overwrite a working PAT with a dead token.**
  `routes/config.ts:105-110` comments "Verify the token is usable", computes
  `ghRes.ok` on line 109 — and then calls `saveConfigs` on line 110 regardless.
  `useGitHubSync` runs once per browser session after sign-in, so a stale Clerk
  OAuth token can silently replace a PAT the user pasted. Only fires when GitHub
  social login is enabled for that Clerk user, which is why it has not bitten
  yet. Fix: make the save conditional on `ghRes.ok`, and do not downgrade a
  credential that already works.
- **Two Archivo weights are dead payload.** `website/app/layout.tsx:12` loads
  `['400','500','600','700','800','900']`, but the lighter type scale dropped
  800 and 900 from use — nothing on the site sets either. They still ship as
  `@font-face` rules and downloadable files (three subsets each: latin,
  latin-ext, Vietnamese). Removing the two entries is a real byte win; check
  for stragglers with `grep -rn "fontWeight: [89]00\|font-weight: [89]00"` in
  `website/` first.
- **Inferred prerequisites were deliberately skipped** (Sequence Guard step 9). Every edge in `work_item_links` came from a tracker or a human; nothing in the dependency graph is a model guess. Building it means a `sequenceInference` team flag, `source='inferred'` links capped at `caution`, and evidence quotes that must actually appear in the item text.
- **Jira backlog rank is not synced**, so the `out_of_rank` finding is Azure-DevOps-only. Jira's rank is a LexoRank string on a per-site custom field, which needs a `/field` discovery request per sync — skipped for the weakest of the eight finding types.
- **`projects.confidence_threshold` default 0.6 is still uncalibrated**, and there is now one real data point against it: run #36 scored **exactly 0.6** and passed the gate (`score < threshold`), then failed on a hallucinated edit anchor. The signal called the plan marginal and was right. `runs.agent_failures` (0039) accumulates similar evidence — `SELECT agent_failures FROM runs WHERE agent_failures IS NOT NULL` says whether a dropped agent is a one-off or a pattern.
- **UI style profile: shipped, deterministic only** (0042). The profile is read by static parsing — postcss for CSS variables, `@babel/parser` for Tailwind and theme configs, a file-marker scan for UI roots — and nothing in the customer's repository is executed, imported or evaluated. A value that is not statically readable becomes a warning, not a guess. PR-B injects it into generation only, after planning, and only when the plan touches interface files. Later, if it earns its way: a model-written conventions summary, Figma token import, and a style-check agent that reviews a diff against the profile.
- **Jira app (Forge): phase 1 backend shipped (0043), panel not yet.** `forgeAuth`, the installation registry, the typed-code linking flow and the read-only issue endpoint are in, with the data-layer checks in `scripts/jiraext-verify/`. Still to come: the `/integrations/jira/link` page (PR-B) and the Forge app itself with its manifest and runbook (PR-C). Deliberately out of phase 1: a Run button, any write to Jira, board or project pages, Azure DevOps, and a Marketplace listing. Two accepted limits, both recorded above: matching is by Jira **key** (a moved issue breaks until re-sync) and declaring a remote **forfeits "Runs on Atlassian"**. Open question for before any Marketplace step: **Atlassian's personal-data-reporting duties could not be verified** — the official API page 404'd during the investigation and only stale community threads were reachable, which disagree on whether an account id alone is personal data.
- **Domain context at connect (partly built).** The *plumbing* shipped: ancestor context (0040), uploaded reference documents with retrieval (0041), and the UI style profile (0042). What remains is the part that needs a review gate — extracted glossary, entities and **rules** with evidence, `proposed`/`confirmed` status, and only confirmed rules injected as authoritative. Documents today are reference material, deliberately not authority.

### Domain context at connect — design notes

Backlogged, and now narrower than it was: most of the plumbing shipped. A run
carries its ancestor chain (0040) and retrieved passages from uploaded
documents (0041); the UI style profile is extracted, stored and injected into
generation (0042). What is left is the part that
needs a review gate — extracted **rules** (plus glossary, entities,
workflows) with evidence, `proposed`/`confirmed` status, and only `confirmed`
rules injected as authoritative.

Why it is still wanted: `stack_profile` is technical, the Graphify graph is
structural, and neither carries domain meaning. Run #32 on the PnC demo is the
evidence — Synthesia's own critique was that the agent "interprets 'policy
existence' validation as checking whether claims are returned rather than
explicitly verifying the policy exists". It had the code and the AC and still
got the domain wrong.

Sources by value: PLM epics/stories/AC first (already synced, already in
business language); then schema/migration/validator files, where invariants
live; then high-degree graph nodes; then README/docs, and optionally
Confluence/Notion — credentials already exist for runbook *push*, so reading
them as a *source* is free. Storage would be `domain_contexts` (scope, status,
revision, model, token cost) + `domain_rules` (statement, **evidence as
file:line or PLM key**, confidence, source, status, superseded).

The risk that drives the design: an extracted rule is an LLM inference. Stored
as fact and injected into every prompt, one wrong rule silently poisons every
later run — worse than no context, because it is confident and invisible. So:
evidence on every rule, a human review gate before first use, only `confirmed`
rules injected. Same move the confidence gate makes by parking a run at
`awaiting_review`, and the same reason 0042 extracts **nothing** with a model.

Two readings of "always verified", both worth building: is the context still
true (rules cite files; a commit touching them marks the rule `needs_review`,
mirroring how the graph goes `stale` and how 0042 marks a profile stale), and
is this task consistent with the context (pre-generation contradiction check;
post-commit diff check — a sibling to Veria and Aegis).

Scope caution: "full context of the app" will not survive a large repository
inside any sane token budget. Thirty rules a human confirmed beat five hundred
the model guessed.

Open questions, unchanged: project- or repository-scoped (leaning
project-scoped meaning with repo-scoped evidence, since repos get re-pointed);
review gate before first use (recommended yes); blocking at project creation
or background with visible status (0042 chose background, and that pattern now
exists to copy); a cost ceiling on the customer's own key; advisory or
enforcing on a confirmed-rule violation; who confirms rules; and which wins
when a work item's AC contradicts a confirmed rule.

- **Known adapter caveats:** Jira create maps `task → Task` (not `Sub-task`) with a best-effort `parent` link; ADO `commitChanges` uses `changeType:"edit"` (new-file adds may fail on Azure Repos — **GitHub is the primary, auto-synced provider**); test-case push requires a PLM-linked work item.

### Marketing site — claim-verification status

Every user-facing claim in `website/lib/site.ts` and `website/lib/home.ts` was
checked against the running product during the homepage rebuild and the
supporting-pages pass. Corrections already applied (do not reintroduce):

- **A run never reads parent work items.** `dbTaskToDevCopilotTask` does not map
  `parentId`, and the prompt receives exactly title, description and acceptance
  criteria. Copy claiming the epic or story above an item is read for intent is
  false; it was on `/how-it-works` and briefly on the homepage.
  **Superseded by 0040 (2026-10-19):** a run now *does* read its ancestor chain
  (see §9, Project context). No website copy was changed — nothing on the site
  currently makes the claim either way, so the pages stay correct. Before any
  copy is written about it, note the shape: the epic and story are supplied as
  background marked untrusted, the acceptance criteria still win on conflict,
  and the chain is capped at three hops and 1800 tokens.
- **Aegis is triggered per run, not automatic**, and its status check blocks a
  merge only once the customer requires it in a GitHub ruleset/branch
  protection rule or an Azure DevOps branch policy. Any sentence asserting that
  every change is scanned, or that High findings cannot reach main, is wrong.
- **Every agent runs on the customer's own model key.** Anthropic for Raptia,
  Synthesia, Veria, Aegis and Narratia; OpenAI for Fovea. Copy saying agent
  infrastructure needs no key from the user is wrong — six of seven paths 424
  without it.
- **Synthesia weights** are correctness 30, coherence 15, conventions 15, AC
  coverage 15, readability 15, minimal diff 10, reported out of 10 — six
  dimensions, not five, and not a 0–100 score.
- **Aegis does not cover all ten OWASP categories.** It scans one file at a
  time with no cross-file or manifest context, so broken access control and
  vulnerable-components are largely out of reach. The `(2021)` label is correct
  and must not be bumped to 2025 without changing the prompt in
  `aegisService.ts` **and** adding a taxonomy-version column — the stored
  category strings would otherwise mean two different things in one chart.

`HERO_STATS` and `STEPS` (and `DemoSection`/`StepsSection`/`PlugInSection`) were
deleted rather than corrected: the homepage rebuild left them with no
consumers.

`/resources` lost a featured guide, twelve resource cards and a monthly
newsletter for the same reason: none of the thirteen pieces of writing
existed. The cards rendered "Read →" as plain text with no link behind them,
each with a specific reading time, and the newsletter promised a monthly email
nobody sends. The page is now the quickstart and the changelog, both real.

Still open:

- **Write two or three real guides, then bring the cards back.** The obvious
  candidates are the ones a pilot actually needs: writing acceptance criteria
  an agent can implement, scoping a first work item, and configuring the
  security gate as a required check. Cards first and writing later is exactly
  how the fabricated version happened — write the guide, then add the card.
- **Phase 3 design pass** — extending the homepage's one-idea-per-section
  pattern to `/how-it-works`, `/integrations` and `/security`. Claims on those
  pages are now correct; their layout is not yet rebuilt. `/resources` was
  rebuilt alongside its content cut.
- The homepage and these corrections live on `claude/repo-setup-6osjsy` and are
  deliberately **not** merged to `main`.

---

## 15. Common pitfalls

- **Never `console.log` on the server** — use `req.log` / `logger`.
- **Import from `zod/v4`**, not `zod`. Newer routes use **inline zod**; `lib/api-zod` + `lib/api-client-react` codegen is **legacy** — don't add new endpoints to the OpenAPI spec unless extending the old task flow.
- **Every DB query filters by `userId`** — no global data.
- **PKs are serial integers** — keep new tables/FKs integer-keyed.
- **Additive prod schema change** = update Drizzle schema **and** add an idempotent `docs/db/NNNN_*.sql`, applied in Supabase before deploy.
- **Unique violations** surface via `err.cause.code === '23505'` (Drizzle wraps the pg error) — return 409, never leak raw SQL.
- **Relative `/api` URLs only** — Vercel routes by path; no shared proxy, no Vite proxy.
- **Build needs env** (`PORT`+`BASE_PATH` for Vite) — prefer `typecheck` + the esbuild bundle for quick checks.
- **After editing `lib/*`**, run `pnpm run typecheck:libs` first (stale lib declarations cause false errors).
- **Branch naming is `task/<id>`**; the test-script commit must stack on the branch HEAD (`baseSha`) — never rebase onto the default branch or it wipes the implementation commit.
- **Jira issue search must use `/rest/api/3/search/jql`** (classic `/search` is 410); Jira domains must be normalized to include `https://`.
- **`website/` is outside the pnpm workspace** — build/test with npm inside `website/`; metadata routes need `dynamic='force-static'` under static export.
- **No live external services in the sandbox** — smoke-test real flows on the Vercel deploy.
- **A DB trigger's error reaches you on `err.cause`, not `err`** — the same Drizzle wrapping as `23505`. An assertion matching only `String(err)` reports a **false pass** when an immutability trigger fires; this happened while testing `0038` and was only caught by checking in `psql` directly.
- **Postgres `jsonb` reorders object keys.** A value round-tripped through the database comes back deep-equal but not string-equal, so anything hashed or compared must be canonicalised first (`sequenceRecordHash.canonicalJson`) — hashing the stored form would never match hashing what was written.
- **`drizzle-kit push` creates tables but not triggers** (see §6). It also does not fail or warn, so the gap is invisible.
- **`drizzle-kit push` DROPS an index it cannot see in the Drizzle schema.** A partial unique index or a GIN index written only in a `docs/db/*.sql` migration is deleted by the next `db:migrate`, silently — 0041's `knowledge_sources_hash_uq` and `knowledge_chunks_tsv_idx` were both proposed for deletion until they were declared in the schema (`uniqueIndex().where(sql…)` and `index().using("gin", t.tsv)`). A stored generated column survives if declared via `customType`. Verify any new index by running push against a throwaway database and reading the statement list — push prints what it is about to drop.
- **Data-layer checks live in `artifacts/api-server/scripts/sequence-verify/`**, not `pnpm test` — they need `DATABASE_URL` and they truncate the tables they use. Its README has the throwaway-Postgres recipe; `artifacts/api-server/tsconfig.json` includes `scripts` so they are typechecked.
- **Knowledge upload "The related resource does not exist" means the bucket is wrong.** Supabase Storage answers `POST /object/upload/sign/<bucket>/<path>` with a 404 worded that way when the bucket is not in the project `SUPABASE_URL` points at — check the bucket name against `KNOWLEDGE_BUCKET` (default `project-knowledge`) and that both belong to the same Supabase project. The route now returns `503 STORAGE_BUCKET_MISSING` naming the bucket instead of relaying that string.
- **Never execute, import, `require` or `eval` anything from a customer repository.** The UI style extractor (0042) reads Tailwind and theme configs with `@babel/parser` and CSS with postcss, statically. Running a config would run the customer's code inside the API function; a value that is not statically readable is recorded as a warning and skipped.
- **`stack_profile.frontend` is not a framework detector.** It is `has("angular.json") ? "angular" : has("vue.config") ? "vue" : has("package.json") ? "react" : "none"`, so every repository with a `package.json` reports `react`, and Next/Svelte/Solid/Razor have no value at all. Do not use it to decide whether a feature applies — scan for file markers (what `uiStyle/components.ts` does).
- **`/api/ext/*` is NOT behind `requireAuth`.** The Jira panel's routes are mounted with the public routes, before it, because their caller is Atlassian holding a Forge token. `forgeAuth` is their only gate, and anything added under `/api/ext` inherits that — never assume `req.userId` there; the Kandryn user comes from `linkedUser(...)` or there is none.
- **Model IDs:** Claude `claude-sonnet-4-5`, OpenAI `gpt-4o`, Aegis `claude-fable-5` (ZDR fallback `claude-opus-5`).

---

## Commit attribution

Every git commit message ends with these two lines:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013odDkWjBWJLoyQHgmm7Vqp
```

Every pull request description ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_013odDkWjBWJLoyQHgmm7Vqp
```

The session URL above is the one that set this convention; replace it if a
later session supersedes it. Attribution belongs in commit messages and PR
descriptions only — never in code comments, migrations, or anything else the
repository ships.

---

## Developer behaviour guidelines (Karpathy principles)

These rules govern how Claude Code should behave when working on
Kandryn. They apply to every task regardless of size.
Derived from Andrej Karpathy's observations on LLM coding pitfalls.

---

### 1. Think before coding

Before writing any code, state:
- What you understand the task to be
- Any assumptions you are making
- Any ambiguity you have found

If the request could be interpreted in more than one way, present
the interpretations and ask which one to proceed with.
Do not silently pick one and run with it.

If a simpler approach exists than what was asked for, say so before
implementing the asked-for approach.

Stop and ask rather than guess. A wrong assumption discovered after
300 lines of code costs far more than a one-line clarification question.

Specific to Kandryn:
- If a prompt says "update the runs table", state which columns you
  plan to add/change and wait for confirmation before writing SQL
- If a prompt references a component that has two possible locations
  (e.g. run-detail.tsx vs RunDetail.tsx), name both and ask
- If a DB migration might destroy data, say so explicitly before
  writing the migration

---

### 2. Simplicity first

Write the minimum code that solves the stated problem. Nothing else.

- No abstractions for code that is only used once
- No configurability that was not requested
- No error handling for scenarios not mentioned in the task
- No "while I'm here" refactors
- No helper utilities that the task does not require
- If 50 lines solves it, do not write 200

The test: would a senior engineer reading this PR say "why is
all this extra code here"? If yes, remove it.

Specific to Kandryn:
- Do not add Zod schemas for endpoints that do not validate input today
  unless the task says to add validation
- Do not extract a shared utility function unless it is called in
  3+ places
- Do not add loading/error/empty states to a component unless the
  task explicitly covers UI states
- never add console.log — use req.log on the server

---

### 3. Surgical changes

Touch only what the task requires. Leave everything else exactly
as it is.

When editing existing code:
- Do not rename variables or functions that are not part of the task
- Do not reformat or re-indent adjacent code
- Do not change comments you were not asked to change
- Do not fix other bugs you notice — mention them in your report,
  do not fix them silently
- Match the existing code style even if you would do it differently

When your changes create orphans:
- Remove imports YOUR changes made unused
- Remove variables YOUR changes made unused
- Do not remove pre-existing dead code unless the task says to

Every changed line must trace directly to the task. If you cannot
explain why a line changed, revert it.

Specific to Kandryn:
- Never touch integration_configs, waitlist, or auth middleware
  unless the task explicitly covers those
- Never change vercel.json
- Never change pnpm-workspace.yaml
- If a task says "update the board page", do not touch the
  dashboard, runs list, or settings page as a side effect
- Schema changes must match: Drizzle schema file + SQL migration file.
  Never update one without the other.

---

### 4. Goal-driven execution

Before starting a multi-step task, write a brief plan:

  1. [What you will do] → verify: [how you will check it worked]
  2. [What you will do] → verify: [how you will check it worked]
  3. [What you will do] → verify: [how you will check it worked]

Then execute step by step, verifying each step before proceeding.

For every task that touches the API server, the final verify step
must include:
  pnpm --filter @workspace/api-server run typecheck

For every task that touches the frontend, the final verify step
must include:
  pnpm --filter @workspace/dev-copilot run typecheck

For tasks that touch both:
  pnpm run typecheck

Do not report "done" until typecheck passes. A task is not complete
if it breaks the type system.

For every DB change:
  Verify that both the Drizzle schema and the SQL migration file
  have been updated. Verify that the SQL is idempotent
  (uses IF NOT EXISTS / ON CONFLICT DO NOTHING).

Specific to Kandryn success criteria that must always be met:
- Unique constraint violations: err.cause.code === '23505' → 409
  (never leak raw SQL error messages to the client)
- Every new DB query must filter by userId
  (no query returns data across users)
- Credentials (integration_configs) are never logged
  (not in req.log, not in error messages, not in responses)
- Import from 'zod/v4' not 'zod'
- All new PKs are serial integers, never uuid

---

### How to know it is working

These guidelines are working if you see:
- Clarifying questions before implementation, not after mistakes
- Diffs that contain only what the task required
- Typecheck passing on the first attempt more often
- No surprise refactors or renames in PRs
- Plan listed before execution on multi-step tasks

---

## END OF KARPATHY GUIDELINES SECTION
