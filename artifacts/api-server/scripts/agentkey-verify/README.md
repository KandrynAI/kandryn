# agentkey-verify

Data-layer checks for "Use Kandryn Agents". Needs `DATABASE_URL`; not part of
`pnpm test`.

```bash
DATABASE_URL=postgres://... npx tsx scripts/agentkey-verify/resolve.ts
```

Unlike `sequence-verify`, this one truncates nothing: it writes and deletes
config rows for a single synthetic user id (`agentkey-verify-user`). Still point
it at a throwaway database, not production. The recipe for standing one up is in
`../sequence-verify/README.md`.

It sets `KANDRYN_ANTHROPIC_API_KEY` and `KANDRYN_OPENAI_API_KEY` in its own
process to fake a funded deployment, and unsets them again to prove the
downgrade path. Nothing it writes is a real credential.
