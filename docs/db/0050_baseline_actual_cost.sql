-- Kandryn — what a baseline scan actually cost  (migration 0050)
--
-- WHY
--
-- baseline_scans.estimated_cost_usd has been stored since 0035 and compared
-- against nothing. No real charge is recorded anywhere in this product, which
-- has two consequences: the estimate cannot be calibrated, and an estimate
-- that is wildly wrong in either direction is invisible. One of those matters
-- to the customer and the other to us.
--
-- TOKENS AND COST ARE BOTH STORED, on purpose. The token counts are facts the
-- provider reports per request. The cost is those tokens priced by the rate
-- table in services/baselineScanCore.ts, which is an assumption. Keeping the
-- tokens means a scan can be re-priced when a published rate moves; keeping
-- only the cost would leave old rows frozen at a price nobody can reconstruct.
--
-- actual_cost_usd is null for a model with no rate in that table, rather than
-- 0: a scan that cost real money and reads as free is worse than one that
-- reads as not priced. The tokens are still recorded in that case.
--
-- Additive and idempotent. All three are declared in
-- lib/db/src/schema/baselineScans.ts as well, so `drizzle-kit push` does not
-- propose dropping them.

ALTER TABLE baseline_scans
  ADD COLUMN IF NOT EXISTS actual_cost_usd numeric(10, 4);

ALTER TABLE baseline_scans
  ADD COLUMN IF NOT EXISTS input_tokens integer;

ALTER TABLE baseline_scans
  ADD COLUMN IF NOT EXISTS output_tokens integer;
