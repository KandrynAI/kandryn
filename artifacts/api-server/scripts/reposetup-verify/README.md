# Connect-time setup and the index queue — data-layer checks

The unit tests next to the source cover everything decidable without a
database: `src/services/repoSetup.test.ts` (the choice vocabulary, and that an
unknown or missing value reads as the default rather than as "do nothing"),
`src/services/graphUsability.test.ts` (the claim window, including `queued` as
a pending status and the stale window that stops a lost callback wedging a
repository), `src/services/indexClaim.guard.test.ts` (that every claim write is
awaited) and `src/lib/repoSetup.test.ts` in dev-copilot (the option list
against the server's enum, the confirm rule, the cost wording).

`queue.ts` covers what none of that can fake. It needs `DATABASE_URL` and
starts a real HTTP server on an ephemeral port to stand in for the Graphify
microservice, so the handoff, its refusal and its absence are all real. It
creates and deletes its own synthetic repositories and one synthetic project,
and truncates nothing. See `../sequence-verify/README.md` for the
throwaway-Postgres recipe.

```
DATABASE_URL=postgres://... npx tsx scripts/reposetup-verify/queue.ts
```

What it proves:

1. **The claim is one claim.** Two concurrent `claimQueuedIndex` calls on the
   same row return exactly one `true`. Two clone-and-extract jobs on a
   customer's repository is what the conditional update exists to prevent.
2. **A refused handoff is queued, not failed.** `failed` is what the
   microservice's own callback says when extraction breaks; a 503 from a
   restarting service must read as "retrying shortly", not as an error on the
   repository.
3. **A repository with no URL is settled**, so it cannot sit in the queue for
   ever being retried.
4. **The setup dispatch** stamps a choice with no outstanding work without
   doing anything, leaves a scanning choice alone while its index is still in
   flight, records a refusal in words once it is not, and does not act on a
   settled row twice.
4b. **Both failures are collected** for `index_scan_review`. The scan and the
   review are each attempted and each refusal is named in `setup_error`, so a
   customer who asked for both and whose repository is too large for one of
   them is told about each part rather than only the first.
5. **`setup_choice` survives being honoured.** Only `setup_completed_at` is
   written, because the record of what a customer asked for is the one thing an
   auditor wants when a scan appears that nobody remembers starting.
6. **The kill switch.** With `GRAPHIFY_SERVICE_URL` unset the drain does
   nothing and leaves the row untouched.

## A false pass worth remembering

The first version of check 1 raced two `dispatchQueuedIndexes()` calls in a
`Promise.all` and asserted the stub server received one request. It passed. It
also passed with the `WHERE graph_status = 'queued'` condition deleted, which
means it was testing nothing: the two ticks serialize on the connection pool,
so the second one's `SELECT` runs after the first one's `UPDATE` has already
committed and the condition is never reached.

`claimQueuedIndex` is exported for this reason, and the check races it
directly. Removing the condition now turns the result from `[true,false]` into
`[true,true]` and the check fails, which is the only evidence that it was ever
checking anything.
