# Blue Mantis — Project Knowledge for AI Assistants

> Single source of truth for continuing development. Covers **what the product does**,
> the **UI/UX**, the **functional flows**, and the **technical architecture**. Kept current
> with the shipped app (Phases 1–5 live on getbluemantis.com).

---

## 1. What this project is

Blue Mantis is an **AI-powered developer delivery assistant**. It connects to Azure DevOps, Jira, and GitHub, syncs a project's work-item hierarchy (epic → story → task), and uses multiple AI agents (Claude + OpenAI) to generate, rank, and commit code. From a work item a user can:

- **Run** the agent pipeline — now (inline) or on a **schedule** (background, via cron).
- Review ranked suggestions and **commit** the chosen one → branch + PR.
- **Create** work items from Blue Mantis (optionally pushed into the PLM) and **break down** an epic/story into children with AI.
- **Generate tests** for a committed change, commit the test script to the same PR, and **push test cases** back into the PLM.

Three deployables share one backend + database:
- **Marketing website** (`website/`) — public Next.js site at `/` (getbluemantis.com)
- **App** (`artifacts/dev-copilot`) — authenticated React SPA at `/app`
- **API** (`artifacts/api-server`) — Express 5 REST server at `/api`

> `artifacts/blue-mantis` (older Vite marketing site) and `artifacts/mockup-sandbox` still exist but are **not deployed** — the Next.js `website/` superseded the Vite site.

---

## 2. Deployment & routing (Vercel)

Single **Vercel** project (Vercel **Pro**), domain **getbluemantis.com**. **No shared reverse proxy** — path routing is in root **`vercel.json`**:

| Path | Serves | Build |
|---|---|---|
| `/api/*` | `artifacts/api-server/api/index.js` | `@vercel/node` serverless fn (`maxDuration: 300`) |
| `/app/*` | `artifacts/dev-copilot` | Vite static (`dist/public`) |
| `/*` | `website/` | Next.js static export (`out`) |

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
  blue-mantis/      Legacy Vite marketing site — not deployed
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
| Auth | Clerk (standalone **development** instance, `pk_test`) |
| Email | Resend |
| Models | Claude `claude-sonnet-4-5`, OpenAI `gpt-4o` |

---

## 5. Authentication

