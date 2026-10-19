# Sequence Guard — data-layer checks

The unit tests next to the source (`src/services/*.test.ts`) cover everything
that can be decided without a database. These scripts cover what cannot: the
queries, the transaction, the cascade behaviour, the immutability trigger, and
the HTTP contract of the run endpoint.

They are not part of `pnpm test`, and deliberately so. Every one of them
imports `@workspace/db`, which throws without `DATABASE_URL`, and the test
runner has none. Running them against a shared database would also be wrong:
each script truncates the tables it uses.

## Running them

Stand up a throwaway Postgres, apply the schema, then run whichever script you
want. Nothing here touches a real environment.

```sh
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
PGROOT=/tmp/pg-seqguard
rm -rf $PGROOT && mkdir -p $PGROOT/data $PGROOT/run
chown -R nobody $PGROOT && chmod 755 $PGROOT          # Postgres refuses to run as root
su nobody -s /bin/sh -c "$PGBIN/initdb -D $PGROOT/data -U postgres -A trust"
su nobody -s /bin/sh -c "$PGBIN/pg_ctl -D $PGROOT/data -l $PGROOT/pg.log \
  -o '-k $PGROOT/run -p 55432 -h 127.0.0.1' -w start"

createdb -h 127.0.0.1 -p 55432 -U postgres seq
export DATABASE_URL="postgres://postgres@127.0.0.1:55432/seq"

(cd ../../../../lib/db && pnpm run push --force)       # tables
psql $DATABASE_URL -f ../../../../docs/db/0038_sequence_guard.sql   # trigger + constraints

cd ../.. && for s in links sequence impact api hold; do
  CLERK_SECRET_KEY=sk_test_x pnpm exec tsx scripts/sequence-verify/$s.ts
done
```

**Apply `0038` by hand, as above.** `drizzle-kit push` creates the three tables
but not the immutability trigger — a run on a push-only database will report
the trigger tests as passing when nothing is protecting the rows.

## What each covers

| Script | Spec tests | Checks |
|---|---|---|
| `links.ts` | — | Tracker links reconcile: insert, idempotent, drop what the tracker stopped reporting, never touch `manual`/`inferred`, drop edges leaving the project, `userId` scoping, cycles kept, cascade on task delete |
| `sequence.ts` | 1–10 | Every finding type end to end, suggested order, policy `off`, member vs admin under `admin_override_only`, snapshot persistence, fingerprint stability and movement, waves, cross-user isolation |
| `impact.ts` | 19, 20 | No model key still yields a usable impact; facts persisted; **no file contents or secrets** in facts or impact; untrusted tracker text flagged; caching |
| `api.ts` | 13–19, 23 | The run endpoint's refusals and the transaction, clear-path writes nothing, events, policy, run order, admin gating |
| `hold.ts` | 21, 22 | A new blocker before dispatch holds the run; a real decision row refuses `UPDATE` and survives its run being deleted with the hash intact |

Spec tests 11 and 12 (finding ids, fingerprints, waves) are pure and live in
`src/services/sequenceGraph.test.ts` instead.

## One trap worth knowing

Drizzle wraps the driver error, so a trigger's message is on `err.cause`, not
on the error itself — the same reason the 23505 → 409 rule checks the cause
chain. An assertion matching only `String(err)` will report a **false pass**
when the immutability trigger fires. `hold.ts` checks the chain.
