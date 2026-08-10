# Blue Mantis — End-to-End Architecture & Handoff

> Living reference for the Blue Mantis platform, current as of the latest `main`.
> Written to be handed to an AI assistant (or engineer) for further development.
> Covers product, system map, tech, and both the **unauthenticated** (marketing +
> auth pages) and **authenticated** (product app) areas, plus the API, database,
> flows, deploy, and known gaps.

---

## 1. What Blue Mantis is

Blue Mantis is an **autonomous AI engineering platform** by **Venakan Info Solutions**. It connects to a team's PLM tools (Jira, Azure DevOps; Linear on the roadmap) and code repositories (GitHub, Azure Repos; GitLab/Bitbucket on the roadmap). An orchestrator reads intent from tickets, dispatches specialist AI agents (build / review / security / QA) that work concurrently, and returns a finished pull request for human engineers to review and promote.

Positioning: **the team's process does not change at the edges** — tickets go in the same way, reviews happen the same way; only the routine engineering work in the middle is automated.

There are two audiences and two product surfaces:
- **Buyers / prospects** (CTO, VP Eng, founder) → the **marketing website** (unauthenticated).
- **Users** (developers on an onboarded team) → the **app** (authenticated).

---

## 2. System map & deployment routing

One Vercel project serves everything on **`getbluemantis.com`**, routed by path prefix in the root **`vercel.json`**:

| Path | Surface | Package | Auth |
|---|---|---|---|
| `/` (and `/how-it-works`, `/security`, `/faq`, `/contact`, `/privacy`, `/terms`) | **Marketing website** | `website/` (Next.js 15, static export) | Public |
| `/app/*` | **Product app** | `artifacts/dev-copilot` (React + Vite SPA) | Clerk-authenticated |
| `/api/*` | **REST API** | `artifacts/api-server` (Express 5, `@vercel/node` function) | Clerk (most routes); 2 public routes |

```
                         getbluemantis.com  (Vercel, one project)
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │ /                        │ /app/*                    │ /api/*
        ▼                          ▼                           ▼
  website/ (Next.js)        dev-copilot (Vite SPA)       api-server (Express)
  marketing, forms          the product, Clerk auth      REST, per-user creds
        │                          │                           │
        └──────── forms POST /api/contact ──────► api-server ──► Resend email
                                   │                           │
                          Clerk (auth)                PostgreSQL (Drizzle) + PLM/Git APIs
```

**Auth boundary:** everything under `/app` requires a signed-in Clerk session. The marketing site links into the app at `/app/sign-in`.

**Note on the legacy marketing site:** `artifacts/blue-mantis` (a Vite marketing + waitlist site) still exists in the repo but is **no longer deployed** — `website/` replaced it at `/`. Treat `artifacts/blue-mantis` as retained/legacy unless intentionally revived.

---

## 3. Monorepo layout

```
website/                 NEW public marketing site (Next.js 15). Deployed at /.
artifacts/
  api-server/            Express 5 REST API. Deployed at /api.
  dev-copilot/           React + Vite app (the product). Deployed at /app.
  blue-mantis/           LEGACY Vite marketing + waitlist. Not currently deployed.
  mockup-sandbox/        Isolated component preview server (dev only).
lib/
  db/                    Drizzle ORM schema + PostgreSQL client (@workspace/db).
  api-spec/              OpenAPI spec + Orval codegen config (STALE — see §12).
  api-client-react/      Generated React Query hooks (@workspace/api-client-react).
  api-zod/               Generated Zod schemas (@workspace/api-zod).
shared/types/            Task, CodeSuggestion, StackProfile, PLMAdapter types.
scripts/                 Utility scripts (@workspace/scripts).
docs/ARCHITECTURE.md     This document.
vercel.json              Path-prefix routing for the single Vercel project.
```

