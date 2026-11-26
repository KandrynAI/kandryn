# Domain context — data-layer checks

The unit tests next to the source cover the vocabulary:
`src/services/domainRule.test.ts` pins that only `confirmed` is
authoritative, that an extraction may write only `proposed`, and that every
fallback direction is the safe one (an unrecognised status reads as
`proposed`, never as authoritative; an unrecognised origin reads as
`inferred`, so a model's guess is never credited to a person).

`schema.ts` covers what is only true if Postgres says so. It needs
`DATABASE_URL`, creates and deletes its own synthetic rows, and truncates
nothing. See `../sequence-verify/README.md` for the throwaway-Postgres recipe.

```
DATABASE_URL=postgres://... npx tsx scripts/domain-verify/schema.ts
```

What it proves:

1. **The review gate is structural.** A `confirmed` row with no reviewer is
   refused on insert *and* on update, so an extractor cannot write one even if
   its code tried, and a row cannot be promoted later without naming someone.
2. **A rejection is always attributable.** A `rejected` row with no reason, or
   a blank one, is refused. A dismissal nobody signed is indistinguishable
   from a statement nobody looked at, and it is carried forward silently into
   every later extraction.
3. **Evidence carries a locator, per kind.** Code with no path, tracker with
   no key, document with no source id and person with nobody named are each
   refused. Code evidence that cannot be checked against anything is not
   evidence.
4. **A human decision outlives the job.** Deleting the extraction leaves a
   confirmed rule standing with its reviewer intact and only the link cleared
   (`ON DELETE SET NULL`), and deleting a newer revision does not delete the
   row it superseded.
5. **Evidence is owned by its rule.** Deleting a rule takes its evidence and
   nothing else.
6. **No evidence row can carry a quote.** Asserted on the returned row shape,
   because a `quote` column would make this the first table storing excerpts
   of a customer's code and documents, and the first endpoint returning them.

## Why the negative controls matter here

Checks 1 to 3 are constraints, and a constraint a later migration drops is
invisible to every test that only exercises the happy path. That is exactly
how 0033's missing trigger went unseen. So each was verified by dropping it
and re-running:

| constraint dropped | checks that fail |
|---|---|
| `domain_rules_confirmed_has_reviewer` | 2 |
| `domain_rules_rejected_has_reason` | 2 |
| `domain_rule_evidence_has_locator` | 5 |

`refused()` matches the constraint name on `err.cause` as well as `err`,
because Drizzle wraps the pg error and an assertion reading only
`String(err)` reports a false pass — the trap CLAUDE.md records for `23505`
and for trigger errors.

Both migration directions were checked: `drizzle-kit push` on an empty
database creates all eight constraints and all ten indexes, and a push onto a
database the SQL built drops none of them.

---

## `extract.ts` — PR 2b, the extractor

What the unit tests beside the source cannot reach: the claim under a real
race, the fingerprint skip across two extractions, what the locator CHECK
actually refuses, and which sources are read in which order.

```sh
DATABASE_URL=... npx tsx scripts/domain-verify/extract.ts
```

Same throwaway-Postgres recipe as above, plus `docs/db/0052_domain_rules.sql`
applied by hand (`drizzle-kit push` creates the tables and the CHECKs, and
0052 installs no trigger, so push alone is nearly enough — apply the file
anyway so the indexes match production).

**The claim is raced directly, not through `dispatchQueuedExtractions()`.**
Two dispatcher ticks serialize on the connection pool, so the second read
happens after the first write and the conditional UPDATE is never exercised;
that test would pass with the condition deleted. Racing `claimQueuedExtraction`
itself is what makes removing `status = 'queued'` turn `[true, false, false]`
into `[true, true, true]`, which is how this was verified.
