-- 0029_confidence_gate.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Phase 4: a pre-generation confidence gate. Each finalized plan gets a
-- confidence score (0–1) plus the raw signals it was computed from (audit /
-- recalibration), and each project gets a threshold the score is compared to.
--
-- NOTE: confidence_threshold DEFAULT 0.6 is an UNCALIBRATED PLACEHOLDER — it is
-- not tuned against real data; the retrieval eval harness is what should set it.
-- confidence_signals stores the raw inputs so the score can be recalibrated
-- later without re-running planning.

ALTER TABLE change_plans ADD COLUMN IF NOT EXISTS confidence_score numeric;
ALTER TABLE change_plans ADD COLUMN IF NOT EXISTS confidence_signals jsonb;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS confidence_threshold numeric NOT NULL DEFAULT 0.6;
