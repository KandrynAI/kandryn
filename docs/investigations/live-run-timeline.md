# Live run timeline — PR0 investigation

Status: **investigation only. No code changed.**
Date: 2026-11-06. Verified against `main` @ `ec836d3`, migrations through `0043`.

What follows was read out of the code, not recalled. Where a claim is measured
rather than read, the experiment is given. Line numbers are from the commit
above.

**What I could not do:** run a real multi-file agent run. The sandbox has no
Anthropic, OpenAI or GitHub credentials and no live Supabase, so nothing here is
confirmed against a live pipeline (CLAUDE.md §2: runtime testing happens on the
Vercel deploy). What I did run is an ephemeral local Postgres 16 to settle the
`seq` concurrency question, because that is the one design decision in this
feature where being wrong is expensive and reasoning is unreliable. Those
results are in §8.1 and they changed my recommendation.

---

## 1. Execution model

**Every one of the six agents runs inline inside an Express request handler on
`@vercel/node` with `maxDuration: 300` (root `vercel.json`). There is no queue,
no worker and no background process.**

### Manual run

`POST /api/work-items/:id/runs` (`routes/runs.ts:94`):

1. Validates the item, snapshots the project repository onto the run.
2. Validates the schedule, then the Sequence Guard gate (`evaluateGate`).
3. Inserts the `runs` row (`queued`) and any override record in **one
   transaction** (`routes/runs.ts:187`).
4. **`await executeRun(run.id)` — line 270, in the request handler.**
5. Re-reads the run and its suggestions and responds `201`.

So the HTTP response is held for the entire run, and the run has a hard 300s
ceiling. If the client aborts, the function is killed mid-run and the row stays
`running` until the 20-minute stuck sweep.

### Scheduled run

Inserted `scheduled`, responds `202`. The cron (`*/5 * * * *` →
`GET|POST /api/internal/dispatch-runs`, `CRON_SECRET` bearer) then, per tick
(`routes/internal.ts:57`):

1. Sweeps `running` rows older than 20 min to `failed`.
2. Claims up to **2** due rows with `FOR UPDATE SKIP LOCKED` → `queued`.
3. `holdIfOrderChanged(id)`, then **`await executeRun(id)` sequentially** for
   each claimed run — so up to 2 runs share one 300s invocation.
4. Baseline-scan sweep/collection, UI-style profile dispatch, Jira retention.

### Order inside `executeRun` (`services/runService.ts:317`)

| # | Step | Where | Model |
|---|---|---|---|
| 1 | run → `running`, `started_at` | `runService.ts:340` | — |
| 2 | load work item, resolve repo, stack profile | `:345`–`:357` | — |
| 3 | git file context (graph or keyword) | `:386` | — |
| 4 | project context pack (ancestors + document retrieval) | `:426` | — |
| 5 | **change planner** (`runPlanning`) | `:477` | Anthropic |
| 6 | confidence gate — may park at `awaiting_review` and **return** | `:518`–`:552` | — |
| 7 | UI style guide resolution | `:558` | — |
| 8 | **Raptia + Fovea in parallel** | `aiService.ts:394`–`402` | Anthropic + OpenAI |
| 9 | per-agent `resolveFileOps` + one hunk-repair attempt | `aiService.ts:416` | Anthropic (repair only) |
| 10 | static coherence check | `runService.ts:245` | — |
| 11 | **Synthesia** — one call scoring the pair | `runService.ts:252` → `aiService.ts:646` | Anthropic |
| 12 | persist suggestions + `suggestion_files` | `runService.ts:261`–`:304` | — |
| 13 | optional auto-commit: branch, commit, PR | `:635`–`:645` | — |
| 14 | run → `succeeded` | `:661` | — |
| — | on throw: run → `failed`, error string | `:689` | — |

Parallelism is exactly one place: `Promise.allSettled` over `callClaude` and
`callOpenAI` (step 8). Everything else is sequential. Aegis is internally
parallel over files (`mapWithConcurrency`, `aegisService.ts:369`).

**There is a second generation path.** `regenerateFromPlan`
(`runService.ts:895`) repeats steps 4, 7, 8–12 for the plan-revise /
edit-then-approve flow, with its own terminal writes at `:970`–`:979`.
Instrumenting only `executeRun` would leave a revised run with a blank
timeline.

### Post-commit agents — also inline, also in their own request

