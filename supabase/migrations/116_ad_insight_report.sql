-- 116: structured Understand — a Qoves-style report, not paragraphs.
-- ad_insights already caches headline + bullets; add `report` for the structured
-- breakdown (hook / emotion / audience / offer / visual style / story arc /
-- confidence) the ad page renders as labeled rows. Cached forever, same as bullets.

alter table ad_insights add column if not exists report jsonb;
