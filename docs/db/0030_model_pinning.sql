-- 0030_model_pinning.sql — Governance item 2: model version pinning.
-- Additive + idempotent. Apply in Supabase before deploying the code that writes
-- these columns.

-- The exact generation model string persisted on each suggestion (going
-- forward; NULL on pre-instrumentation rows — not backfilled).
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS model text;

-- Per-project, per-provider pinned generation model (NULL = unpinned = use the
-- current default). Governance-complete: every provider that can touch code is
-- pinnable independently.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pinned_claude_model text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pinned_openai_model text;