Standalone **Clerk development instance** (`pk_test_…`), not Replit-managed.
- **Backend:** `@clerk/express` — `clerkMiddleware` in `app.ts`; `requireAuth` gates all authenticated `/api` routes and sets `req.userId`.
- **Frontend:** `@clerk/react` — `ClerkProvider` wraps the app; unauthenticated → `/app/sign-in`.
- **Sign-in is intentionally simplified** (`App.tsx` + `HideClerkDevBadge`): Clerk "Development mode" badge hidden, GitHub/Google social logins hidden, "Sign up" replaced by **"Request Your Access"** → marketing Request-Access modal (`/?request-access=1`). Clerk sign-up still exists at `/app/sign-up`.
- **GitHub OAuth auto-sync:** `POST /api/auth/github-sync` upserts the Clerk-held token as `GITHUB_TOKEN` (via `useGitHubSync`). Since GitHub login is hidden, in practice users paste a `GITHUB_TOKEN` PAT in **Settings**.
- Env: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`.

---

## 6. Database schema

PostgreSQL on **Supabase**. Schema in `lib/db/src/schema/`. **All PKs are `serial` integers** (a uuid FK can't reference a serial PK). **Every query scoped to `userId`** — no global data.

`pnpm run db:migrate` = **`drizzle-kit push`**. For **additive** prod changes, also add an idempotent `docs/db/NNNN_*.sql` and apply it in the Supabase SQL editor before deploying (else the new column 500s the write path). Applied so far: `0001_projects_runs_hierarchy.sql`, `0002_runs_committed_suggestion.sql`. Later additive migrations to apply in Supabase before deploy: `0007_test_cases.sql`, `0008_score_breakdown.sql`, `0009_veria_review.sql`, `0010_graphify_graph.sql`, `0011_run_graph_context.sql`, `0012_test_script.sql`, `0013_run_stack.sql`.

| Table | Key columns |
|---|---|
| `repositories` | `id`, `user_id`, `name`, `provider` (`github`\|`azure-repos`), `url`, `default_branch`, `stack_profile` jsonb, `created_at` |
| `projects` | `id`, `user_id`, `name`, `plm_provider` (`jira`\|`azure-devops`), `plm_project_key`, `plm_project_name`, `repository_id` FK, `default_target`, `last_synced_at`. **Unique (user_id, plm_provider, plm_project_key)** |
| `tasks` (= work items) | base task fields + `project_id` FK (cascade), `parent_id` self-FK (set null), `item_type` (`epic`/`story`/`task`/`bug`/`test_case`), `plm_url`, `plm_status`, `plm_updated_at`. Status: `open`/`in-progress`/`review`/`done`/`blocked`. Indexed on user_id, project_id, parent_id |
| `runs` | `id`, `user_id`, `project_id`, `work_item_id`, `status` (`scheduled`/`queued`/`running`/`succeeded`/`failed`/`canceled`), `trigger` (`manual`\|`scheduled`), `refine_prompt`, `auto_commit`, `scheduled_at`/`started_at`/`finished_at`, `error`, `pr_url`, `commit_hash`, `committed_suggestion_id` (plain int, no FK — avoids a schema import cycle). Indexed on user_id, (status, scheduled_at) |
| `suggestions` | `id`, `run_id` FK, `agent` (`claude`/`openai`/`copilot`/`antigravity`), `code`, `explanation`, `file_path`, `language`, `score`, `recommendation` |
| `integration_configs` | composite PK (`user_id`, `key`), `value` (plaintext — **never log**) |
| `waitlist` | marketing signups |

### Config keys (`configService.ts → CONFIG_KEYS`)
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GEMINI_API_KEY`, `GITHUB_COPILOT_TOKEN`, `GITHUB_TOKEN`, `AZURE_REPOS_ORG`, `AZURE_REPOS_TOKEN`, `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_PAT`, `JIRA_DOMAIN`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. All AI/Git/PLM creds are **per-user** here, not env vars. The Zod schema for `PUT/PATCH /api/config` is auto-built from this array.

---

## 7. Functional flows (the product lifecycle)

The end-to-end user journey, mapped to the code paths:

1. **Connect** — in **Settings**, save per-user credentials (Anthropic, GitHub PAT, Jira or ADO). Connect a **repository** (stack auto-detected).
2. **Create a project** (`/projects/new`) — 3-step wizard binds one **PLM project** + one **repository**. Create validates both bindings live and rejects a duplicate PLM binding with a friendly 409.
3. **Sync** (`POST /projects/:id/sync`) — pulls the epic→story→task hierarchy from Jira/ADO into `tasks`, keyed on `(project_id, external_id)`; resolves parents; cancels pending runs on items that closed upstream.
4. **Author work** — **New item** (local or pushed to the PLM) and **Break down** an epic/story into AI-proposed children you edit/approve.
5. **Run** — from a work item, **Run now** (inline) or **Schedule**. `runService.executeRun` fetches Git context, runs Claude + OpenAI, ranks with the SynthesisEngine, and persists suggestions. Scheduled runs are claimed by the cron dispatcher.
6. **Commit** — commit the chosen suggestion → branch `task/<id>` → PR `[Blue Mantis] <title>`; the item moves to **review**; `committed_suggestion_id` is recorded.
7. **Test** — generate Given/When/Then cases + a runnable script, commit the script onto the **same PR**, and push selected cases back to the PLM (mirrored locally as `test_case`).

---

## 8. API endpoints

Public (mounted **before** `requireAuth`): `POST /api/waitlist`, `POST /api/contact`, and the cron dispatcher. Everything else requires `requireAuth`.

