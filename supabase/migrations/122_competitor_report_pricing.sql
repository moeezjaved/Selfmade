-- Charge 50 credits ($0.50) to generate a Competitor Intelligence Report — healthy margin over the
-- ~$0.19 Opus cost. reserve_credits() prices by action_type at runtime from this table. Pure data,
-- no function change; safe to apply live (no PostgREST reload needed). Editable in admin Credit Pricing.

INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd, is_active)
VALUES ('competitor_report', 'Competitor Intelligence Report', 50, 0.19, true)
ON CONFLICT (action_type) DO UPDATE
  SET credits = EXCLUDED.credits, label = EXCLUDED.label, est_cost_usd = EXCLUDED.est_cost_usd, is_active = true;
