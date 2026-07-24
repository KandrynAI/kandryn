# Blue Mantis — Project Knowledge for AI Assistants

## What this project is

Blue Mantis is an **AI-powered developer delivery assistant**. It connects to Azure DevOps, Jira, and GitHub, syncs a project's work-item hierarchy (epic → story → task), and uses multiple AI agents (Claude + OpenAI) to generate, rank, and commit code. From a work item you can:

- **Run** the agent pipeline — now (inline) or on a **schedule** (background, via cron).
- Review ranked suggestions and **commit** the chosen one → branch + PR.
- **Create** work items from Blue Mantis (optionally pushed into the PLM) and **break down** an epic/story into children with AI.
- **Generate tests** for a committed change, commit the test script to the same PR, and **push test cases** back into the PLM.

Three deployables share one backend + database:
- **Marketing website** (`website/`) — public Next.js site at path `/` (getbluemantis.com)
- **App** (`artifacts/dev-copilot`) — authenticated React SPA at path `/app`
- **API** (`artifacts/api-server`) — Express 5 REST server at path `/api`

> `artifacts/blue-mantis` (the older Vite marketing site) and `artifacts/mockup-sandbox` still exist in the repo but are **not deployed** — the Next.js `website/` superseded the Vite marketing site. Don't spend effort on `blue-mantis` unless explicitly asked.

---

## Deployment & routing (Vercel)

Single **Vercel** project (Vercel **Pro**), domain **getbluemantis.com**. There is **no shared reverse proxy** — path routing lives in the root **`vercel.json`**:

| Path | Serves | Build |
|---|---|---|
| `/api/*` | `artifacts/api-server/api/index.js` | `@vercel/node` serverless fn (`maxDuration: 300`) |
| `/app/*` | `artifacts/dev-copilot` | Vite static (`dist/public`) |
| `/*` | `website/` | Next.js static export (`out`) |

- **Cron:** `vercel.json` → `crons: [{ path: "/api/internal/dispatch-runs", schedule: "*/5 * * * *" }]`.
- In app code always use **relative URLs** (`/api/...`) or `import.meta.env.BASE_URL` — Vercel routes by path.
- **Runtime testing happens on the Vercel deploy.** The sandbox has no live Supabase/Clerk/PLM/Git/Resend/cron, so verify locally with typecheck + build + the esbuild bundle, and smoke-test real flows after deploy.

---

## Monorepo layout

```
website/            Next.js 15 marketing site (path: /) — NOT in the pnpm workspace; own package-lock
artifacts/
  api-server/       Express 5 REST API (path: /api); esbuild → dist/serverless.mjs for Vercel
  dev-copilot/      React + Vite app (path: /app)
  blue-mantis/      Legacy Vite marketing site — not deployed
  mockup-sandbox/   Local component preview server — not deployed
lib/
  api-spec/         OpenAPI spec + Orval codegen config (used by legacy routes only)
  api-client-react/ Generated React Query hooks (legacy)
  api-zod/          Generated Zod schemas (legacy)
  db/               Drizzle ORM schema + PostgreSQL (Supabase) client
shared/
  types/            task.ts, codeSuggestion.ts, stack.ts
docs/
  ARCHITECTURE.md   End-to-end app structure (kept current)
  db/*.sql          Idempotent DDL to apply in Supabase (see "Database")
scripts/            @workspace/scripts
```

`website/` is a **standalone npm project** outside the pnpm workspace (Next.js 15, its own `package-lock.json`).

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 |
| Package manager | pnpm workspaces (except `website/` = npm) |
| Language | TypeScript 5.9 (strict) |
| API framework | Express 5 |
| Database | PostgreSQL (Supabase) + Drizzle ORM |
| Validation | Zod (`zod/v4`) — inline in newer routes; `drizzle-zod` for insert schemas |
| Frontend (app) | React + Vite + wouter + TanStack Query + TailwindCSS + shadcn/ui |
| Marketing | Next.js 15 (static export) |
| Auth | Clerk (standalone **development** instance, `pk_test`) |
| Email | Resend (contact + run notifications) |
| API build | esbuild bundle (`dist/serverless.mjs`), run as a Vercel Node function |

