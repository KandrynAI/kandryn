# Run timeline — data-layer checks

The unit tests next to the source cover everything decidable without a
database: `src/services/runEventCore.test.ts` (the per-type allowlist, the
field kinds, the summary templates, the structural leak guard) and
`src/services/runEvents.test.ts` (buffering, flush ordering, failure isolation,
the seq block arithmetic).

`seq.ts` covers the one thing they cannot fake: whether Postgres actually
serializes two emitters on the same run, and therefore whether a `since_seq`
cursor can lose an event.

It is not part of `pnpm test`, deliberately. It imports `@workspace/db`, which
throws without `DATABASE_URL`, and it truncates the tables it uses.

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
cd ../.. && pnpm exec tsx scripts/runevents-verify/seq.ts
```

`0044` installs **no trigger**, so unlike `0038` this one does not have to be
applied by hand for the checks to mean anything. Verified on 2026-11-06: a
`push-force` alone produces both indexes (`run_events_run_seq_uq`,
`run_events_user_created_idx`), all three CHECK constraints and
`runs.event_seq bigint NOT NULL DEFAULT 0`, and re-running
`docs/db/0044_run_events.sql` over that database is a clean no-op. Checks 4–4c
exist to catch a database where that stopped being true.

## What it covers

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
