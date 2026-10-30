# Jira app (Forge) — data-layer and route checks

`src/middlewares/forgeAuth.test.ts` and `src/services/jiraExt/codes.test.ts`
cover what is pure: token verification against a locally generated key pair,
the algorithm pin, the code alphabet and normalization. This script covers
what they cannot.

- **`links.ts`** — the linking flow and the issue endpoint against a real
  Postgres and real HTTP handlers with a stubbed Forge context: the typed-code
  rules (single use, expiry, lockout, newest-code-wins, installation
  isolation), the 409 on a Jira account already linked elsewhere, revoke by a
  non-owner, cross-user isolation on the issue endpoint, the partial unique
  index on active links, and 23505 surfacing on `err.cause.code`.

Not part of `pnpm test`: it imports `@workspace/db`, which throws without
`DATABASE_URL`, and it truncates the tables it uses.

Stand up a throwaway Postgres with the recipe in
[`../sequence-verify/README.md`](../sequence-verify/README.md), apply
`docs/db/0043_jira_forge.sql`, then:

```sh
DATABASE_URL=... pnpm exec tsx scripts/jiraext-verify/links.ts
```

`drizzle-kit push` alone is enough for these four tables — 0043 installs no
trigger — but all three indexes are declared in the Drizzle schema as well,
because push drops any index it cannot see there. Losing
`jira_account_links_active_uq` would silently allow two active links for one
Jira user, which is the one thing the 409 depends on.
