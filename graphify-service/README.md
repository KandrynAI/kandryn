# Graphify Microservice

Standalone Python service that builds Graphify knowledge graphs
for Blue Mantis repositories.

Graphify is Python; Vercel Node functions cannot spawn Python, so this
service runs separately (Railway/Render) and the Blue Mantis API calls it
over HTTPS. It is **not** part of the pnpm workspace and does not deploy on
Vercel.

## Endpoints

- `GET  /health` → `{"status": "ok"}`
- `POST /index`  → clone a repo, run `graphify extract`, POST `graph.json` back
  to the Blue Mantis callback URL. Returns `202` immediately (runs in the
  background).
- `POST /query`  → keyword-query a supplied `graph.json` (mirrors the Phase 1
  JS logic); returns `{ direct, neighbors }`.

All non-health endpoints require the `x-service-secret` header to match
`GRAPHIFY_SERVICE_SECRET`.

## Deploy to Railway

1. Create a new Railway project.
2. Connect this directory (`graphify-service/`) as the source.
3. Set environment variables:
   - `GRAPHIFY_SERVICE_SECRET=<random 32-char string>`
4. Railway auto-detects the Dockerfile and deploys.
5. Copy the public URL (e.g. `https://bm-graphify.up.railway.app`).

## Set in Blue Mantis (Vercel)

Add these environment variables:

    GRAPHIFY_SERVICE_URL=https://bm-graphify.up.railway.app
    GRAPHIFY_SERVICE_SECRET=<same random string>

## Test

    curl https://bm-graphify.up.railway.app/health
    # → {"status": "ok"}
