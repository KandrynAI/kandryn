# Project context — data-layer checks

`src/services/contextPack.test.ts` covers the pack compiler, which is pure.
This script covers what it cannot: the `loadAncestors` chain walk against a
real database — hop order, the depth cap, the cycle guard, and the two tenancy
filters that stop a repointed `parent_id` pulling another user's or another
project's item into a prompt.

Not part of `pnpm test`: it imports `@workspace/db`, which throws without
`DATABASE_URL`, and it truncates `tasks` and `projects`.

Stand up a throwaway Postgres with the recipe in
[`../sequence-verify/README.md`](../sequence-verify/README.md), then:

```sh
DATABASE_URL=... pnpm exec tsx scripts/context-verify/ancestors.ts
```

Expect `8 passed, 0 failed`.
