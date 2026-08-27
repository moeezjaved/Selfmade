-- Prices for the actions the gating sweep now charges (all hit paid models). 1 credit = 1¢.
-- Includes cro_audit again in case 174 wasn't applied — this one statement covers everything.
INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd, is_active) VALUES
  ('cro_audit',          'Conversion (CRO) audit',   40, 0.28, TRUE),
  ('programmatic_batch', 'Pages-at-scale batch',     80, 0.55, TRUE),
  ('geo_build',          'GEO asset (llms.txt/schema)', 40, 0.22, TRUE),
  ('geo_reach',          'GEO outreach drafts',      40, 0.30, TRUE)
ON CONFLICT (action_type) DO UPDATE
  SET label = EXCLUDED.label, credits = EXCLUDED.credits, est_cost_usd = EXCLUDED.est_cost_usd, is_active = TRUE;
