# Project knowledge — data-layer and route checks

`src/services/documentParser.test.ts` and `src/services/contextPack.test.ts`
cover everything decidable without a database: the chunker, the magic-byte
check, the private-key refusal, and the pack's reference section. These two
scripts cover what they cannot.

- **`retrieval.ts`** — the full-text query against a real Postgres: both
  tenancy filters, the ranking, the cascade, the rank bar, and the
  duplicate-upload constraint (asserted on `err.cause.code`, per the
  CLAUDE.md pitfall). Expect `9 passed, 0 failed`.
- **`pack.ts`** — `buildRunContextPack` end to end: both halves of the pack
  in one run, and the scoping decision behind it (the **project owner**, not
  `run.userId` — on a team project those differ and scoping by the triggerer
  would silently return nothing). Expect `5 passed, 0 failed`.
- **`api.ts`** — the four routes over HTTP with auth stubbed: validation
  order, the read/write access split, and the not-configured answer.
  Storage is deliberately left unconfigured — these are the decisions the
  routes make before a byte reaches a bucket. Expect `13 passed, 0 failed`.

Neither is part of `pnpm test`: both import `@workspace/db`, which throws
without `DATABASE_URL`, and both truncate the tables they use
(`knowledge_chunks`, `knowledge_sources`, `projects`, plus `tasks` for
`pack.ts` and `teams` for `api.ts`).

Stand up a throwaway Postgres with the recipe in
[`../sequence-verify/README.md`](../sequence-verify/README.md), apply the
schema, then:

```sh
DATABASE_URL=... pnpm exec tsx scripts/knowledge-verify/retrieval.ts
DATABASE_URL=... pnpm exec tsx scripts/knowledge-verify/pack.ts
DATABASE_URL=... pnpm exec tsx scripts/knowledge-verify/api.ts
```

`drizzle-kit push` alone is enough for these: 0041 installs no trigger. It
does install two indexes push cannot express on its own — the partial unique
index on `(project_id, content_hash)` and the GIN index on `tsv` — both of
which are declared in the Drizzle schema so push leaves them in place rather
than dropping them.
