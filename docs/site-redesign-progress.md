# Marketing site redesign: progress log

A fresh session should be able to resume from this file alone. Updated at the
end of every phase. Scope rule for all phases: changes live in `website/`,
plus this log and `docs/marketing-claims.md`.

---

## Where things stand

**Phase 0 (discovery and claim ledger): complete.** Report posted 2026-11-27.
No visual or copy change was made in this phase.

**Important inherited state.** This branch, `claude/repo-setup-6osjsy`, already
carries a substantially complete redesign built against two earlier versions of
the brief (commits `acb4cfe`, `75ded86` and the ones between). The phased brief
supersedes those. Phases 1 to 5 are therefore partly *reconciliation* rather
than greenfield work: the palette, header, dropdowns, mobile accordion, six
industry pages, platform pages, use-case detail pages, University lessons,
Trust rail and legal restyle all exist and build clean. What each phase must
change is listed below under "Phase N delta".

Unrelated work on the same branch: `f99aa01` is the backend domain-rule
extractor (migration `0052`, api-server only). It is not part of the marketing
site and must not be touched or reverted by this work.

---

## Project facts established in Phase 0

- Marketing project: `website/`, Next.js 15.1.11, React 19, **npm**, outside the
  pnpm workspace (globs are `artifacts/*`, `lib/*`, `lib/integrations/*`,
  `scripts`). Static export, `trailingSlash: true`.
- Scripts: `dev`, `build`, `vercel-build`, `start`, `lint`, `check:copy`.
  **There is no test script and no test runner.** `build` performs the
  typecheck. `lint` is `next lint` with no ESLint config, so it drops into an
  interactive setup prompt and cannot run unattended.
- Deploy: Vercel project `kandryn_marketing`, root `website/`, its own
  `website/vercel.json` holding two permanent redirects (`/security` and
  `/security/` to `/trust/#boundaries`). The product is a separate Vercel
  project driven by the root `vercel.json`.
- Fonts: Archivo and JetBrains Mono via `next/font/google` in `app/layout.tsx`.
- Tokens: `website/app/globals.css` `:root`. The A6 palette is already the
  shipped palette.

---

## Open owner and counsel questions

See the A9 list in the Phase 0 report and the final section of
`docs/marketing-claims.md`. Nothing in that list has been changed.

---

## Next

Phase 1: design system, header, menus, footer, homepage. See the Phase 1 delta
in the Phase 0 report.