- **Package manager:** pnpm workspaces (`artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`). **`website/` is intentionally OUTSIDE the pnpm workspace** — it is a standalone npm project (its own `package.json`/`package-lock.json`) so its Next 15 / React 19 toolchain does not entangle with the workspace catalog.
- Node.js 24, TypeScript 5.9 (strict).

---

## 4. Tech stack by surface

| Concern | Marketing (`website/`) | App (`dev-copilot`) | API (`api-server`) |
|---|---|---|---|
| Framework | Next.js 15 (App Router, `output: 'export'`) | React 19 + Vite | Express 5 |
| Language | TypeScript | TypeScript | TypeScript |
| Styling | Vanilla CSS + custom properties (no Tailwind) | Tailwind v4 + shadcn/ui | n/a |
| Fonts | Newsreader, Space Grotesk, IBM Plex Mono | Inter, JetBrains Mono | n/a |
| Routing | file-based (App Router) | `wouter` (base `/app`) | Express routers |
| Data | static + client `fetch` to `/api` | `@tanstack/react-query` + generated hooks | Drizzle ORM → PostgreSQL |
| Auth | none (public) + links to Clerk | `@clerk/react` | `@clerk/express` |
| Validation | client + server (zod) | zod + react-hook-form | `zod/v4` |
| AI SDKs | n/a | n/a | `@anthropic-ai/sdk`, `openai` |
| Deploy | `@vercel/static-build` (`out/`) | `@vercel/static-build` (`dist/public`, `BASE_PATH=/app/`) | `@vercel/node` (`maxDuration: 300`) |

---

# UNAUTHENTICATED AREA

## 5. Marketing website (`website/`, Next.js)

### 5.1 Purpose & routes
Static, SEO-first marketing site. Fully static export (no server runtime); dynamic behavior is client-side. Every page fully readable with JS disabled.

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Home: full argument (hero + schematic + how-it-works + benefits + FAQ preview + CTA) |
| `/how-it-works` | `app/how-it-works/page.tsx` | Deep dive: orchestration, 5 lifecycle stages, handles/does-not-do |
| `/security` | `app/security/page.tsx` | Scoped permissions, audit trail, no-training, human gate |
| `/faq` | `app/faq/page.tsx` | Full FAQ (3 groups). `FAQPage` JSON-LD lives here only |
| `/contact` | `app/contact/page.tsx` | Request Access form + Book-a-walkthrough modal trigger |
| `/privacy`, `/terms` | `app/{privacy,terms}/page.tsx` | Legal stubs (placeholder, TODO counsel text) |
| — | `app/sitemap.ts`, `app/robots.ts`, `app/opengraph-image.tsx` | SEO plumbing (static) |

Content lives in `lib/site.ts` (nav, integrations, activity-feed lines, steps, benefits, security rows, FAQ groups). `lib/jsonld.tsx` builds Organization + SoftwareApplication (sitewide), FAQPage (`/faq`), and BreadcrumbList (subpages).

### 5.2 Design system (strict three-color)
Defined in `app/globals.css`. **Exactly three colors**, all OKLCH tints/opacities — no fourth hue, no gradients, no glows, no blur, no shadows. Reads like ink on a drafting table.

```
--bg        oklch(0.15 0.008 255)   near-black page background
--bg-raise  oklch(0.19 0.010 255)   raised panels, bands, form inputs
--line      oklch(0.30 0.010 255)   hairlines, borders, blueprint grid
--text      oklch(0.90 0.005 255)   headings + body
--text-dim  oklch(0.68 0.008 255)   secondary text
--blue      oklch(0.58 0.19 255)    CTAs, links, focus, active schematic tokens
--blue-hover oklch(0.64 0.19 255)
```
- **Type:** Newsreader (serif) for h1–h3; Space Grotesk (sans) for body/UI/buttons; IBM Plex Mono only for short uppercase labels, schematic zone labels, activity feed, timestamps. Button text on blue = `--bg`.
- **Layout:** max width 1160px. Every `<section>` is bounded by a hairline top border (clear section definition); spacing intentionally tightened. Blueprint grid (48px cells, ~35% opacity) appears **only** behind the hero and schematic.
- **State colors:** no red/green. Errors use a brighter border + text; success uses copy; the only accent is blue.
- **Logo:** `website/public/logo.png` (shared with the app) in the nav and footer.

