# Kandryn — Vercel Deployment Guide

> **Stale:** this describes the pre-#127 single-project layout (`/app` prefix,
> `artifacts/blue-mantis` as the marketing SPA). Since #127 there are two Vercel
> projects — see CLAUDE.md §2. Kept for the Supabase/env sections.

This is the runbook for deploying Kandryn to **Vercel** with **Supabase** (Postgres)
and the project's **own Clerk** instance. It covers what's already in the repo and the
manual dashboard steps to finish the cutover.

## What's already wired in the repo

- **`vercel.json`** (root) — one Vercel project, three outputs routed by path prefix:
  - `/api/*` → the Express API as an `@vercel/node` serverless function
    (`artifacts/api-server/src/serverless.ts`), `maxDuration: 300` for the
    multi-agent suggestion endpoint.
  - `/app` and `/app/*` → `dev-copilot` (the app SPA).
  - `/` → `blue-mantis` (the legacy marketing SPA; superseded by `website/`).
- **Serverless handler** — `artifacts/api-server/src/serverless.ts` exports the Express
  `app` as the function handler. Local dev still uses `src/index.ts`
  (`validateEnv()` + `app.listen()`); it is unchanged.
- **`vercel-build` scripts** — `blue-mantis` builds with `BASE_PATH=/`, `dev-copilot`
  with `BASE_PATH=/app/` (their `vite.config.ts` requires `PORT` + `BASE_PATH` at build
  time). The distinct base paths also stop the two `dist/public` outputs from colliding.
- **Rate limiter** — the in-memory `express-rate-limit` on `/suggestions` was removed
  (ineffective on serverless). The endpoint is currently protected only by Clerk auth.
  See the `TODO(serverless)` in `artifacts/api-server/src/app.ts` to add a
  Supabase-backed limiter before heavy use.

## C1 — Vercel environment variables

Set these in **Project Settings → Environment Variables** (Production + Preview):

| Variable | Value |
|---|---|
| `DATABASE_URL` | **Supabase POOLED** connection — host `...pooler.supabase.com`, **port 6543** (pgbouncer, transaction mode). **Not** the direct 5432 URL. |
| `CLERK_SECRET_KEY` | Your Clerk backend secret key |
| `CLERK_PUBLISHABLE_KEY` | Your Clerk publishable key |
| `VITE_CLERK_PUBLISHABLE_KEY` | Same Clerk publishable key (frontend build) |
| `SESSION_SECRET` | A random secret (if used) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. | Optional server-wide fallbacks. Primary AI/Git/PLM creds are per-user in `integration_configs`. |

**Why pooled (6543), not direct (5432):** the app opens a `pg` Pool per serverless
instance (`lib/db/src/index.ts`). Direct connections would exhaust Postgres under
serverless fan-out. The pgbouncer pooler multiplexes them. Reserve the **direct 5432**
URL for `drizzle-kit` migrations / `pnpm run db:migrate`, run locally — not the app.

> `PORT` / `BASE_PATH` are provided by the `vercel-build` scripts, not the dashboard.

## C2 — Clerk configuration for the Vercel domain

1. Add the Vercel domain (e.g. `your-project.vercel.app`) and any custom domain to
   Clerk **allowed origins**.
2. Update the **GitHub OAuth redirect / callback URLs** to the new domain so GitHub
   social sign-in works. (The `useGitHubSync` hook in `dev-copilot` then auto-saves the
   GitHub token to `integration_configs` on sign-in.)
3. Confirm the keys in C1 belong to this same Clerk application/instance.

## C3 — Deploy & verify

1. Connect the GitHub repo to Vercel and deploy `main` (or `vercel --prod` via CLI).
2. Watch the build logs — confirm **all three** builds succeed and the function bundles
   its workspace deps (`@workspace/db`, `@workspace/api-zod`). See R3 below if it fails.
3. Smoke-test the deployment URL:
   - `GET /api/healthz` → `200`.
   - `/` loads the marketing site.
   - `/app` loads the app; unauthenticated users redirect to `/app/sign-in`.
   - Sign in with GitHub → lands in the app; create/list a task or repository to confirm
     a Supabase read/write round-trips over the **pooled** connection.
   - Trigger `POST /api/tasks/:taskId/suggestions` once; confirm it finishes within
     `maxDuration`.
4. **Only after the above passes:** DNS cutover, then decommission Replit.

## Known risks to validate on first deploy

- **R1 — multi-SPA + function routing (highest).** The `builds` + `routes` layout for two
  static SPAs plus a function is the part most likely to need tweaking — the static `dest`
  paths and SPA fallbacks in `vercel.json`. If single-project routing proves painful, the
  fallback is to deploy the two frontends as **separate Vercel projects** and use the main
  project's `rewrites` to proxy `/app` and `/api`.
- **R2 — `maxDuration` placement.** It's set in the `@vercel/node` build's `config`. If
  Vercel rejects it there, drop `builds` and use zero-config + a top-level
  `"functions": { "artifacts/api-server/src/serverless.ts": { "maxDuration": 300 } }`
  (cannot coexist with `builds`).
- **R3 — workspace deps in the function bundle.** `@vercel/node` must bundle the raw-TS
  workspace packages. If it fails at runtime, pre-bundle via the existing
  `artifacts/api-server/build.mjs` (add a serverless entry) and point Vercel at the
  self-contained output.
- **R4 — Clerk proxy middleware.** `app.ts` mounts `clerkProxyMiddleware` (a
  Replit-managed-Clerk artifact). Harmless with your own Clerk; revisit only if Clerk
  requests misbehave on Vercel.