- **Repositories:** `GET/POST /api/repositories`, `GET/PATCH/DELETE /api/repositories/:id`, `GET /api/repositories/:repoId/stack`. **Graphify:** `GET /api/repositories/:repoId/graph` (status: `built`/`builtAt`/`nodeCount`/`stale`), `POST /api/repositories/:repoId/graph` (upload graph.json), `POST /api/repositories/:repoId/graph/rebuild` (re-index via the microservice; `202`, or `503` when unconfigured).
- **Projects:** `GET /api/projects` (with counts), `POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `POST /api/projects/backfill`, `GET /api/plm/:provider/projects`, `POST /api/projects/:id/sync`, `GET /api/projects/:id/work-items`, `POST /api/projects/:id/work-items` (`pushToPlm`).
- **Work items:** `PATCH /api/work-items/:id` (local edit; `done` propagates via `closeTask`), `POST /api/work-items/:id/breakdown` (proposals, not saved), `POST /api/work-items/:id/push-to-plm` (promote a local-only item into Jira/ADO → records externalId/source/plmUrl; `409` if already linked).
- **Runs:** `POST /api/work-items/:id/runs` (inline → `{run,suggestions}`; `scheduledAt` future ≤30d → `202`; ≤20 pending/user), `GET /api/runs?projectId=&status=`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel`, `POST /api/runs/:id/commit`.
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
  middlewares/       requireAuth.ts, clerkProxyMiddleware.ts
  routes/            index.ts (mounts: public before requireAuth, rest after)
                     repositories, projects, runs, workItems, tests,
                     tasks, taskActions, stats, config, waitlist, contact, internal, health
  services/
    configService    per-user credential store
    gitService       GitHub (Octokit) + Azure Repos; branch/commit/PR; commitChanges(baseSha), branchHeadSha
    aiService        AIOrchestrator + SynthesisEngine + generateBreakdown + generateTests (+ AIFormatError)
    plmService       closeTask across ADO + Jira
    plmProjects      list/validate PLM projects; normalizeJiraDomain(); PlmError
    plmWrite         create PLM work items + test cases (Jira/ADO)
    syncService      project-scoped PLM hierarchy sync → tasks
    runService       executeRun() + commitFromSuggestion() (+ RunError)
    emailService     Resend: contact, waitlist, run-completed/failed
  adapters/          gitService, azureDevOpsAdapter, jiraAdapter
  stack/             detector.ts (path-based StackProfile), prompts.ts