### 5.3 Key components (`website/components/`)
- **`Nav.tsx`** — sticky nav (solid `--bg` at 96% on scroll, hairline border, no blur). Links: How it works · Security · FAQ. Right side: **Sign in** (plain `<a href="/app/sign-in">` — full navigation into the app SPA) + **Request access** button (opens the modal). Mobile hamburger menu mirrors this.
- **`AnnouncementBar.tsx`** — home-only (via `usePathname`), dismissible (sessionStorage). "Private beta is open…".
- **`Footer.tsx`** — logo + "A Venakan Info Solutions product", nav links, **Sign in**, LinkedIn (`linkedin.com/company/venakan`).
- **`Schematic.tsx`** — the signature diagram. Desktop: an SVG "drafting-table" of three zones (Tickets, unchanged → Orchestrator + Builder/Reviewer/Security/QA → PR awaiting review). Machine nodes are blue-stroked; the human PR node is grey-stroked. Work-token dots animate along `offset-path` and turn grey crossing into review. Mobile: reflows to a legible vertical stack. Freezes under `prefers-reduced-motion`; one `aria-label` on the `<figure>` describes the whole flow.
- **`ActivityFeed.tsx`** — mock terminal feed (Jira ticket → scoped → built → scanned → tested → reviewed → PR #142). Staggered fade-in; full DOM (readable with JS off / reduced motion).
- **`IntegrationLogos.tsx`** — monochrome inline SVGs (GitHub, GitLab, Bitbucket, Jira, Linear, Slack), `--text-dim`, each with `<title>`/`aria-label`.
- **`Faq.tsx`** — native `<details>/<summary>`.
- **`Reveal.tsx`** — IntersectionObserver scroll reveal. Progressive enhancement: content is visible by default; the layout's inline script adds a `.js` class so reveals only hide when JS is present.
- **Contact form:** `ContactView.tsx` (client component embedded on `/contact/`) — see §5.4.

### 5.4 Lead-capture flows (Request Access + Book a Walkthrough)
This is the primary functional behavior of the marketing site.

- **`ContactView`** — the client component embedded on `/contact/`. Fields: Name, Work email, Tracker and repository, and a free-text "What would you point it at first?". Two submit buttons post the same form with different `type` — **Request access** and **Book a walkthrough** — and it shows an inline "Request received." success state.
- **Where it appears:**
  - Every **"Request access"** button (hero, nav header, final CTA banner, footer) is a full-page link to **`/contact/`** — a plain navigation, no query param and no modal.
  - **`/contact/`** embeds `ContactView` alongside onboarding facts in a two-column layout.
- **Submission:** `POST /api/contact` with `{ type, name, email, company, teamSize?, preferredTime?, message? }`. The api-server emails **arvind.kandula@venakaninfo.com** and **accounts@venakaninfo.com** (reply-to the prospect) via Resend. Requires `RESEND_API_KEY` set on the api-server; without it the endpoint still returns 200 but sends nothing (same as the waitlist).

### 5.5 SEO & performance
One H1 per page; unique Next Metadata per route; canonical + OpenGraph + Twitter tags; static OG image (`opengraph-image.tsx`, three-color, no screenshots); JSON-LD as above; `sitemap.xml` + `robots.txt`; semantic HTML; skip-to-content link; 2px blue focus rings. Client JS ~110KB First Load (well under budget gzipped). `metadataBase` and all URLs use `https://getbluemantis.com`.

## 6. Auth pages (Clerk sign-in / sign-up)

Rendered by **dev-copilot** (`artifacts/dev-copilot/src/App.tsx`, `AuthPage`) at `/app/sign-in` and `/app/sign-up` using Clerk's `<SignIn>` / `<SignUp>`. Currently customized:
- **Social logins hidden** (GitHub, Google) + the "or" divider, via Clerk `cl-*` CSS selectors in `src/index.css`.
- **"Development mode" badge hidden** via `components/HideClerkDevBadge.tsx` — finds it by text (clerk-js loads from CDN, so class names are version-unstable) and hides it with a short-lived MutationObserver. This is a "for now" measure; the real fix is a **production Clerk instance** (see §12).
- **Sign-up replaced:** the sign-in footer says **"Don't have an account? Request access"**, a full-page link to the marketing **`/contact/`** page (instead of Clerk's default sign-up).
- Successful auth → `forceRedirectUrl = /app/dashboard`.

---

# AUTHENTICATED AREA

## 7. Product app (`artifacts/dev-copilot`, `/app`)

### 7.1 Auth, routing, providers
- **Auth:** `@clerk/react`. `ClerkProvider` wraps the app; `RequireAuth` gates protected routes; unauthenticated users redirect to `/app/sign-in`. `useGitHubSync()` fires `POST /api/auth/github-sync` once per session to pull the Clerk-held GitHub OAuth token into `integration_configs`.
- **Router:** `wouter`, base = `import.meta.env.BASE_URL` (`/app`).
- **Provider nesting:** `ErrorBoundary → ThemeProvider → ClerkProvider → QueryClientProvider → RepoProvider → ConfigProvider → WouterRouter`; `TabsProvider` is mounted lower inside `AppShell`.
- **Root `/`:** signed-in → `/app/dashboard`, else → `/app/sign-in`.

### 7.2 Pages & UX (`src/pages/`)
| Route | File | What it does |
|---|---|---|
| `/app/dashboard` | `dashboard.tsx` | Stat tiles + Recharts bar/pie + recent activity (from `/api/stats/*`) |
| `/app/tasks` | `tasks.tsx` | Task list with source/type/priority badges + filters + "Generate code" |
| `/app/tasks/new` | `new-task.tsx` | Create manual task (react-hook-form + zod) |
| `/app/tasks/:id` | `task-detail.tsx` | Task CRUD, link repo, "Generate Code" → workspace |
| `/app/workspace/:taskId` | `WorkspacePage.tsx` | 3-column: task + acceptance criteria / AI suggestions (4 agent tabs, scored) / action panel (commit + PR + complete + stepper) |
| `/app/repositories` | `repositories.tsx` | Repo list + connect dialog |
| `/app/repositories/:id` | `repository-detail.tsx` | Repo detail + stack profile panel |
| `/app/settings` | `SettingsPage.tsx` | Per-user integration credentials (8 cards): Anthropic, OpenAI, Gemini, Copilot, GitHub, Azure Repos, Jira, Azure DevOps — test/save/remove |
| `/app/history` | `HistoryPage.tsx` | **Stub** (empty state only) |
| `/app/sign-in`, `/app/sign-up` | `AuthPage` in `App.tsx` | Clerk (see §6) |

Shell: `components/layout/{AppShell,Sidebar,TabBar}.tsx`. Design tokens in `src/styles/tokens.css` (dark `#0D0F12` base, accent-blue `#4D9CFF`, Inter/JetBrains Mono). Clerk appearance uses `colorPrimary #4d9cff`.

### 7.3 API access from the app
- Most pages use **generated React Query hooks** from `@workspace/api-client-react` (e.g. `useListTasks`, `useGetDashboardStats`, `useCreateRepository`).
- **`src/services/api.ts`** is a hand-written `fetch` client used by `WorkspacePage` + `RepoContext` for endpoints not in the generated set: `generateSuggestions`, `commitCode`, `completeTask`, `fetchRepositories`, `redetectStack`.
- **`SettingsPage`** calls `/api/config` and `/api/config/test/:integration` with inline `fetch`.
- All URLs are relative (`/api/...`); the Clerk session cookie authenticates. **Contexts:** `ConfigContext` (loads `/api/config`, exposes `configMap`, `isAzureConnected`, `isJiraConnected`), `RepoContext` (active repo + stack), `TabsContext` (open-tab state).

> Note: `WorkspacePage` currently includes some **placeholder UI** (a hardcoded diff header, a "no existing file" pane, and sub-score bars derived from the single real score). Treat these as mock until wired to real backend data.

---

# API, DATA & FLOWS

## 8. API server (`artifacts/api-server`)

### 8.1 Structure & middleware
`src/app.ts` sets up: `pino-http` logging, `clerkProxyMiddleware` (Replit-era Clerk FAPI proxy), CORS, JSON body parsing, `clerkMiddleware`, mounts the `/api` router, and a global error handler returning `{ error }`. Express 5 auto-propagates async errors. **The suggestion rate limiter was removed** for serverless (see `TODO(serverless)` in `app.ts`).

`src/routes/index.ts` mounts **public routes before `requireAuth`**, everything else after:
```
public:   waitlistRouter, contactRouter
requireAuth ↓ (sets req.userId)
authed:   health, repositories, tasks, taskActions, stats, config
```

### 8.2 Endpoints
| Method + path | Auth | Purpose |
|---|---|---|
| `POST /api/waitlist` | public | Launch waitlist signup + notify/confirm emails |
| `POST /api/contact` | public | Request Access / Walkthrough → emails the team (§5.4) |
| `GET /api/healthz`, `GET /api/health` | authed | Liveness |
| `GET/POST /api/repositories` · `GET/PATCH/DELETE /api/repositories/:id` | authed | Repo CRUD (create triggers stack detection) |
| `GET /api/repositories/:repoId/stack` | authed | Re-detect + save stack profile |
| `GET/POST /api/tasks` · `GET/PATCH/DELETE /api/tasks/:id` | authed | Task CRUD; **GET list syncs from PLM first** |
| `POST /api/tasks/:taskId/suggestions` | authed | AI code suggestions (see §8.4) |
| `POST /api/tasks/:taskId/commit` | authed | Branch + commit + open PR; task → `review` |
| `POST /api/tasks/:taskId/complete` | authed | Close in PLM + task → `done` |
| `GET /api/stats/dashboard` · `tasks-by-status` · `tasks-by-source` · `recent-activity` | authed | Dashboard data |
| `GET /api/config` · `PUT/PATCH /api/config` · `DELETE /api/config/:key` | authed | Per-user credential store (masked reads) |
| `POST /api/config/test/:integration` | authed | Live connection test per integration |
| `POST /api/auth/github-sync` | authed | Pull Clerk GitHub OAuth token → save as `GITHUB_TOKEN` |

### 8.3 Services & adapters
- **`configService.ts`** — per-user CRUD over `integration_configs`; `CONFIG_KEYS`; secret masking.
- **`gitService.ts`** — high-level Git engine: `GitService.forRepo(repoId, creds)` picks GitHub (Octokit) or Azure Repos (raw REST); low-level commit flow (blob → tree → commit → ref) + PR; `fetchFileContext(taskId, keywords, stack)` ranks files by keyword, returns top 5 up to ~8000 chars. Auto-detects stack on first connect.
- **`plmService.ts`** — merges Azure DevOps + Jira via `Promise.allSettled` (error-isolated), dedupes; dispatches `closeTask`.
- **`emailService.ts`** — Resend HTTP API. `sendWaitlistNotification/Confirmation` and `sendContactEmail` (to arvind.kandula@ + accounts@venakaninfo.com). No-op if `RESEND_API_KEY` unset.
- **Adapters:** `adapters/gitService.ts` (`fetchFilePaths` only, used by the repo stack route), `azureDevOpsAdapter.ts` (WIQL fetch, json-patch close), `jiraAdapter.ts` (JQL open-sprints, ADF→text, transition-based close).
- **Stack:** `stack/detector.ts` (path-substring heuristics → `StackProfile`), `stack/prompts.ts` (per-framework AI prompt builder).

### 8.4 AI suggestion pipeline (`services/aiService.ts`)
`POST /api/tasks/:taskId/suggestions`:
1. Load task + repo (user-scoped). Optional `refinePrompt` appended to the description.
2. Extract keywords → `fetchFileContext` (top 5 files, ~8000 chars).
3. **`AIOrchestrator`** runs 4 agents via `Promise.allSettled`: **Claude** (`claude-sonnet-4-5`) + **OpenAI** (`gpt-4o`), plus **two hardcoded mocks** — `mockAntiGravity` and `mockCopilot` (canned output; Copilot has no public generation API).
4. **`SynthesisEngine`** (Claude) scores each on correctness / readability / minimal-diff / convention and ranks; falls back to positional scores on failure. Top result tagged `Recommended`.
5. Returns `CodeSuggestion[]` sorted by score.

`CodeSuggestion` (`shared/types/codeSuggestion.ts`): `{ agent: 'claude'|'openai'|'copilot'|'antigravity', code, explanation, filePath, language, score?, recommendation? }`.

### 8.5 Commit & complete pipelines
- **Commit** (`{ filePath, code, commitMessage }`): verify repo ownership → branch **`task/<id>`** → commit → PR titled **`[Blue Mantis] <title>`** → task `status: review`, store `linkedCommit`. Returns `{ commitHash, prUrl }`.
- **Complete** (`{ commitHash }`): close in PLM (Azure DevOps PATCH / Jira transition) if `externalId` present → task `status: done`.

## 9. Database (`lib/db`, Drizzle + PostgreSQL)

All tables in `lib/db/src/schema/`. **Every app query is scoped to `userId`** (Clerk user ID) — no shared/global data. `waitlist` is the one public, unscoped table.

| Table | Key columns |
|---|---|
| **repositories** | id, `user_id`, name, provider (`github`/`azure-repos`), url, default_branch (`main`), stack_profile (jsonb), created_at. Index on user_id. |
| **tasks** | id, `user_id`, external_id, source (`jira`/`azure-devops`/`manual`), type, title, description, acceptance_criteria, priority, status, linked_commit, repository_id (FK→repositories, `set null`), created_at/updated_at. Index on user_id. |
| **integration_configs** | composite PK (`user_id`, `key`), value (plaintext — never log), updated_at. |
| **waitlist** | id, email (unique index), name, company, role, source, created_at. |

Enums (from `shared/types/task.ts`): source `jira|azure-devops|manual`; type `feature|bug|chore|story`; priority `low|medium|high|critical`; status `open|in-progress|review|done|blocked`. `StackProfile` (`shared/types/stack.ts`): frontend, backend, database, language, testFramework, packageManager.

## 10. Config keys & environment variables

**Per-user integration keys** (`configService.ts` `CONFIG_KEYS`, stored in `integration_configs`, NOT env):
```
ANTHROPIC_API_KEY  OPENAI_API_KEY  GOOGLE_GEMINI_API_KEY  GITHUB_COPILOT_TOKEN
GITHUB_TOKEN  AZURE_REPOS_ORG  AZURE_REPOS_TOKEN
AZURE_DEVOPS_ORG  AZURE_DEVOPS_PROJECT  AZURE_DEVOPS_PAT
JIRA_DOMAIN  JIRA_EMAIL  JIRA_API_TOKEN
```

**Server environment variables:**
| Var | Critical | Notes |
|---|---|---|
| `PORT` | ✅ | api-server port (local dev) |
| `DATABASE_URL` | ✅ | PostgreSQL (Vercel: **pooled** Supabase URL, port 6543) |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk (currently a **development** instance) |
| `RESEND_API_KEY` | ⚠️ for emails | Required for waitlist + contact emails to actually send |
| `WAITLIST_FROM_EMAIL` | ⚠️ | Verified Resend from-address |
| `SESSION_SECRET` | ⚠️ | Session signing |
| AI/Git/PLM keys | ❌ | Fallbacks only; primary values are per-user in DB |

## 11. End-to-end journeys

1. **Prospect → lead:** lands on `/` → reads argument / schematic → submits **Request Access** (hero form or modal) or **Book a Walkthrough** (modal) → `POST /api/contact` → team emailed.
2. **Prospect → user:** clicks **Sign in** (nav/footer) → `/app/sign-in` (Clerk) → after auth → `/app/dashboard`. No account? "Request Your Access" → marketing modal.
3. **User daily loop:** Settings → connect PLM + repo credentials → Tasks (synced from Jira/Azure DevOps) → pick a task → Workspace → **Generate code** (4 agents, ranked) → accept → **Commit** (branch + PR) → **Complete** (closes ticket).

## 12. Known gaps, TODOs & caveats (read before extending)

- **Clerk is a development instance** (`pk_test_…`). The "Development mode" badge is hidden by a text-based JS helper as a stopgap; move to a **production Clerk instance** (prod keys + `getbluemantis.com` in allowed origins / GitHub OAuth redirects) for real removal, production limits, and security.
- **Emails need `RESEND_API_KEY`** (+ `WAITLIST_FROM_EMAIL`) on the api-server, or waitlist/contact submissions send nothing.
- **`/contact` booking URL** is still `#` (`SITE.bookingUrl`, TODO) — wire a Cal.com-style scheduling link.
- **Privacy/Terms** pages are intentional stubs pending counsel text.
- **OpenAPI spec (`lib/api-spec`) is stale** — it does not document config, task-actions, waitlist, or contact, so the generated `api-client-react`/`api-zod` clients cannot call them. Regenerate after adding endpoints if you want typed clients.
- **Suggestion rate limiting removed** for serverless (`TODO(serverless)` in `app.ts`) — the endpoint is Clerk-auth-only. Add a durable limiter (e.g. Supabase-backed) before heavy use.
- **Two of four AI agents are mocks** (`antigravity`, `copilot`) — canned output, not real models.
- **`WorkspacePage` has placeholder UI** (diff header, sub-scores) and **`HistoryPage` is an empty stub**.
- **Legacy `artifacts/blue-mantis`** (Vite marketing + waitlist) is retained but not deployed; the deployed marketing site is `website/`.
- **Vercel mixed-build risk:** the single `vercel.json` combines a Next static build + a Vite static build + a Node function. If it misbehaves, the documented fallback is to split `website/` into its own Vercel project and proxy `/app` + `/api`.

## 13. Conventions & pitfalls

- **Server:** never `console.log` — use `req.log` / `logger` (pino). Import zod as `zod/v4`. All DB queries filter by `userId`. Express 5 auto-handles async throws; use try/catch only to degrade gracefully.
- **App (dev-copilot):** relative `/api/...` URLs only (the proxy routes by path). Prefer generated React Query hooks; `api.ts` for the rest. Verify with `typecheck`, not `build` (build needs `PORT`/`BASE_PATH`).
- **Marketing (`website/`):** three-color discipline is the identity — no fourth hue, no glows/gradients/blur, no em dashes in copy, no emoji-as-icons, one H1 per page. Content is edited in `lib/site.ts`. It is a standalone npm project — run `npm` inside `website/`, not pnpm.
- **After editing `lib/*`:** run `pnpm run typecheck:libs` before checking leaf packages (stale lib declarations cause false errors).

## 14. Build / test / deploy commands

```bash
# Workspace (api-server, dev-copilot, libs)
pnpm install
pnpm run typecheck            # full typecheck (libs + artifacts)
pnpm run typecheck:libs       # build composite libs (run after editing lib/*)
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/dev-copilot run typecheck
pnpm run db:migrate           # apply Drizzle schema
pnpm --filter @workspace/api-spec run codegen   # regenerate hooks + zod (after spec edits)

# Marketing website (standalone)
cd website && npm install && npm run build        # static export → website/out

# Deploy: push to main → Vercel builds the single project per vercel.json.
```
