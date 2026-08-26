-- Credit prices for the API-using SEO/GEO/content actions. These call paid LLM APIs (OpenAI/Gemini),
-- so they now cost credits like media — for EVERYONE (free + paid). Free's 75-credit trial is spent on
-- these too; out of credits → upgrade/buy. 1 credit = 1¢.
--
-- Prices (credits / $ charged to user):
--   blog_draft         80  ($0.80)  — long article + optional hero image
--   geo_check          60  ($0.60)  — asks ChatGPT + Gemini a batch of buyer questions (~$0.44 raw)
--   geo_answer         40  ($0.40)  — writes one GEO answer page (single LLM write)
--   seo_audit          40  ($0.40)  — site crawl + LLM analysis
--   competitor_decode  40  ($0.40)  — decodes a rival's ad DNA (LLM)
--
-- est_cost_usd is our approximate raw API cost, for margin tracking.
INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd, is_active) VALUES
  ('blog_draft',        'Blog article draft',        80, 0.55, TRUE),
  ('geo_check',         'AI-visibility check',       60, 0.44, TRUE),
  ('geo_answer',        'GEO answer page',           40, 0.28, TRUE),
  ('seo_audit',         'SEO audit',                 40, 0.28, TRUE),
  ('competitor_decode', 'Competitor ad decode',      40, 0.28, TRUE)
ON CONFLICT (action_type) DO UPDATE
  SET label = EXCLUDED.label, credits = EXCLUDED.credits, est_cost_usd = EXCLUDED.est_cost_usd, is_active = TRUE;
