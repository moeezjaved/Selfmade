-- Two-bucket credit wallet + subscriptions + top-up purchases (pricing spec §2, §5, §6).
-- credits_balance on user_profiles is KEPT as a mirror of (plan+topup) so every existing reader stays
-- correct; credit_wallets holds the split. Existing balances backfill into the plan bucket.

CREATE TABLE IF NOT EXISTS credit_wallets (
  owner_id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_credits_balance   INT NOT NULL DEFAULT 0,
  topup_credits_balance  INT NOT NULL DEFAULT 0,
  plan_credits_reset_at  TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL DEFAULT 'free',
  billing_cycle          TEXT DEFAULT 'monthly',            -- monthly|annual
  status                 TEXT DEFAULT 'active',             -- active|trialing|past_due|suspended|canceled
  seats_used             INT DEFAULT 1,
  trial_end              TIMESTAMPTZ,
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  scheduled_plan         TEXT,                              -- pending downgrade target (applied at period end)
  monthly_credits_override INT,                             -- enterprise custom
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_owner_idx ON subscriptions (owner_id);

CREATE TABLE IF NOT EXISTS topup_purchases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits           INT NOT NULL,
  credits_remaining INT NOT NULL,
  amount_usd        NUMERIC NOT NULL,
  stripe_payment_id TEXT,
  expires_at        TIMESTAMPTZ NOT NULL,                  -- purchase + 12 months
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topup_purchases_active_idx ON topup_purchases (owner_id, expires_at) WHERE credits_remaining > 0;

-- Ledger gets a bucket tag so we know which bucket each movement hit (for bucket-correct refunds).
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS bucket TEXT;

-- Auto-refill rule (opt-in, spec §3.2) — kept on the wallet's owner.
ALTER TABLE credit_wallets ADD COLUMN IF NOT EXISTS autorefill_threshold INT;   -- trigger when total <=
ALTER TABLE credit_wallets ADD COLUMN IF NOT EXISTS autorefill_pack TEXT;       -- pack id to buy

-- Grants for the API roles (avoid the "permission denied" class of bug).
GRANT ALL ON TABLE public.credit_wallets, public.subscriptions, public.topup_purchases
  TO anon, authenticated, service_role;

-- Backfill: one wallet per existing profile, current balance → plan bucket.
INSERT INTO credit_wallets (owner_id, plan_credits_balance, topup_credits_balance, plan_credits_reset_at)
SELECT user_id, COALESCE(credits_balance, 0), 0, credits_reset_at FROM user_profiles
ON CONFLICT (owner_id) DO NOTHING;

-- Seed a subscription row per user matching their current plan (idempotent).
INSERT INTO subscriptions (owner_id, plan, status, current_period_end)
SELECT user_id, COALESCE(plan_id, 'free'), 'active',
       COALESCE(credits_reset_at, date_trunc('day', now()) + INTERVAL '1 month')
FROM user_profiles
ON CONFLICT (owner_id) DO NOTHING;
