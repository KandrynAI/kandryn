# UI style profile — data-layer and route checks

`src/services/uiStyle/*.test.ts` covers the extractors, which are pure: the
parsers, the validation, the caps, and the guarantee that nothing from a
customer repository is ever executed. This script covers what they cannot.

- **`profiles.ts`** — the row and the routes against a real Postgres: one
  profile per project (23505 on a second insert, asserted on `err.cause.code`),
  cross-user isolation, the claim three callers race for (exactly one wins, a
  stale claim is reclaimable, a fresh one is not), PATCH validation and the
  read/write access split. PR-B adds what a run reads and what a commit does
  to it: a profile loaded through the project OWNER rather than the triggering
  user (the 0040 tenancy trap in a new place), an unreadable profile returning
  null instead of throwing, and `markStaleIfStyling` firing on
  `tailwind.config.ts` but not on a backend file. Expect `22 passed, 0 failed`.

Not part of `pnpm test`: it imports `@workspace/db`, which throws without
`DATABASE_URL`, and it truncates `ui_style_profiles` and `projects`.

Stand up a throwaway Postgres with the recipe in
[`../sequence-verify/README.md`](../sequence-verify/README.md), then:

```sh
DATABASE_URL=... pnpm exec tsx scripts/uistyle-verify/profiles.ts
```

`drizzle-kit push` alone is enough for the table — 0042 installs no trigger —
but both of its indexes are declared in the Drizzle schema as well, because
push drops any index it cannot see there (the 0041 pitfall). The unique index
is the duplicate guard; the partial one is what the dispatcher's claim query
reads.
