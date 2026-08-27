-- Pages at Scale is now charged PER PAGE (paid plans only; Free hits an upgrade wall).
-- Add the per-page price. Batch price (programmatic_batch) is left in place but no longer used by the
-- generate route. Adjust `credits` here to change the per-page cost.
INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd, is_active) VALUES
  ('programmatic_page', 'Pages-at-scale (per page)', 10, 0.07, TRUE)
ON CONFLICT (action_type) DO UPDATE
  SET label = EXCLUDED.label, credits = EXCLUDED.credits, est_cost_usd = EXCLUDED.est_cost_usd, is_active = TRUE;