| Agent | Route | Service | Shape |
|---|---|---|---|
| Veria | `POST /runs/:id/review` (`routes/runs.ts:671`) | `runVeriaReview` (`veriaService.ts:153`) | `await`ed inline, responds with the review |
| Aegis | `POST /runs/:id/security` (`:820`) | `runAegisScan` (`aegisService.ts:338`) | sets `security_scan_status='running'` first so a concurrent call gets `202`, then `await`s; per-file with bounded concurrency; whole-set retry on the retention fallback |
| Narratia | `POST /runs/:id/runbook` (`:1023`) | `runNarratia` (`narratiaService.ts:148`) | `await`ed inline |

Consequence that matters for `seq`: a stage is owned by exactly one Node
process **for its own duration**, but different stages are owned by different
processes, and **Veria and Aegis can be fired concurrently by a user** — two
processes emitting against one run at the same time. See §8.1.

---

## 2. Existing progress data

There is a rich per-run **result** record and no per-run **progress** record.
The timeline is genuinely new data, not a re-presentation of something stored.

**`runs`** (`lib/db/src/schema/runs.ts:130`) — one row, fields overwritten in
place: `status`, `trigger`, `started_at`, `finished_at`, `error`, `pr_url`,
`commit_hash`, `committed_suggestion_id`, `used_graph_context`,
`agent_failures` (0039), `context_manifest` (0040/0042), `stack_desc`,
`review` + `review_status`, `security_scan` + `security_scan_status` +
`security_gate`, `runbook` + `runbook_status` + `runbook_target` +
`runbook_url`, `parent_run_id`, `trigger_context`, `run_by_user_id`,
`approved_by_user_id` + `approved_at`. Indexes: `runs_user_id_idx`,
`runs_status_scheduled_idx`. **No `seq`, no event counter, no team_id.**

**`change_plans` / `change_plan_files`** — `revision`, `status`,
`retrieval_mode`, `candidate_files`, `confidence_score`,
`confidence_signals`, `notes`. Scoped by `run_id` **only**.

**`suggestions`** — `agent`, `model`, `score`, `recommendation`,
`score_breakdown`, `score_narrative`, `coherence_score` / `_status` /
`_findings`, `test_cases`, `test_script`.

**`suggestion_files`** — per file: `op`, `file_path`, `apply_status`,
`apply_error`, `lines_added`, `lines_removed`, `diff`, `source_blob_sha`.

**`audit_log`** (0018 + 0033) — `team_id`, `user_id`, `action`,
`entity_type`, `entity_id`, `metadata` jsonb, `ip_address`, `user_agent`,
`prev_hash`, `row_hash`. Writes are fire-and-forget. The hash chain is set by
a **BEFORE INSERT trigger**, never by the application.

**Aegis override trail today:** an `aegis_overrides` row (`run_id`,
`project_id`, `team_id`, a frozen snapshot of the findings being cleared, a
mandatory reason, `same_actor`) plus an `audit_log` entry. It records the
*decision*, not the scan's progress.

Also: `sequence_checks` / `sequence_overrides` (0038), `baseline_scans`
(0035–0037).

---

## 3. How the UI learns a run's status

**Polling, 3s, already built — and the user is not on the page while a manual
run executes.**

`pages/run-detail.tsx` (1778 lines) is the only component that renders a run.
It uses a plain `fetch` through `services/api.ts` (`fetchRun`), **not** TanStack
Query. `POLL_MS = 3000` (`:119`); the polling effect (`:171`–`:215`) is already
exactly the shape PR3 needs:

- `setInterval` rather than a chained timeout, deliberately, so one failed poll
  does not silently kill polling.
- Stops when `document.hidden`, restarts on `visibilitychange`, and does one
  immediate read on return.
- Active while the run is in progress, or `awaiting_review`, or
  `reviewStatus` / `securityScanStatus` / `runbookStatus === "running"`.
- A silent poll failure keeps the last good data instead of replacing the page
  with an error.

No SSE, no WebSocket, no Supabase Realtime anywhere in the repo.

**The blocking-POST problem.** `components/runs/RunPanel.tsx:118` does
`await createRun(...)` and only navigates to `/runs/:id` at `:140`, after it
resolves. Since the POST does not resolve until `executeRun` finishes, a user
who presses **Run now** watches a spinner in the dialog for the whole run and
then lands on an already-terminal run page. The client sets no timeout or
abort signal.