---

## Authentication

Standalone **Clerk development instance** (`pk_test_…`). Not Replit-managed.

- **Backend:** `@clerk/express` — `clerkMiddleware` in `app.ts`; `requireAuth` gates **all** authenticated `/api` routes and sets `req.userId`.
- **Frontend:** `@clerk/react` — `ClerkProvider` wraps the app; unauthenticated users go to `/app/sign-in`.
- **Sign-in page is intentionally simplified** (`dev-copilot/src/App.tsx` + `HideClerkDevBadge`): the Clerk "Development mode" badge is hidden, GitHub/Google social logins are hidden, and "Sign up" is replaced by **"Request Your Access"** which routes to the marketing site's Request-Access modal (`/?request-access=1`). The Clerk sign-up page still exists at `/app/sign-up`.
- **GitHub OAuth auto-sync:** `POST /api/auth/github-sync` reads the Clerk-held GitHub OAuth token and upserts it as `GITHUB_TOKEN`. Called by the `useGitHubSync` hook. Because the GitHub social login is hidden, in practice users paste a `GITHUB_TOKEN` PAT in **Settings** instead.

### Auth env vars
```
CLERK_SECRET_KEY
CLERK_PUBLISHABLE_KEY
VITE_CLERK_PUBLISHABLE_KEY
```

---

## Database schema

