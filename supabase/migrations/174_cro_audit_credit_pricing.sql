-- CRO audit costs credits (crawl + one LLM review), like the SEO/GEO audits. 1 credit = 1¢.
INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd, is_active) VALUES
  ('cro_audit', 'Conversion (CRO) audit', 40, 0.28, TRUE)
ON CONFLICT (action_type) DO UPDATE
  SET label = EXCLUDED.label, credits = EXCLUDED.credits, est_cost_usd = EXCLUDED.est_cost_usd, is_active = TRUE;
