# Marketing claim ledger

The source of truth for what `website/` is allowed to say. Every user-facing
sentence about what Kandryn does must trace to a `SHIPPED` row here. Keep it
current: when a feature lands, add or move its row **before** any copy is
written about it.

Two rules govern the public site.

1. **Shipped claims only.** `PARTIAL` is written exactly as far as it is true.
   `IN PROGRESS` and `PLANNED` are not published at all. No "coming soon", no
   roadmap section.
2. **Disclosures stay accurate.** Marketing copy names no AI vendor or model.
   The privacy policy, terms and the Trust page still name them, deliberately,
   because removing a named processor from those pages would make them
   misleading. Those lines are listed in
   `website/scripts/copy-allowlist.json` with the reason each one is kept, and
   `npm run check:copy` (in `website/`) fails on a vendor or model name
   anywhere else.

Last reconciled: 2026-11-03, against `main` through migration `0043`.

---

## Ledger

| | Claim | Status | Evidence | Limit the copy must keep |
|---|---|---|---|---|
| a | Reads the work item's parent and hierarchy context | **SHIPPED** `2026-10-19` (`da1b29d`) | `services/contextService.ts` (`loadAncestors`), `services/contextPack.ts`, injected once at `taskSection()` in `stack/prompts.ts` plus `buildPlannerPrompt`; `docs/db/0040_context_manifest.sql`; CLAUDE.md §9 "Project context (0040)" | Three hops max (epic + story). 1800-token pack **shared with documents**; each field clipped at 700 chars; the most distant ancestor is dropped first. An item with no parents gets exactly the prompt it got before. Resolved through the project owner, not `run.userId` |
| b | Repository index, and stack detection | **SHIPPED** (index requires the microservice, which **is** configured in production) | Stack: `stack/detector.ts`, `services/stackPromptBuilder.ts`, `repositories.stack_profile`. Index: `services/graphifyService.ts`, `repositories.graph_json`/`graph_status` (`0010`, `0021`), re-indexed on connect, after every commit, and on Rebuild | A run uses the index only when `graph_status='succeeded'` **and** it is fresher than 24h (`isGraphServable`); otherwise retrieval falls back to keyword selection. Needs `GRAPHIFY_SERVICE_URL` + `GRAPHIFY_SERVICE_SECRET`. **`stack_profile.frontend` is not a framework detector** (it reports `react` for any repo with a `package.json`), so never list frameworks |
| c | Optional uploaded documents per project, retrieved per run | **SHIPPED** `2026-10-19` (`a146b84`), env-gated | `docs/db/0041_project_knowledge.sql`; `knowledge_sources` + `knowledge_chunks`; `routes/knowledge.ts`; `services/documentParser.ts`, `knowledgeStorage.ts`, `knowledgeRetrieval.ts`; UI at Project settings → Knowledge | Retrieval is **Postgres full-text** (`websearch_to_tsquery`, OR-joined, ranked by `ts_rank_cd`), not embeddings and **not training**. A rank floor drops weak matches, so a run may carry no passages at all. Up to 6 passages; references get 1000 of the 1800 pack tokens and the parent chain claims its share first. Documents are **reference, never authority**. No-op unless `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set |
| d | Accepted upload types | **SHIPPED** | `services/documentParser.ts` (`DocumentKind`, `sniffKind`); `artifacts/dev-copilot/src/lib/knowledgeQueue.ts` | Exactly `.md .txt .csv .pdf .docx`. 15 MB per file, 25 documents per project, 400 chunks per document. The real type is confirmed by **magic bytes on the server**, not the extension. Two refusals: bytes that contradict the extension, and any file containing a private-key block |
| e | Each run records the context it used, as ids and counts | **SHIPPED** `2026-10-19` | `PersistedContextManifest` in `lib/db/src/schema/runs.ts`; written in `runService.ts`; rendered as the run-detail **Context** cell | `refs` are **identifiers only** (tracker key or `#id`; `<sourceId>:<chunkId>`). Never titles, headings or text. So: a reviewer can see **what** informed a change, not read the passages |
| f | Untrusted text is fenced so it cannot instruct the agents | **SHIPPED** | `contextPack.ts` `escapeUntrusted()`, `PARENT_HEADER`, `REFERENCES_HEADER` | Prompt framing plus delimiter neutralisation: a mitigation, not a guarantee. Never write "cannot" or "impossible". Close to a security claim, so prefer folding it into row g rather than claiming it alone |
| g | Acceptance criteria take precedence over documents | **SHIPPED** | Literal prompt text in `contextPack.ts`: "the acceptance criteria win" (parents) and "the work item's acceptance criteria govern" (references) | An instruction in the prompt, not an enforced check. "Govern" is fair; "guaranteed" is not |
| h | Run-order checking, with recorded overrides | **SHIPPED** `2026-10-19` (`f564a5f`, `20a5333`, `a47b977`) | `docs/db/0038_sequence_guard.sql`; `services/sequenceService.ts` (deterministic, model-free), `sequenceGate.ts`, `sequenceImpactService.ts`; `sequence_checks`, `sequence_overrides`, `work_item_links`; team `sequence_policy` | Say "recorded with a reason and who made it". **Do not** say "cannot be altered": immutability comes from a DB trigger, and `drizzle-kit push` does not create triggers, so it must be confirmed applied in Supabase. "Done" is read from the tracker, not the PR. Jira has no backlog rank, so `out_of_rank` is Azure-DevOps-only. No edge in the dependency graph is a model guess |
| i | UI style profile, reused in generation | **SHIPPED** `2026-10-19` (`3e47ce8`, `3397a74`; merged `644a9d1` `2026-10-20`) | `docs/db/0042_ui_style_profiles.sql`; `services/uiStyle/*`; decided after planning in `runService.resolveStyleGuide`; UI style tab | **Extraction is static parsing only. No model, and nothing from the repository is executed, imported or evaluated.** No file contents stored, only validated values with evidence. Injected into **generation only**, and only when the plan touches a UI file under the detected root. Used-by counts read "not measured" without a servable index. Never "learns your design system" |
| j | Agents flag assumptions rather than making them silently | **PARTIAL** | `aiService.ts` scores `ambiguityHandling` and `surgicalPrecision` at **weight 0%** (shown on the run, no weight in the ranking); `veriaService.ts` asks the review agent for a `'Silent assumption'` gap finding | Writable: "the ranking agent scores whether a suggestion flagged the ambiguity, and the review agent calls out silent assumptions". **Not** writable: that the generation agents stop, refuse or ask. Veria is on request, after commit |
| k | Confidence score on a run | **SHIPPED, publish the gate and not the number** | `docs/db/0029_confidence_gate.sql`; `services/confidenceScore.ts` (`WEIGHTS` gap .40 / mode .20 / density .20 / historical .20, renormalised over available signals); `projects.confidence_threshold` default 0.6; a low plan parks the run at `awaiting_review` | The weights and the 0.6 default are **uncalibrated placeholders** (CLAUDE.md §14, with run #36 as the counter-example). A run with no `ready` plan is not gated. Describe the gate: a weak plan waits for a person before anything is generated. No score, no threshold, no percentage |
| l | Jira panel inside Jira, read-only | **SHIPPED IN CODE, NOT LIVE. Do not publish** | Merge `00e311b` `2026-10-30`; `middlewares/forgeAuth.ts`, `services/jiraExt/*`, `routes/extJira.ts`, `integrations/jira-forge/` | Every `/api/ext/*` route is **503 until `FORGE_APP_ID` is set in Vercel**. Nothing in the sandbox ran `forge lint`/`deploy`/`install`. The install on the site the projects sync from is still outstanding. Matching is by Jira **key**, so a moved issue breaks until the next sync |
| m | Domain or functional model extraction with human review | **PLANNED. Do not publish** | No `domain_contexts`/`domain_rules` tables; highest migration is `0043`. CLAUDE.md §14 "Domain context at connect" is a backlog entry | This is why the site describes hierarchy and documents as **background**, never as a model |
| n | Figma or design file ingestion | **NOT SHIPPED. Do not publish** | No code. `figma` appears only in CLAUDE.md §14 as a possible future for `0042` | — |
| o | Drift detection between code and documents | **NOT SHIPPED. Do not publish** | Adjacent but different: a repository URL change marks the index `stale`, and a Kandryn commit touching a styling file marks the UI style profile `stale` (`markStaleIfStyling`). Neither compares code to documents, and `knowledge_sources` has no staleness concept | — |

---

## Banned wording, whatever the ledger shows

"domain model", "functional model", "learns your business", "understands your
domain", "knowledge base that grows over time", "trained on your documents",
"fine-tuned", "proprietary", "model independent". Also: no claim that Kandryn
has its own models, that data never leaves anywhere, or any certification,
audit or compliance status.

---

## Known gaps on the site, left for a decision

1. **`website/lib/site.ts`, `SECURITY_PRINCIPLES` "Agents see a case file, not
   a repository":** says "**only** the files the change planner selects… plus
   the detected stack profile". Since `0040`/`0041`/`0042` the pack also carries
   the parent chain, retrieved document passages and the UI style guide. The
   word "only" is stale. Backlogged by decision, not fixed, because it is a
   security claim.
2. **`website/lib/site.ts`, FAQ "How much of my repository do the agents see?":**
   ends "nothing outside the repository you bound to the project is read at
   all". Uploaded documents are outside the repository and are read.
   Backlogged with item 1.
3. **Trust page data inventory has no uploaded-documents row.** Document text
   lives in `knowledge_chunks` in Supabase and the files in a private Supabase
   bucket, and neither `INFRA_ROWS` nor `SUBPROC_ROWS` records it. A disclosure
   gap created by `0041`. **For counsel.**
4. **Trust page `MODEL_ROWS` lists five agents; the site says six.** Narratia is
   missing from the table. Disclosure page, left alone.
5. **Trust page says "Last reviewed: September 2026"** and the sub-processor
   table "Last updated: August 2026", while `0040`–`0043` shipped in October.
6. **Changelog entry `2026-08-01`** says "Raptia and Fovea now detect your
   stack — React, Node, .NET, Java Spring Boot, Python, Go". Detection happens
   at repository connect, not inside the agents, and it is a file-marker guess
   rather than framework detection of that breadth.
7. **"Does Kandryn train on our code or documents?"** is deliberately **not** an
   FAQ. It depends on third-party terms. **For counsel.** Note that
   `app/privacy/page.tsx` and the Trust page already carry no-training
   statements that predate this ledger.
8. **"What happens to the documents we upload?"** is deliberately **not** an FAQ
   either: answering where they are stored cannot be done from existing site
   copy without adding a new storage disclosure, and gap 3 above has to be
   settled first.
