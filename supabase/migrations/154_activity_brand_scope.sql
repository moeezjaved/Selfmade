-- 2026-08-18: brand-scope the Activity Log (standing brand-isolation rule).
-- Activity was account-wide — switching the active brand still showed every brand's events. Add a
-- nullable brand_id so brand-facing events (spy, M4, pulls, Mello actions) attach to a brand, while
-- account-level events (subscription, auth, credits) stay NULL and always show under any brand / "All".
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES brands(id) ON DELETE SET NULL;
-- Fast per-user, per-brand, newest-first reads for the Activity page.
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_brand_created ON activity_logs (user_id, brand_id, created_at DESC);