```

### Subsystem notes
- **Runs engine** (`runService.executeRun`, never throws — failures land on the run row): load (scoped to `run.userId`) → keyword-extract → Git context → Claude+OpenAI → SynthesisEngine rank → persist suggestions → if `auto_commit`, commit top (branch `task/<id>` → PR), set `committed_suggestion_id`, item → `review` → mark `succeeded`; scheduled runs email the owner. **Dispatcher** (`routes/internal.ts`, cron 5-min, `CRON_SECRET`): sweep `running` >20 min → `failed`, then claim ≤2 due `scheduled` rows with `FOR UPDATE SKIP LOCKED` → `queued` → run each.
- **Sync engine** (`syncService.syncProject`): project-scoped fetch, upsert on `(project_id, external_id)`, two-pass parent resolution, ADO `Feature`→`epic`, cancels pending runs on close. Jira uses the **enhanced** `GET /rest/api/3/search/jql` (classic `/search` is **410 Gone**), paginating by `nextPageToken`/`isLast`; domains normalized via `normalizeJiraDomain` (users enter `acme.atlassian.net` without a scheme).
- **AI shapes:** `AIOrchestrator.generateSuggestions` runs both models in parallel; `SynthesisEngine` scores/ranks, flags top as `Recommended`. `generateBreakdown`/`generateTests` are zod-validated with one retry → else `AIFormatError` → 422. Mock agents (`antigravity`,`copilot`) gated behind `ENABLE_DEMO_AGENTS=true`.
- **Stack-aware prompting:** the run's `repositories.stack_profile` is threaded through the whole pipeline — `services/stackPromptBuilder.ts` (`buildStackAwarePrompt` + `describeStack`) prepends a language/framework/db/test/package-manager conventions block (+ "don't introduce a new stack" guardrail) inside `stack/prompts.ts:buildPrompt`, shared by both agents; SynthesisEngine's convention dimension is stack-explicit via `describeStack`; `gitService.fetchFileContext` already filters context files by stack extension. `runService.executeRun` logs the stack and persists `runs.stack_desc` (`0013`), surfaced in the run-detail **Stack** info cell. All graceful no-ops when `stack_profile` is null.
- **Commit/PR:** branch is deterministic `task/<id>`. `GitService.commitChanges(baseSha?)` defaults to the default-branch HEAD; the **test-script commit** passes the branch's own HEAD (`branchHeadSha`) so it stacks on the existing PR instead of overwriting the implementation commit.
- **Graphify** (`graphifyService.ts`, `graphify-service/` microservice): a per-repo knowledge graph (`repositories.graph_json`/`graph_built_at`/`graph_node_count`) gives runs precise, low-token file context. `runService` picks the graph path when `isGraphUsable(graphBuiltAt)` (fresh <24h) → `git.fetchFileContextWithGraph` returns `{context, usedGraph}`; `usedGraph` persists to `runs.used_graph_context` (surfaced as a "Graph context" badge on run detail). **Phase 2:** the Python microservice (`/index`) clones + runs `graphify extract` and POSTs the graph to `POST /api/internal/graphify-callback` (guarded by `GRAPHIFY_SERVICE_SECRET`); triggered fire-and-forget on repo connect. **Phase 3:** `triggerRepoIndex()` (shared helper) also re-indexes after every commit (auto + manual) and on the **Rebuild graph** button (`POST /repositories/:repoId/graph/rebuild`, `503` when `GRAPHIFY_SERVICE_URL` unset). Re-indexing is a full re-extract via `/index` (a partial sparse-checkout would drop cross-file edges); developers without the microservice can still upload a `graph.json` by hand. Graph work is a **no-op unless `GRAPHIFY_SERVICE_URL` + `GRAPHIFY_SERVICE_SECRET` are set** — the keyword fallback (`fetchFileContext`) always runs otherwise.

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
Small type, **monochrome single-color SVG icons** (muted, brighten to primary on hover/active), quiet bordered actions. Top→bottom: logo + "Blue Mantis" wordmark; **Projects** switcher (dropdown → board / "New project…"); **repository** switcher (dropdown → set active / "Manage"); a quiet bordered **New task** button; **Search tasks** (⌘K → `/tasks`); **Workspace** nav (Dashboard/Tasks/Repositories/History) with a subtle active background; footer with **Azure/Jira** status dots (green when connected), **theme toggle** ("Light/Dark mode"), user avatar+name, and **Settings** + **Sign out** icon buttons. Collapses to an icon rail below 1100px.

### TabBar (`components/layout/TabBar.tsx`)
Renders open views as tab chips (icon + label + close ✕) with a "+" dropdown to open Tasks/Repositories/Dashboard/History/Settings. `open(href)` focuses an existing tab or opens a new one.

### Routes & pages (`src/App.tsx`)
| Route | Page | UX |
|---|---|---|
| `/dashboard` | `dashboard.tsx` | Stats overview (`GET /api/dashboard/stats`) |
| `/projects/new` | `new-project.tsx` | **3-step wizard**: Name → PLM project → Repository. Stepper header (check/active states). Step 2 = provider toggle (Jira/ADO) + live project list (skeletons; not-connected → link to Settings; error; empty). Step 3 = repo list (empty → connect link). Create → board. **On 409 duplicate → "Already connected" toast + "Open project" action.** |
| `/p/:projectId/board` | `project-board.tsx` | **Kanban**: header (name, provider·key, N items, last-synced) + actions (Runs, Sync, New item). Epic **filter pills**. 4 columns: Open(+blocked)/In progress/Review/Done. Cards: type badge, externalId, title, plmStatus, external PLM link, **scheduled clock badge**; hover actions **Break down** (epic/story) and **Run** (non-epic). States: loading skeletons, empty ("Click Sync…"), error. |
| `/p/:projectId/runs` | `runs.tsx` | Runs list — rows (title, #id, trigger, time, status badge, cancel ✕ for scheduled/queued); live-refresh while any run is active; empty state; click → run detail |
| `/runs/:runId` | `run-detail.tsx` | Run workspace — status badge, run info card (trigger, auto-commit, scheduledAt, refinePrompt, error, PR link), **polls while in progress**, suggestion cards (agent, Recommended badge, score, filePath, explanation, code, **Commit**), then **TestStage** once succeeded + committed |
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
- **TestStage** (`components/tests/TestStage.tsx`) — **Generate tests** → editable test **script** (filePath + code, framework badge, Regenerate, **Commit to PR**) + **test cases** (Given/When/Then checkbox rows, **Push to PLM**; blocked with a note + **Push item to PLM** promote button when the work item isn't PLM-linked). Generated cases + script persist on the committed suggestion (`suggestions.test_cases`/`test_script`, migration `0012`), so the run detail **rehydrates** them on reload; per-case PLM push status (`plmKey`/`plmUrl`, stored on each `test_cases` entry) shows as a **Pushed · KEY** badge across reloads. Regenerate replaces both and clears push status.

### Contexts + client
`ConfigContext` (loads `/api/config`; `isAzureConnected`/`isJiraConnected`), `RepoContext` (active repo), `TabsContext` (tabs). API client = `src/services/api.ts` — `request<T>` + **`ApiError { status, body }`** (now carries the parsed error body), relative URLs, covering repositories/tasks/projects/work-items/runs/tests. Toasts via `hooks/use-toast` (+ `ToastAction`).

---

## 11. UI/UX — the marketing website (`/`, Next.js)

`website/` — Next.js 15 **static export** (`output:'export'` → `out/`, `trailingSlash:true`), app router. Serif-forward design; fonts **Newsreader / Space Grotesk / IBM Plex Mono**. Layout wraps: `AnnouncementBar`, `Nav`, `Footer`, `ModalProvider` (Request-Access modal opened via `/?request-access=1`), plus JSON-LD (`organizationLd` + `softwareApplicationLd`). Pages: home (`app/page.tsx`), `how-it-works`, `faq`, `security`, `contact`, `privacy`, `terms`; metadata routes `sitemap.ts` / `robots.ts` / `opengraph-image.tsx` (both metadata routes need `export const dynamic = 'force-static'` under static export). Central copy is **final** in `lib/site.ts` (`SITE`, nav, FAQ, steps, benefits, security rows). Contact/Request-Access + Book-a-Walkthrough → `POST /api/contact` → `emailService` (Resend) → `arvind.kandula@venakaninfo.com` + `accounts@venakaninfo.com`. Waitlist → `POST /api/waitlist`. **Marketing copy must avoid fabricated metrics/traction** — product-fact/directional framing only. Build: `cd website && npm install && npm run build`.

---

## 12. Environment variables

| Variable | Critical | Notes |
|---|---|---|
| `PORT` | ✅ (local) | Local API port; Vercel manages the function |
| `DATABASE_URL` | ✅ | Supabase Postgres |
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk |
| `CRON_SECRET` | ⚠️ | Bearer for the dispatcher — **scheduled runs need it**; inline runs don't |
| `RESEND_API_KEY` / `WAITLIST_FROM_EMAIL` | ⚠️ | Email; without the key, email is a no-op |
| `APP_BASE_URL` | ❌ | Email link origin (default `https://getbluemantis.com`) |
| `ENABLE_DEMO_AGENTS` | ❌ | `true` adds mock agents (default off) |
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
- **Known adapter caveats:** Jira create maps `task → Task` (not `Sub-task`) with a best-effort `parent` link; ADO `commitChanges` uses `changeType:"edit"` (new-file adds may fail on Azure Repos — **GitHub is the primary, auto-synced provider**); test-case push requires a PLM-linked work item.

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
- **Model IDs:** Claude `claude-sonnet-4-5`, OpenAI `gpt-4o`.