**So the first acceptance criterion cannot be met by the timeline alone.** The
timeline would be correct and complete and nobody would see it live. §7 lists
the options; this needs your decision before PR3.

---

## 4. Tenancy and auth

- **Clerk** via `@clerk/express`: `clerkMiddleware` in `app.ts`, `requireAuth`
  sets `req.userId`, `attachTeam` sets `req.teamId` / `req.teamRole`.
- **`runs` is scoped by `user_id` (the project owner) + `project_id`. There is
  no `tenant_id` and no `team_id` on `runs`.** Team access is derived through
  `projects.team_id`.
- The read rule for a run (`routes/runs.ts:334`–`344`): owner sees it; else a
  team member whose `req.teamId` equals the run's project's `team_id`; else
  **403**. PR3's endpoint should mirror this byte for byte.
- **There is no single "tenant and project columns" convention to match.** The
  four run-adjacent tables disagree:

  | Table | Scoping columns |
  |---|---|
  | `runs` | `user_id`, `project_id` |
  | `change_plans` | `run_id` only |
  | `aegis_overrides` | `run_id`, `project_id`, `team_id` |
  | `sequence_checks` | `user_id`, `team_id`, `work_item_id` |

  Recommendation in §9.
- **No row-level security anywhere.** A case-insensitive search for
  `row level security` / `ENABLE ROW` / `rls` across `lib/`,
  `artifacts/api-server/src`, `artifacts/dev-copilot/src` and `docs/db`
  returns nothing. Isolation is already entirely in the API layer, so
  decision (g)'s "do not rely on RLS" costs nothing: there is nothing to stop
  relying on.
- **The browser never talks to the database.** The only `@supabase/supabase-js`
  import in the repo is `services/knowledgeStorage.ts`, and it is Storage-only
  (signed upload URLs for project documents). The database goes through
  `lib/db/src/index.ts` = Drizzle on `drizzle-orm/node-postgres` with a
  `pg.Pool`. The one direct browser-to-Supabase path is a document upload PUT
  to a signed Storage URL — not the DB, and unrelated to this feature.
- So the data layer is **already vendor-neutral**. Decision (g) requires no
  migration, only that we do not introduce `supabase-js` or `LISTEN/NOTIFY`
  here.

---

## 5. Transport decision

**Recommendation: (A) polling `GET /runs/:runId/events?since_seq=N`, 1.5s while
the run is active.** This matches your default, and the Vercel shape makes it
not a close call.

Why not SSE:

1. **The run and the stream are different invocations.** The run occupies the
   invocation handling the POST. An SSE handler is a second invocation that
   cannot see the first one's memory, so it would have to poll Postgres
   internally anyway. SSE buys no freshness over polling here — it only moves
   the polling server-side and bills for it.
2. **`maxDuration: 300` cuts the stream.** A long run plus Aegis plus Narratia
   exceeds 300s comfortably, so the client needs reconnect-and-backfill logic
   regardless. Having built that, polling is the simpler half of it.
3. **Connection cost.** Each viewer holds an open function for the run's
   duration and a pooled `pg` connection with it. Two viewers on a 4-minute run
   is two function-minutes of pure waiting, per viewer, on top of the run.
4. **Polling is already written.** `run-detail.tsx:171`–`215` is a
   visibility-aware interval that stops at a terminal state. PR3 becomes "add a
   second poller at a shorter interval", not "add a transport".

On the 2-second criterion: a 1.5s interval plus one insert round trip lands
inside 2s **only if the emitter flushes on a short timer** rather than at stage
boundaries. A batcher that flushes when a stage ends would make Raptia's whole
generation step appear at once, several seconds late. §9 pins the flush policy.

---

## 6. Instrumentation points

Every row below is a place where the named facts are already in scope. None
requires a behaviour change.

### Orchestrator and generation

