-- Pricing model v2 (2026-07-17) — the customer sees VIDEOS & IMAGES, not credits.
-- Internal plan ids are KEPT (no data migration): `starter` → "Creator", `business` → "Agency",
-- `pro` stays a hidden legacy tier. Subscribers' image remakes are free (enforced in app code,
-- reserveCredits); their monthly_credits is the VIDEO budget (1 video = 600 cr).
--
-- All DML (row updates), no schema change — safe to run under load. apply_plan reads plans.monthly_credits,
-- so these values are what a new subscriber's wallet gets refilled to.

-- Creator ($49/mo) = 10 video ads → 6,000 cr; Agency ($149/mo) = 30 → 18,000 cr; Free = 5 image ads → 75 cr.
UPDATE plans SET name = 'Creator', price_monthly_cents = 4900,  monthly_credits = 6000,  seats = 1 WHERE id = 'starter';
UPDATE plans SET name = 'Agency',  price_monthly_cents = 14900, monthly_credits = 18000, seats = 5 WHERE id = 'business';
UPDATE plans SET                    monthly_credits = 75                                          WHERE id = 'free';
-- Hidden legacy 'pro' — keep valid for any existing subscriber, align to the 1¢ video budget.
UPDATE plans SET monthly_credits = 12000 WHERE id = 'pro';

-- Video ad = $6.00 (was 650/$6.50). Image ad stays $0.15 (image_clone_pro = 15). The multi-video
-- (x2/x3/x4) and fast rows are unchanged — they already price longer/batch renders at 1cr = 1¢.
UPDATE credit_pricing SET credits = 600, est_cost_usd = 3.15 WHERE action_type = 'video_clone';
