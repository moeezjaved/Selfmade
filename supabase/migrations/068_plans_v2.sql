-- Plans v2 (pricing spec §1): free/starter/pro/business/enterprise. Extends the plans table with a
-- brand_limit and repoints existing users off the old ids (trial→free, core→starter, plus→pro).
ALTER TABLE plans ADD COLUMN IF NOT EXISTS brand_limit INT NOT NULL DEFAULT 1;

-- New/updated plan rows (price in cents; -1 credits/brand_limit = custom/unlimited handled in code).
INSERT INTO plans (id, name, price_monthly_cents, monthly_credits, seats, brand_limit, sort_order, is_active) VALUES
  ('free',       'Free',       0,     20,   1,  1,   0, true),
  ('starter',    'Starter',    3900,  150,  1,  15,  1, true),
  ('pro',        'Pro',        9900,  500,  3,  50,  2, true),
  ('business',   'Business',   24900, 2000, 10, 150, 3, true),
  ('enterprise', 'Enterprise', 0,     0,    15, -1,  4, true)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name, price_monthly_cents = excluded.price_monthly_cents,
  monthly_credits = excluded.monthly_credits, seats = excluded.seats,
  brand_limit = excluded.brand_limit, sort_order = excluded.sort_order, is_active = true;

-- Repoint users + any subscriptions off the legacy ids, then retire them.
UPDATE user_profiles SET plan_id = 'free'    WHERE plan_id = 'trial';
UPDATE user_profiles SET plan_id = 'starter' WHERE plan_id = 'core';
UPDATE user_profiles SET plan_id = 'pro'     WHERE plan_id = 'plus';
UPDATE user_profiles SET plan_id = 'free'    WHERE plan_id IS NULL OR plan_id NOT IN ('free','starter','pro','business','enterprise');
ALTER TABLE user_profiles ALTER COLUMN plan_id SET DEFAULT 'free';

UPDATE plans SET is_active = false WHERE id IN ('trial','core','plus');