| Event | Site | Allowlisted fields available there |
|---|---|---|
| `run.started` | `runService.ts:340` | `trigger`, `triggerContext`, `autoCommit` |
| `context.read` (`stack_profile`) | `:356` | `stackDesc` (already a derived label, no item text) |
| `context.read` (`repo_graph`) | `:386` | `usedGraph`, `retrievalMode` |
| `context.read` (`work_item` / `parent` / `document`) | `:426` | `contextPack.manifest.sections[]` → `kind`, `included`, `available`, `truncated`, `refs` (tracker keys and `sourceId:chunkId` only — already content-free by 0040's design) |
| `context.read` (`ui_style`) | `:558` | `profileId`, `revision`, `injected`, `approxTokens` |
| `stage.started/completed` (planner) | `:477` | `retrievalMode`, candidate count, `confidenceScore` |
| `plan.step` | `:477` result → `planSummary.plan.files[]` | **`op` and `path` and the index only.** `PlannedFile.rationale` is model prose — must not be emitted (see §8.2) |
| run parked at the confidence gate | `:518`–`:552` | `confidenceScore`, `threshold`, `weakestSignal` |
| `stage.started/completed/failed` (Raptia, Fovea) | `aiService.ts:394`–`433` | `agent`, `model`, duration; on failure, **a code, not `result.reason.message`** |
| `file.write` | `aiService.ts:416` (`resolveFileOps`) | `filePath`, `op`, `linesAdded`, `linesRemoved`, `applyStatus` |
| `check.result` (coherence) | `runService.ts:245` | `status`, finding **count** by kind |
| `score.dimension` | `:252` → `aiService.ts:669`–`685` | dimension name, numeric value, weight. **Not** `verdict` / `reason` / `overallNarrative` — all model prose |
| commit / PR | `:635`–`:645` | branch name, `commitHash`, `prUrl`, file count |
| `run.completed` | `:661` | suggestion count, top score, whether committed |
| `run.failed` | `:689` | **a reason code and counts only.** `msg` at `:687` concatenates `applyError`, which contains the model's own search text |

`regenerateFromPlan` needs the same treatment at `:928`, `:939`, `:949`,
`:970`, `:974`.

### Post-commit agents

| Event | Site | Allowlisted fields |
|---|---|---|
| Veria `stage.*` | `routes/runs.ts:671`, `veriaService.ts:153` | duration, finding counts |
| Veria `check.result` | `veriaService.ts:197` | finding `type` (`gap`/`risk`/…), `severity`, and `filePath` **after `validateFindingPaths` (`:207`) has checked it against the real changed-file list**. Never `title` or `detail` — both are model prose |
| Aegis per-file `check.result` | `aegisService.ts:369`/`385` loop, results read at `:405`–`:410` | `filePath`, OWASP category ids, counts by severity, `scanned` / `unscanned` / `refused` |
| Aegis model fallback | `:380`–`:388` | an info event: that a fallback happened. The reason string names models — fine for `data`, but it is also the one string here worth keeping out of `summary` |
| `gate.result` | `:426` (`gateDecision`), published by `routes/runs.ts:820`+ | `approved`/`blocked`, blocking counts, `blockedByCoverage` vs `blockedByFindings` |
| `runbook.section` | `narratiaService.ts:131`–`141` (`parseMarkdownSections`) | **section `title` only.** The title comes from the model's `## ` heading, so it is model-authored text and must be matched against a known section allowlist, not passed through (see §8.2) |

### The one signature change PR2 needs

`AIOrchestrator.generateSuggestions` and `SynthesisEngine.synthesize` are in
`aiService.ts` and do not know `runId`. Emitting from inside them means either
importing the db-backed emitter into `aiService.ts` (which couples a
mostly-pure module to the database and breaks `aiServiceRepair.test.ts`'s
ability to run without one) or **passing an optional `onEvent?` callback down**.
I recommend the callback: observe-only, injectable, and testable with a stub.

---

## 7. The blocking-POST problem (needs your decision)

Acceptance criterion 1 ("sees steps appear within about 2 seconds of each
happening") requires the user to be on the run page *while the run runs*. Today
they are not (§3). Options:

| | Option | Change | Risk |
|---|---|---|---|
| **i** | Client fires the POST and navigates immediately **without awaiting it**; the request stays in flight in the background while the user watches the timeline | `RunPanel.tsx` only. **No server change.** | If the tab closes the browser may abort the request and the function dies mid-run → row stuck `running` until the 20-min sweep. **That risk exists today, unchanged.** |
| **ii** | Split the endpoint: POST creates the run and returns `202`; a separate fire-and-forget `POST /runs/:id/execute` does the work | Route + client | Same tab-close risk; a cleaner contract; a new endpoint to authorize |
| **iii** | Respond `202` and keep working after the response | Route | **Unsafe.** `@vercel/node` reclaims the invocation when the response ends; there is no `waitUntil` in use here. Work would be killed non-deterministically |
| **iv** | Let the cron dispatcher pick up every run | Route | Up to 5 minutes before "Run now" starts. Fails the criterion differently |

**I recommend (i)** for PR3: it is the smallest change, needs no server change
at all, and does not alter run behaviour — only when the user is navigated. It
does change the manual-run UX (you land on the run page immediately instead of
when it finishes), so it is a behaviour change to approve, not one to slip in.

---

## 8. Risks

### 8.1 `seq` under parallel writers — measured, and it changed my answer

Ephemeral Postgres 16, two concurrent `pg` clients, a table shaped like the
proposed one with `UNIQUE (run_id, seq)`:

**A. `seq = (SELECT coalesce(max(seq),0)+1 …)` from two writers**

```
session1 -> seq=1 | session2 -> ERROR 23505
session2 blocked while session1 held the key: true
rows now : [{"seq":"1","note":"A-first"}]
```

Not merely a duplicate risk: the second writer **blocks** on the first's
unconfirmed unique key for as long as that transaction is open, then fails.
That violates decision (e) — emission would slow the run. **Rejected.**

**B. a global `nextval()` sequence plus a `since_seq` cursor**

```
seq assigned: slow=1 fast=2
poll#1 (since_seq=0) : [{"seq":"2","note":"B-fast"}] -> client cursor = 2
poll#2 (since_seq=2) : []
actually in table    : [{"seq":"1","note":"B-slow"},{"seq":"2","note":"B-fast"}]
VERDICT : EVENT PERMANENTLY LOST to the cursor
```

Two writers take 1 and 2; the one holding 2 commits first; a poll lands between
the commits, sees only 2 and advances the cursor past 1. When 1 commits it is
behind the cursor and **is never delivered**. A plain global sequence is not a
safe cursor. **Rejected** — and this is the failure mode I would have shipped
on reasoning alone.

**C. a per-run counter claimed in the same transaction as the insert**

```
session1 seq=1, session2 seq=2
session2 blocked until session1 committed: true -> seq order == commit order: true
```

`UPDATE runs SET event_seq = event_seq + $n … RETURNING event_seq` inside the
insert's transaction holds the row lock to commit, so a second emitter cannot
claim a range until the first has committed. seq order therefore equals commit
order and the cursor cannot skip. Cost: one extra `UPDATE` **per batch**, and
brief serialization between concurrent emitters on one run — which only happens
when two stages genuinely overlap (a user firing Veria and Aegis together).
**This is the recommendation.**

An in-process counter is *not* sufficient on its own: the post-commit agents
each run in a fresh process, and two of them can be triggered concurrently, so
two emitters would seed from the same `max(seq)` and collide (case A).

### 8.2 Content leakage vectors

The content-free rule has specific, named enemies in this codebase. Each is a
field that looks like metadata and is actually model or tracker prose:

1. **`runs.error` / the `msg` built at `runService.ts:687`** — concatenates
   `applyError`, which embeds the model's own failed search text.
2. **`PlannedFile.rationale`** — model prose on every plan step.
3. **`scoreBreakdown.*.verdict` / `.reason` / `overallNarrative`** — model
   prose per dimension.
4. **Veria `finding.title` / `.detail`** — model prose.
5. **Narratia section titles** — come from the model's `## ` headings
   (`narratiaService.ts:133`), so even a "section name" is model output. Match
   against a known-section allowlist rather than passing it through.
6. **Work item title / `externalId`** — tracker-authored. `externalId` is an id
   and fine; the title is not.
7. **Aegis finding descriptions and the model-fallback reason string.**

This is why decision (c) matters more than it sounds: the summary template must
take only allowlisted scalars, and the allowlist must be **per event type**, so
a future `data` field cannot smuggle prose into a type that never carried it.

### 8.3 Other risks

- **Emission on the run's critical path.** A per-event `INSERT` adds a round
  trip inside the run. Batch with a short flush timer (§9), and never `await`
  the flush from the agent path.
- **`run_events` must not get an audit-style hash-chain trigger.** `audit_log`'s
  0033 trigger serializes inserts on the team's chain head; applying that
  pattern to a high-volume event table would serialize every emitter in a team.
  The timeline is evidence by retention and immutability-by-convention, not by
  chaining.
- **Pooler.** If `DATABASE_URL` points at Supabase's transaction-mode pooler,
  session state and prepared statements are unsafe across statements. The
  claim-and-insert transaction in 8.1C is fine (one transaction); `LISTEN`/
  `NOTIFY` is not, and is already excluded by decision (g).
- **The 20-minute stuck sweep** (`routes/internal.ts:63`) flips a run to
  `failed` with no event, so a killed run's timeline just stops. PR2 can emit
  from the sweep, or PR3 can render "no terminal event" honestly. Worth a
  decision, not a blocker.
- **`drizzle-kit push` drops indexes it cannot see in the Drizzle schema** and
  does not warn (CLAUDE.md §15). Every `run_events` index must be declared in
  both `lib/db/src/schema/runEvents.ts` and `docs/db/0044_*.sql`.
- **Volume.** A 10-file multi-file run with both agents is roughly 60–90 events
  (two stage pairs, ~20 file writes, ~12 score dimensions, plan steps, context
  reads). Aegis adds one per changed file. Small, but the retention constant in
  decision (d) should be written down in PR1 rather than discovered later.

---

## 9. Conventions to follow

- **Migration:** `docs/db/0044_run_events.sql`, additive and idempotent
  (`IF NOT EXISTS`), applied by hand in Supabase **before** deploy. Drizzle
  schema at `lib/db/src/schema/runEvents.ts`, exported from `index.ts`.
- **Column style:** snake_case; `serial` PK; enum-ish columns are
  `text().$type<Union>()` — the codebase uses **no `pgEnum`** (`runs.status` is
  `text("status").$type<RunStatus>()`). `sequenceChecks.ts` and
  `aegisOverrides.ts` both import `check` from `drizzle-orm/pg-core`, so a SQL
  `CHECK` constraint on `agent` / `type` / `status` is the established way to
  pin the values.
- **Scoping:** mirror `runs` — `run_id`, `user_id`, `project_id`, and **no
  `team_id`**, because `runs` has none and team visibility is derived from
  `projects.team_id`. Denormalising `user_id` and `project_id` onto the event
  row (rather than joining through the run on every read) follows the
  precedent `knowledge_chunks` set in 0041 for the same reason.
- **Indexes:** `UNIQUE (run_id, seq)` — it is both the cursor index and the
  guard that makes a double-claim loud instead of silent — plus
  `(user_id, created_at)` for any later admin read.
- **Logging:** `req.log.*` in handlers, `logger.*` in services, never
  `console.log`.
- **Tests:** api-server is `tsx --test "src/**/*.test.ts"` with `./x.js`
  import specifiers. dev-copilot is `node --test --experimental-strip-types`
  with `./x.ts` specifiers, and **cannot test JSX** — so the timeline's logic
  (grouping, ordering, backfill, collapse, replay, elapsed) must live in
  `artifacts/dev-copilot/src/lib/runTimeline.ts`, the pattern
  `uiStyleView.ts` and `knowledgeQueue.ts` already follow.
- **UI tokens:** the app's real token set is `--c-*` in
  `artifacts/dev-copilot/src/index.css`: `--c-bg`, `--c-surface`, `--c-raised`,
  `--c-border`, `--c-ink`, `--c-ink-2`, `--c-ink-3`, `--c-ink-4`, `--c-blue`,
  `--c-green`, `--c-amber`, `--c-red` with `-bg` variants; type at
  `--text-xs: 11px` / `--text-sm: 13px`; mono at `--mono: 'JetBrains Mono'`.
  Warnings and failures use `--c-amber` / `--c-amber-bg` per your brief.
- **Components to reuse:** `components/ui/collapsible.tsx` (finished stages),
  `scroll-area.tsx` (the feed), `badge.tsx`, `tooltip.tsx`, `skeleton.tsx`,
  `separator.tsx`.
- **Agent display:** `src/lib/agents.ts` maps only `claude`→Raptia and
  `openai`→Fovea. Synthesia, Veria, Aegis, Narratia and `system` need adding
  for the timeline's grouping.

### Two documentation corrections found on the way

- **CLAUDE.md §10's design-language paragraph is stale.** It describes a teal
  `--accent-blue:#19c39a` / `--bg-app:#0b1110` token set and a type scale of
  "22→11px", and names `components/layout/Sidebar.tsx`. The live tokens are the
  `--c-*` set above, the scale tops out at 13px, and that Sidebar file does not
  exist (the shell is `CommandRail` + `TopBar` + `ContextPanel` / `RightPanel`).
- **CLAUDE.md §2 lists one cron.** `vercel.json` has two:
  `/api/internal/dispatch-runs` every 5 minutes and `/api/internal/audit-cleanup`
  at 03:00. There is also an unlisted `/api/internal/encrypt-configs`.
- **`docs/ARCHITECTURE.md` is substantially out of date** (it describes a single
  Vercel project, a three-colour marketing design, and a `/app` base path).
  Updating it for this feature means updating a document that no longer
  describes the system. Flagging rather than fixing: say whether PR1 should
  correct the sections it touches or whether ARCHITECTURE.md gets its own pass.

---

## 10. Proposed plan for PR1–PR3

Adjusted for what the investigation found. Changes from your brief are marked
**[changed]**.

### PR1 — schema and emit helper

1. `lib/db/src/schema/runEvents.ts` + `docs/db/0044_run_events.sql`.
   Columns: `id` serial PK, `run_id` (FK, cascade), `user_id`, `project_id`,
   `seq` bigint, `agent` text + CHECK, `type` text + CHECK, `status` text +
   CHECK, `summary` text (≤160), `data` jsonb, `created_at` timestamptz,
   `duration_ms` int null. `UNIQUE (run_id, seq)` + `(user_id, created_at)`.
   **[changed]** `runs` gains an `event_seq bigint not null default 0` counter
   column — required by the §8.1C result. That makes `0044` touch `runs`, which
   is additive and safe, but it is a change to the brief's table list.
   → *verify:* `drizzle-kit push` against a throwaway Postgres, read the
   statement list, confirm both indexes and the CHECKs survive and nothing is
   dropped.
2. `services/runEvents.ts`: `createRunEmitter(runId, …)` returning
   `{ emit, flush, close }`. Per-type allowlist; template summaries; size caps;
   batch claim-and-insert in one transaction; `try/catch` that logs and
   swallows; **[changed]** flush on a ~400ms timer *or* at 20 buffered events,
   whichever comes first, because a stage-boundary flush cannot meet the
   2-second criterion (§5).
   → *verify:* unit tests per your list (allowlist drops unknown keys, template
   output, caps, failure isolation), plus a parallel-seq test with two emitters
   on one run, plus a test that a thrown DB error leaves `emit` resolved.
3. Retention constant in one place, per decision (d). No purge job.
4. CLAUDE.md + ARCHITECTURE.md entries for the table and helper.

### PR2 — instrument the agents

1. `onEvent?` callback threaded into `AIOrchestrator.generateSuggestions` and
   `SynthesisEngine.synthesize` (§6).
2. Emit from `executeRun` **and `regenerateFromPlan`** **[changed]** — the
   brief did not mention the second path; a revised run would otherwise have a
   blank timeline.
3. Emit from the Veria, Aegis and Narratia routes/services.
4. `RUN_EVENTS_ENABLED` env flag, default on, hard off.
   → *verify:* a stubbed-model end-to-end run asserting the per-agent sequence;
   a leakage test that scans every emitted `summary` and `data` for the seven
   §8.2 vectors; an identical-results test with emission on and off.

### PR3 — API and timeline UI

1. `GET /runs/:id/events?since_seq=N&limit=` mirroring
   `routes/runs.ts:334`'s owner-or-team-member rule and its 403.
2. `src/lib/runTimeline.ts` (pure) + a `Live` view on the run page, reusing the
   existing polling shape at 1.5s.
3. **[changed]** `RunPanel.tsx` navigates without awaiting the POST (§7,
   option i) — needs your approval, since it changes manual-run UX.
   → *verify:* endpoint tests (auth, cross-tenant 403, cursor correctness,
   page cap); `runTimeline.test.ts` for ordering, backfill de-duplication,
   collapse and replay.

---

## Decisions I need before PR1

1. **`runs.event_seq`.** Adding a counter column to `runs` is the only design
   the measurements support (§8.1). Confirm, or tell me to accept the
   gap-skip risk a global sequence carries.
2. **The blocking POST** (§7). Approve option (i) for PR3, or pick another.
3. **`run.failed` content.** The existing `runs.error` string embeds model
   text, so the event must carry a code and counts, not the message. Confirm
   the timeline may show "failed — no suggestion could be applied (2 agents)"
   and send the reader to the existing error panel for detail.
4. **Narratia section names** are model-authored headings. Allowlist against
   the eight known sections and emit `other` for anything else, or drop
   `runbook.section` entirely?
5. **ARCHITECTURE.md.** It no longer describes the system (§9). Correct only
   the sections PR1 touches, or schedule its own pass?
