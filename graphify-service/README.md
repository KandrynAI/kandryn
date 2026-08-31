# Graphify Microservice

Standalone Python service that builds Graphify knowledge graphs
for Kandryn repositories.

Graphify is Python; Vercel Node functions cannot spawn Python, so this
service runs separately (Railway/Render) and the Kandryn API calls it
over HTTPS. It is **not** part of the pnpm workspace and does not deploy on
Vercel.

## Endpoints

- `GET  /health` → `{"status": "ok"}`
- `POST /index`  → clone a repo, run `graphify extract`, POST `graph.json` back
  to the Kandryn callback URL. Returns `202` immediately (runs in the
  background).
- `POST /query`  → keyword-query a supplied `graph.json` (mirrors the Phase 1
  JS logic); returns `{ direct, neighbors }`.

All non-health endpoints require the `x-service-secret` header to match
`GRAPHIFY_SERVICE_SECRET`.

## Deploy to Render (recommended)

Render keeps the container's CPU alive after the HTTP response returns, which
this service needs — `/index` returns `202` immediately and does the clone +
`graphify extract` in a background task **after** responding.

1. Generate the shared secret (keep it — you'll paste it in two places):

       openssl rand -hex 16

2. Render dashboard → **New** → **Web Service** → connect the
   `KandrynAI/kandryn` repo.
3. Configure:
   - **Root Directory:** `graphify-service`
   - **Runtime:** `Docker` (Render auto-detects the Dockerfile)
   - **Instance Type:** Starter or higher (Free spins down when idle, but wakes
     on the callback request — acceptable, just slower on the first index).
4. Add an environment variable:
   - `GRAPHIFY_SERVICE_SECRET` = the value from step 1.
5. **Create Web Service.** Render builds the Docker image and deploys.
6. Copy the public URL (e.g. `https://bm-graphify.onrender.com`).

> Render injects `$PORT`; the Dockerfile already binds `uvicorn` to it.

## Set in Kandryn (Vercel)

Add these environment variables (Production), then **Redeploy**:

    GRAPHIFY_SERVICE_URL=https://bm-graphify.onrender.com     # no trailing slash
    GRAPHIFY_SERVICE_SECRET=<same value from step 1>

## Test

    curl https://bm-graphify.onrender.com/health
    # → {"status": "ok"}

Then, in Kandryn, reconnect a repository (or open its detail page) and wait
~1–2 min for the **Graphify context** dot to turn green ("Graph current").