PostgreSQL on **Supabase**. Schema in `lib/db/src/schema/`. **All PKs are `serial` integers** (a uuid FK can't reference a serial PK — keep new tables integer-keyed). **Every query must be scoped to `userId`** — there is no global/shared data.

`pnpm run db:migrate` runs **`drizzle-kit push`**. For **additive** changes on the live Supabase DB, apply the idempotent SQL in **`docs/db/*.sql`** by hand (Supabase SQL editor) before deploying — e.g. `0001_projects_runs_hierarchy.sql`, `0002_runs_committed_suggestion.sql`.

### Tables

- **`repositories`** — `id`, `user_id`, `name`, `provider` (`github` | `azure-repos`), `url`, `default_branch` (default `main`), `stack_profile` jsonb (`StackProfile`), `created_at`.
- **`projects`** — `id`, `user_id`, `name`, `plm_provider` (`jira` | `azure-devops`), `plm_project_key`, `plm_project_name`, `repository_id` FK, `default_target` (`story` | `task`), `last_synced_at`, `created_at`. Unique on (user_id, plm_provider, plm_project_key).
- **`tasks`** (= work items) — base: `id`, `user_id`, `external_id`, `source` (`jira` | `azure-devops` | `manual`), `type`, `title`, `description`, `acceptance_criteria`, `priority`, `status` (`open`/`in-progress`/`review`/`done`/`blocked`), `linked_commit`, `repository_id` FK, `created_at`/`updated_at`. **Hierarchy/PLM columns:** `project_id` FK→projects (cascade), `parent_id` self-FK→tasks (set null), `item_type` (`epic`/`story`/`task`/`bug`/`test_case`, default `task`), `plm_url`, `plm_status`, `plm_updated_at`. Indexed on user_id, project_id, parent_id.
- **`runs`** — a durable execution of the agent pipeline. `id`, `user_id`, `project_id` FK, `work_item_id` FK→tasks, `status` (`scheduled`/`queued`/`running`/`succeeded`/`failed`/`canceled`), `trigger` (`manual` | `scheduled`), `refine_prompt`, `auto_commit` bool (default false), `scheduled_at`/`started_at`/`finished_at`, `error`, `pr_url`, `commit_hash`, `committed_suggestion_id` (plain int pointer, no FK — avoids a runs↔suggestions import cycle), `created_at`. Indexed on user_id and (status, scheduled_at).
- **`suggestions`** — a persisted agent suggestion for a run. `id`, `run_id` FK, `agent` (`claude`/`openai`/`copilot`/`antigravity`), `code`, `explanation`, `file_path`, `language`, `score` int, `recommendation`, `created_at`.
- **`integration_configs`** — composite PK (`user_id`, `key`), `value` (plaintext — **never log**), `updated_at`.
- **`waitlist`** — marketing waitlist signups.

---

## Config keys (integration_configs)

`artifacts/api-server/src/services/configService.ts` → `CONFIG_KEYS`:
```
ANTHROPIC_API_KEY   OPENAI_API_KEY   GOOGLE_GEMINI_API_KEY   GITHUB_COPILOT_TOKEN
GITHUB_TOKEN        AZURE_REPOS_ORG  AZURE_REPOS_TOKEN
AZURE_DEVOPS_ORG    AZURE_DEVOPS_PROJECT   AZURE_DEVOPS_PAT
JIRA_DOMAIN         JIRA_EMAIL       JIRA_API_TOKEN
```
The Zod schema for `PUT/PATCH /api/config` is auto-built from `CONFIG_KEYS`. AI + Git + PLM credentials are **per-user** in this table, not env vars.

---

## API endpoints

Public (mounted **before** `requireAuth`): `POST /api/waitlist`, `POST /api/contact`, and the cron dispatcher (below). Everything else requires `requireAuth` (sets `req.userId`).

### Repositories
`GET/POST /api/repositories`, `GET/PATCH/DELETE /api/repositories/:id`, `GET /api/repositories/:repoId/stack` (re-detect + save).

### Projects (Phase 1–2)
- `GET /api/projects` — list with per-project counts (open/running/review)
- `POST /api/projects` — create; validates the repo + PLM binding live
- `GET/PATCH/DELETE /api/projects/:id`
- `POST /api/projects/backfill` — adopt legacy project-less tasks into "Migrated" projects
- `GET /api/plm/:provider/projects` — list PLM projects for the wizard
- `POST /api/projects/:id/sync` — pull the PLM hierarchy (see Sync engine)
- `GET /api/projects/:id/work-items` — flat, project-scoped raw rows
- `POST /api/projects/:id/work-items` — create a work item; `pushToPlm: true` creates it in Jira/ADO first

### Work items (Phase 4)
- `PATCH /api/work-items/:id` — local edit; a move to `done` propagates to the PLM via `closeTask` (other transitions stay local in v1)
- `POST /api/work-items/:id/breakdown` — AI decomposition → child proposals (not saved)

### Runs (Phase 3)
- `POST /api/work-items/:id/runs` — no `scheduledAt` → runs **inline**, returns `{ run, suggestions }`; with `scheduledAt` (future, ≤ 30 days) → `202` scheduled. ≤ 20 pending runs/user.
- `GET /api/runs?projectId=&status=`, `GET /api/runs/:id` (+ suggestions)
- `POST /api/runs/:id/cancel` (scheduled/queued only), `POST /api/runs/:id/commit` (commit a persisted suggestion)

### Tests (Phase 5)
- `POST /api/work-items/:id/tests/generate` — Given/When/Then cases + a runnable test script (not saved)
- `POST /api/work-items/:id/tests/commit-script` — commit the script onto the **same branch/PR** as the implementation
- `POST /api/work-items/:id/tests/push` — push selected cases to the PLM + mirror locally as `test_case`

### Legacy task actions (single-task flow, still mounted)
- `POST /api/tasks/:taskId/suggestions` (rate-limited 20/min), `.../commit`, `.../complete`; `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id`.

### Internal (cron-only)
- `GET|POST /api/internal/dispatch-runs` — **`CRON_SECRET` bearer-guarded**, mounted before `requireAuth`. Vercel Cron calls it via GET.

### Config / stats / health
`GET /api/config`, `PUT|PATCH /api/config`, `DELETE /api/config/:key`, `POST /api/config/test/:integration`, `POST /api/auth/github-sync`, `GET /api/dashboard/stats`, `GET /api/healthz`.

---

## Server architecture

```
artifacts/api-server/src/
  app.ts                Express setup (clerk middleware, routes, error handler, rate limit)
  index.ts              Local entry (env validation + listen); Vercel uses api/index.js → dist/serverless.mjs
  lib/env.ts            Startup env validation (fatal vs graceful-degraded)
  lib/logger.ts         pino singleton
  middlewares/          requireAuth.ts, clerkProxyMiddleware.ts
  routes/
    index.ts            Mounts routers (public before requireAuth, rest after)
    repositories.ts  projects.ts  runs.ts  workItems.ts  tests.ts
    tasks.ts  taskActions.ts  stats.ts  config.ts
    waitlist.ts  contact.ts  internal.ts (cron)  health.ts
  services/
    configService.ts    per-user credential store (CONFIG_KEYS)
    gitService.ts       GitHub (Octokit) + Azure Repos; branch/commit/PR; commitChanges supports baseSha
    aiService.ts        AIOrchestrator + SynthesisEngine + generateBreakdown + generateTests
    plmService.ts       closeTask across Azure DevOps + Jira
    plmProjects.ts      list/validate PLM projects; normalizeJiraDomain()
    plmWrite.ts         create PLM work items + test cases (Jira/ADO)
    syncService.ts      project-scoped PLM hierarchy sync → tasks
    runService.ts       executeRun() + commitFromSuggestion()
    emailService.ts     Resend: contact, waitlist, run-completed/failed
  adapters/
    gitService.ts, azureDevOpsAdapter.ts, jiraAdapter.ts
  stack/
    detector.ts (path-based StackProfile), prompts.ts
```

- **Logging:** never `console.log`. Use `req.log.*` in handlers, `logger.*` from `lib/logger` elsewhere.
- **Errors:** Express 5 auto-propagates async throws → global handler returns `{ error }`. Use try/catch only to return a non-500 (e.g. map `PlmError`/`RunError` to 424/502/4xx).
- **Rate limiting:** only `POST /api/tasks/:taskId/suggestions` (20/min), in `app.ts`.

---

## Runs engine (Phase 3)

`runService.executeRun(runId)` is the shared path for **inline and scheduled** runs (never throws — failures land on the run row):
1. Load run/work-item/project/repo (all scoped to `run.userId` — the dispatcher has no request user).
2. Keyword-extract, fetch Git file context, run `AIOrchestrator` (Claude + OpenAI) with stack prompts, rank with `SynthesisEngine`.
3. Persist `suggestions`; if `auto_commit`, commit the top one (branch `task/<workItemId>` → PR), set `committed_suggestion_id`, move the item to `review`.
4. Mark `succeeded`; for scheduled runs, email the owner (`sendRunCompleted`/`sendRunFailed`).

**Dispatcher** (`routes/internal.ts`, cron every 5 min, `CRON_SECRET`-guarded): sweeps `running` rows older than 20 min → `failed`, then claims up to 2 due `scheduled` rows with `FOR UPDATE SKIP LOCKED`, flips them to `queued`, and runs each. Scheduled runs won't dispatch unless `CRON_SECRET` is set in Vercel.

**Mock agents** (`antigravity`, `copilot`) are gated behind `ENABLE_DEMO_AGENTS=true` — otherwise only real Claude + OpenAI run (persisted runs must not let users commit canned code).

---

## Sync engine (Phase 2)

`syncService.syncProject(userId, projectId)` fetches the project's PLM tree (project-scoped), upserts into `tasks` keyed on `(project_id, external_id)`, resolves `parent_id` in a second pass, maps status/type/priority, flattens ADO `Feature` into `epic`, and cancels pending runs when an item closes. Jira issue search uses the **enhanced** endpoint `GET /rest/api/3/search/jql` (the classic `/rest/api/3/search` returns **410 Gone**), paginating by `nextPageToken`/`isLast`. Jira domains are normalized to an absolute origin via `normalizeJiraDomain` (users enter `acme.atlassian.net` without a scheme).

---

## Commit + PR pipeline

Branch name is deterministic: **`task/<id>`**. Commit → open PR titled `[Blue Mantis] <title>` → set `linked_commit`, move item to `review`. `GitService.commitChanges` accepts an optional `baseSha`: default commits build on the default-branch HEAD, but the **test-script commit** passes the branch's own HEAD (`branchHeadSha`) so it stacks on the existing PR instead of overwriting the implementation commit.

---

## AI pipeline & shapes

`AIOrchestrator.generateSuggestions` runs Claude (`claude-sonnet-4-5`) + OpenAI (`gpt-4o`) in parallel; `SynthesisEngine` scores/ranks and flags the top as `Recommended`. `generateBreakdown` and `generateTests` are zod-validated with one retry, then throw `AIFormatError` → `422`.

```typescript
CodeSuggestion { agent:'claude'|'openai'|'copilot'|'antigravity'; code; explanation; filePath; language; score?; recommendation? }
```

---

## Stack detection

`detectStack(filePaths): StackProfile` infers `frontend/backend/database/language/testFramework/packageManager` from **file paths only**. Note: language is keyed off `tsconfig.json` presence (not `.ts` extensions) — a repo whose fetched paths lack `tsconfig.json` reports `javascript`.

---

## Frontend — dev-copilot (`/app`)

React + Vite + **wouter** routing + **TanStack Query**. A **tabbed** shell: `AppShell` + `TabBar` + `Sidebar`, driven by `TabsContext` (`open(href)`).

### Routes (`src/App.tsx`, base `/app`)
| Route | Page | Purpose |
|---|---|---|
| `/dashboard` | `dashboard.tsx` | Stats |
| `/tasks`, `/tasks/new`, `/tasks/:id` | `tasks.tsx` … | Legacy single-task flow |
| `/workspace/:taskId` | `WorkspacePage.tsx` | Legacy 3-column workspace |
| `/projects/new` | `new-project.tsx` | 3-step create wizard |
| `/p/:projectId/board` | `project-board.tsx` | Kanban board + Run / Break down / New item |
| `/p/:projectId/runs` | `runs.tsx` | Runs list (live status, cancel) |
| `/runs/:runId` | `run-detail.tsx` | Run workspace: suggestions, commit, **TestStage** |
| `/repositories`, `/repositories/:id` | repos + stack panel |
| `/history`, `/settings` | history, per-user credentials |
| `/sign-in`, `/sign-up` | Clerk pages (simplified) |

### Key components
`RunPanel` (run now / schedule + auto-commit), `NewItemDialog` (create ± pushToPlm), `BreakdownDialog` (AI proposals), `TestStage` (generate → commit-to-PR → push cases). `Sidebar` is styled Claude-Code-like: small type, **monochrome single-color icons**, quiet bordered actions.

### Design tokens — `src/index.css`
Dark is the default (`.dark`). Accent is **teal**. Key dark tokens: `--bg-app:#0b1110`, `--bg-surface:#0f1614`, `--bg-raised:#141b18`, `--bg-hover:#1b2420`, `--hairline:#1e2a26`, `--hairline-strong:#2c3a35`, `--text-primary:#e6efea`, `--text-secondary:#8fa39a`, `--text-muted:#5c6e66`, `--accent-blue:#19c39a` (teal, misnamed), `--accent-red:#f06565`. Type scale `--fs-2xl…--fs-xs` (22→11px); fonts Inter + JetBrains Mono. Light theme mirrors these. **Do not** re-point the sidebar to the old `src/styles/tokens.css` blue palette — that file is legacy.

### Context + API client
`ConfigContext` (loads `/api/config`; `isAzureConnected`/`isJiraConnected`), `RepoContext` (active repo), `TabsContext` (tabs). API client is plain `fetch` in `src/services/api.ts` (`request<T>` + `ApiError`), relative URLs, covering repositories/tasks/projects/work-items/runs/tests.

---

## Frontend — website (`/`, Next.js)

`website/` — Next.js 15 **static export** (`output: 'export'` → `out/`), app router. Pages: home (`app/page.tsx`), `how-it-works`, `faq`, `security`, `privacy`, `terms`, `contact`, plus `robots.ts`, `sitemap.ts`, `opengraph-image.tsx`. Contact/Request-Access + Book-a-Walkthrough forms POST `/api/contact` → `emailService` (Resend) → `arvind.kandula@venakaninfo.com` + `accounts@venakaninfo.com`. Waitlist → `/api/waitlist`. **Marketing copy must avoid fabricated metrics/traction** — use product-fact/directional framing (agent count, one-click flow, integrations), not invented numbers.

Build: `cd website && npm install && npm run build` (separate from the pnpm workspace).

---

## Environment variables

| Variable | Critical | Notes |
|---|---|---|
| `PORT` | ✅ (local) | Local API port; Vercel manages the function |
| `DATABASE_URL` | ✅ | Supabase Postgres URL |
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk |
| `CRON_SECRET` | ⚠️ | Bearer for the dispatcher — **scheduled runs need it**; inline runs don't |
| `RESEND_API_KEY` / `WAITLIST_FROM_EMAIL` | ⚠️ | Email; without the key, email is a no-op |
| `APP_BASE_URL` | ❌ | Email link origin (default `https://getbluemantis.com`) |
| `ENABLE_DEMO_AGENTS` | ❌ | `true` adds mock agents (default off) |
| `SESSION_SECRET` | ❌ | Session signing |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GITHUB_TOKEN` / `AZURE_REPOS_TOKEN` / `ADO_*` / `JIRA_*` | ❌ | Fallbacks only — real values are **per-user** in `integration_configs` |

---

## Key commands

```bash
pnpm run typecheck            # libs + all artifacts
pnpm run typecheck:libs       # composite libs only (run after editing lib/*)
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/dev-copilot run typecheck
PORT=3000 BASE_PATH=/api node artifacts/api-server/build.mjs   # esbuild bundle (verifies API build)
PORT=3000 BASE_PATH=/app pnpm --filter @workspace/dev-copilot run build   # Vite build (needs PORT + BASE_PATH)
pnpm run db:migrate           # drizzle-kit push (additive prod changes: apply docs/db/*.sql in Supabase)
cd website && npm run build   # Next.js static export
```

---

## Common pitfalls

- **Never `console.log` on the server** — use `req.log` / `logger`.
- **Always import from `zod/v4`**, not `zod`. Newer routes validate with **inline zod**; codegen (`lib/api-zod`, `lib/api-client-react`) is legacy — don't add new endpoints to the OpenAPI spec unless extending the old task flow.
- **Every DB query filters by `userId`** — no global data; forgetting it leaks across tenants.
- **PKs are serial integers** — keep new tables/FKs integer-keyed (uuid FK can't reference serial PK).
- **Additive prod schema changes:** update the Drizzle schema **and** add an idempotent `docs/db/NNNN_*.sql`; apply it in Supabase before deploying, or the new column 500s the write path.
- **Relative `/api` URLs only** in frontend code — Vercel routes by path; there is no shared proxy and no Vite proxy config.
- **Build needs env:** Vite build wants `PORT` + `BASE_PATH`; prefer `typecheck` + the esbuild bundle for quick verification.
- **After editing `lib/*`**, run `pnpm run typecheck:libs` before checking artifacts (stale lib declarations cause false errors).
- **Branch naming is `task/<id>`** and the test-script commit must stack on the branch HEAD (`baseSha`) — never rebase it onto the default branch or it wipes the implementation commit.
- **Jira issue search must use `/rest/api/3/search/jql`** (classic `/search` is 410) and domains must be normalized to include `https://`.
- **`website/` is separate from the pnpm workspace** — build/test it with npm inside `website/`.
- **No live external services in the sandbox** — Clerk/Supabase/PLM/Git/Resend/cron only work on the Vercel deploy; smoke-test real flows there.
- **Model IDs** in code: Claude `claude-sonnet-4-5`, OpenAI `gpt-4o`.
