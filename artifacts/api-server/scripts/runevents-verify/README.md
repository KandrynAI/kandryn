# Run timeline — data-layer checks

The unit tests next to the source cover everything decidable without a
database: `src/services/runEventCore.test.ts` (the per-type allowlist, the
field kinds, the summary templates, the structural leak guard) and
`src/services/runEvents.test.ts` (buffering, flush ordering, failure isolation,
the seq block arithmetic).

`src/services/runEventsInstrumentation.test.ts` (PR2) drives the **real**
`AIOrchestrator` with only the two provider calls stubbed, so the per-agent
event sequence, the leak guard against a real prompt, and the on/off
equivalence are all covered without a database.

Two scripts cover what none of that can fake:

- **`seq.ts`** — whether Postgres actually serializes two emitters on the same
  run, and therefore whether a `since_seq` cursor can lose an event.
- **`pipeline.ts`** — a whole run's timeline (33 events, two generation agents
  interleaved, Synthesia's dimensions, a commit) stored and read back the way
  PR3's endpoint will, including a cursor read in halves.

Neither is part of `pnpm test`, deliberately. Both import `@workspace/db`,
which throws without `DATABASE_URL`, and they truncate the tables they use.

A real end-to-end `executeRun` is not possible here at all: it needs Anthropic,
OpenAI and GitHub credentials, and the sandbox has none (CLAUDE.md §2). So
`pipeline.ts` replays the sequence `executeRun` emits rather than causing it.
The sequence it replays is kept in step with `runService.ts` by hand — if you
add or move an emit site there, update it here.

## Running it

```sh
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
PGROOT=/tmp/pg-runevents
rm -rf $PGROOT && mkdir -p $PGROOT
chown -R nobody $PGROOT && chmod 755 $PGROOT          # Postgres refuses to run as root
su nobody -s /bin/sh -c "$PGBIN/initdb -D $PGROOT/data -U postgres -A trust"
su nobody -s /bin/sh -c "$PGBIN/pg_ctl -D $PGROOT/data -l $PGROOT/pg.log \
  -o '-k $PGROOT -p 55433' -w start"

PGHOST=$PGROOT PGPORT=55433 $PGBIN/createdb -U postgres evt
export DATABASE_URL="postgres://postgres@localhost:55433/evt?host=$PGROOT"

(cd ../../../../lib/db && pnpm run push-force)        # tables, indexes, CHECKs
cd ../.. && for s in seq pipeline; do pnpm exec tsx scripts/runevents-verify/$s.ts; done
```

`0044` installs **no trigger**, so unlike `0038` this one does not have to be
applied by hand for the checks to mean anything. Verified on 2026-11-06: a
`push-force` alone produces both indexes (`run_events_run_seq_uq`,
`run_events_user_created_idx`), all three CHECK constraints and
`runs.event_seq bigint NOT NULL DEFAULT 0`, and re-running
`docs/db/0044_run_events.sql` over that database is a clean no-op. Checks 4–4c
exist to catch a database where that stopped being true.

## What `pipeline.ts` covers

| # | Check |
|---|---|
| 0 | The timeline is not empty. Without it every check below passes vacuously on an empty table — which is what `RUN_EVENTS_ENABLED=false` produces, and is how this guard came to be written |
| 1–1b | Every event stored, `seq` contiguous from 1, insertion order preserved |
| 2–2b | Every agent the pipeline uses (`system`, `raptia`, `fovea`, `synthesia`) has a start and an outcome, and completion events carry durations |
| 3 | No stored row carries ticket, document, diff or prompt text, in any column |
| 4 | A cursor read in halves sees every event exactly once — PR3's resume path |
| 5–5e | The stored summaries read as prose a person can scan, and all fit the column |

Run it with `RUN_EVENTS_ENABLED=false` as the kill switch's own negative
control: check 0 fails and `select count(*) from run_events` is 0.

## What `seq.ts` covers

| # | Check |
|---|---|
| 1–1d | The claim assigns a contiguous block from 1; `runs.event_seq` tracks the high-water mark; the scope columns are written; the stored summary is templated and the stored `data` is allowlisted |
| **2–2c** | **The headline check.** Two emitters write 40 events each, one batch per event, while a poller advances a `since_seq` cursor between their commits. Every event must be stored contiguously and the cursor must see each exactly once |
| 3 | A duplicate `(run_id, seq)` raises `23505`, read off `err.cause` as Drizzle wraps it |
| 4–4c | `agent`, `type` and `status` are constrained by the database, not only by the TypeScript unions |
| 5–5c | Retention is the run's lifetime: deleting the run, or its project, deletes the timeline. No purge job exists and none is needed |
| 6–6b | The denormalised scope columns isolate at the data layer. The endpoint's rule (owner, or a team member of a team project, else 403) is PR3's to test |

## The negative control

Check 2b passes trivially if the writes happen to be ordered, so it was run
against the design it exists to rule out. Replacing the per-run claim with a
global `nextval()` sequence — everything else unchanged — makes it fail:

```
FAIL  2b. a since_seq cursor lost nothing
          cursor saw 78 of 80: missing 1,2,3,4,5,56,69
```

Seven events written, stored, and never delivered. That is the failure mode
`runs.event_seq` exists to prevent, and the reason `run_events.id` is not an
acceptable cursor either: a serial PK is allocated outside the transaction in
exactly the same way. Background in
`docs/investigations/live-run-timeline.md` §8.1.
