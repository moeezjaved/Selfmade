-- 2026-08-17: restore the THIRD brand type — 'app' (software / SaaS / website).
-- brand_type was CHECK-constrained to ('physical','service'), so the app/website choice the user makes
-- at brand creation collapsed to 'service' and the app-demo generation path never fired. Widen the
-- check to allow 'app'. Purely additive — existing rows are all physical/service and untouched.
ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_brand_type_check;
ALTER TABLE brands ADD CONSTRAINT brands_brand_type_check CHECK (brand_type IN ('physical','service','app'));

-- Recover brands that were REALLY apps but got saved as 'service' — the true choice survived in
-- brand_kit.category, so backfill from there. Idempotent + safe to re-run.
UPDATE brands SET brand_type = 'app'
WHERE brand_type = 'service' AND brand_kit->>'category' = 'app';
