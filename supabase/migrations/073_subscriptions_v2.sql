-- Reconcile the legacy subscriptions table (001_initial_schema: user_id, plan CHECK monthly|annual,
-- NOT NULL stripe cols) with the v2 schema the credit system needs (owner_id, plan free/…/enterprise).
-- The legacy schema is incompatible (setting plan='pro' violates its CHECK), so preserve it and build
-- v2 fresh. No app code reads the legacy table — all queries use owner_id.

ALTER TABLE IF EXISTS subscriptions RENAME TO subscriptions_legacy;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL DEFAULT 'free',
  billing_cycle          TEXT DEFAULT 'monthly',
  status                 TEXT DEFAULT 'active',
  seats_used             INT DEFAULT 1,
  trial_end              TIMESTAMPTZ,
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  scheduled_plan         TEXT,
  monthly_credits_override INT,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_owner_idx ON subscriptions (owner_id);
GRANT ALL ON TABLE public.subscriptions TO anon, authenticated, service_role;

-- Seed one row per user from their current plan (idempotent). Carry over the Stripe customer id
-- from user_profiles if the column exists there (old billing stored it on the profile).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='stripe_customer_id') THEN
    INSERT INTO subscriptions (owner_id, plan, status, current_period_end, stripe_customer_id)
    SELECT user_id, COALESCE(plan_id,'free'), 'active',
           COALESCE(credits_reset_at, date_trunc('day', now()) + INTERVAL '1 month'),
           stripe_customer_id
    FROM user_profiles
    ON CONFLICT (owner_id) DO NOTHING;
  ELSE
    INSERT INTO subscriptions (owner_id, plan, status, current_period_end)
    SELECT user_id, COALESCE(plan_id,'free'), 'active',
           COALESCE(credits_reset_at, date_trunc('day', now()) + INTERVAL '1 month')
    FROM user_profiles
    ON CONFLICT (owner_id) DO NOTHING;
  END IF;
END $$;
