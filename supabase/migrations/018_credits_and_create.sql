-- Credits + Create pillar: tiered plans, credit ledger, pricing config, brand
-- catalog, Scripts, and Clone job tables. Credits hang off auth.users(id) — the
-- identity the app authenticates with (user_profiles.user_id).
--
-- ATOMICITY: reserve/commit/refund are plpgsql functions (not app-side), because
-- PostgREST can't do SELECT … FOR UPDATE. The functions lock the profile row in a
-- single transaction, so concurrent actions can never double-spend a balance.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Plans (tiered) ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id                  TEXT PRIMARY KEY,            -- 'trial','core','plus','business'
  name                TEXT NOT NULL,
  price_monthly_cents INT  NOT NULL,
  monthly_credits     INT  NOT NULL,
  seats               INT  NOT NULL DEFAULT 1,
  stripe_price_id     TEXT,                        -- maps the existing Stripe subscription
  is_active           BOOLEAN DEFAULT TRUE,
  sort_order          INT DEFAULT 0
);

-- ── Per-action pricing (admin-editable, no deploy needed) ────────────────────
CREATE TABLE IF NOT EXISTS credit_pricing (
  action_type   TEXT PRIMARY KEY,
  label         TEXT,
  credits       INT NOT NULL,
  est_cost_usd  NUMERIC(10,4),                     -- internal margin tracking
  is_active     BOOLEAN DEFAULT TRUE,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Top-up packs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_packs (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  credits     INT NOT NULL,
  price_cents INT NOT NULL,
  stripe_price_id TEXT,
  is_active   BOOLEAN DEFAULT TRUE
);

-- ── Credit balance on the billing owner (user_profiles) ──────────────────────
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS plan_id          TEXT REFERENCES plans(id) DEFAULT 'trial';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS credits_balance  INT NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS credits_reset_at TIMESTAMPTZ;

-- ── Immutable ledger ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL,                     -- action OR 'monthly_reset','topup','refund'
  delta         INT NOT NULL,                      -- negative = spend, positive = grant/refund
  balance_after INT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'committed', -- 'reserved'|'committed'|'refunded'
  reference_id  TEXT,                              -- ad_id, clone_job_id, tx id, etc.
  metadata      JSONB,                             -- {model, tokens, variations, actual_cost_usd}
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions (user_id, created_at DESC);

-- ── Brand profile + product catalog (Clone inputs) ──────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL, website TEXT,
  industry        TEXT[], description TEXT, usps TEXT[],
  target_audience TEXT, tone TEXT,
  preferred_words TEXT[], avoid_words TEXT[],
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brands_user ON brands (user_id);

CREATE TABLE IF NOT EXISTS brand_assets (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id  UUID REFERENCES brands(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,                         -- 'logo'|'color'|'font'|'product_image'
  value     TEXT,                                  -- hex | font name | r2_url
  is_default BOOLEAN DEFAULT FALSE, meta JSONB
);
CREATE INDEX IF NOT EXISTS idx_brand_assets_brand ON brand_assets (brand_id);

CREATE TABLE IF NOT EXISTS brand_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID REFERENCES brands(id) ON DELETE CASCADE,
  name        TEXT, description TEXT, price TEXT,
  image_urls  TEXT[],                              -- REAL product photos (r2)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brand_products_brand ON brand_products (brand_id);

-- ── Clone jobs/outputs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clone_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id            UUID, product_id UUID,
  reference_image_url TEXT, layout_spec JSONB,
  status              TEXT DEFAULT 'processing',   -- processing|done|failed
  error               TEXT,
  credit_tx_id        UUID, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clone_jobs_user ON clone_jobs (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS clone_outputs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID REFERENCES clone_jobs(id) ON DELETE CASCADE,
  r2_url     TEXT, variation INT, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scripts ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_scripts (
  ad_id      TEXT PRIMARY KEY,
  transcript JSONB,                                -- [{t, text}]
  framework  TEXT, hooks TEXT[], strategies TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS generated_scripts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  source_ad_id TEXT, brand_id UUID,
  framework    TEXT, script TEXT, brief JSONB,
  credit_tx_id UUID, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_generated_scripts_user ON generated_scripts (user_id, created_at DESC);

-- ── Atomic credit functions (the heart of the system) ───────────────────────
CREATE OR REPLACE FUNCTION ensure_monthly_reset(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_profile user_profiles; v_credits INT;
BEGIN
  SELECT * INTO v_profile FROM user_profiles WHERE user_id = p_user FOR UPDATE;
  IF v_profile IS NULL THEN RETURN; END IF;
  IF v_profile.credits_reset_at IS NOT NULL AND NOW() >= v_profile.credits_reset_at THEN
    SELECT monthly_credits INTO v_credits FROM plans WHERE id = COALESCE(v_profile.plan_id, 'trial');
    v_credits := COALESCE(v_credits, 0);
    UPDATE user_profiles
      SET credits_balance = v_credits,
          credits_reset_at = date_trunc('day', NOW()) + INTERVAL '1 month'
      WHERE user_id = p_user;
    INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status)
      VALUES (p_user, 'monthly_reset', v_credits, v_credits, 'committed');
  END IF;
END; $$;

-- Reserve BEFORE the model call. Locks the profile row → no double-spend race.
-- Raises 'insufficient_credits' (P0002) or 'unknown_action' (P0001).
CREATE OR REPLACE FUNCTION reserve_credits(p_user UUID, p_action TEXT, p_ref TEXT DEFAULT NULL)
RETURNS credit_transactions LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_price INT; v_profile user_profiles; v_balance_after INT; v_tx credit_transactions;
BEGIN
  PERFORM ensure_monthly_reset(p_user);
  SELECT credits INTO v_price FROM credit_pricing WHERE action_type = p_action AND is_active = TRUE;
  IF v_price IS NULL THEN RAISE EXCEPTION 'unknown_action:%', p_action USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM user_profiles WHERE user_id = p_user FOR UPDATE;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_profile' USING ERRCODE='P0001'; END IF;
  IF v_profile.credits_balance < v_price THEN
    RAISE EXCEPTION 'insufficient_credits:need=%,have=%', v_price, v_profile.credits_balance USING ERRCODE='P0002';
  END IF;
  v_balance_after := v_profile.credits_balance - v_price;
  UPDATE user_profiles SET credits_balance = v_balance_after WHERE user_id = p_user;
  INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, reference_id)
    VALUES (p_user, p_action, -v_price, v_balance_after, 'reserved', p_ref)
    RETURNING * INTO v_tx;
  RETURN v_tx;
END; $$;

CREATE OR REPLACE FUNCTION commit_credits(p_tx UUID, p_metadata JSONB DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE credit_transactions SET status='committed', metadata = COALESCE(p_metadata, '{}'::jsonb)
    WHERE id = p_tx AND status = 'reserved';
END; $$;

-- Idempotent refund — only a still-'reserved' tx is refunded; re-calls are no-ops.
CREATE OR REPLACE FUNCTION refund_credits(p_tx UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_tx credit_transactions; v_balance_after INT;
BEGIN
  SELECT * INTO v_tx FROM credit_transactions WHERE id = p_tx FOR UPDATE;
  IF v_tx IS NULL OR v_tx.status <> 'reserved' THEN RETURN; END IF;
  UPDATE user_profiles SET credits_balance = credits_balance + (-v_tx.delta)
    WHERE user_id = v_tx.user_id RETURNING credits_balance INTO v_balance_after;
  UPDATE credit_transactions SET status='refunded' WHERE id = p_tx;
  INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, reference_id)
    VALUES (v_tx.user_id, 'refund', -v_tx.delta, v_balance_after, 'committed', p_tx::text);
END; $$;

-- Grant top-up credits (after a Stripe pack purchase). Additive, never resets.
CREATE OR REPLACE FUNCTION grant_credits(p_user UUID, p_credits INT, p_ref TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_balance_after INT;
BEGIN
  UPDATE user_profiles SET credits_balance = credits_balance + p_credits
    WHERE user_id = p_user RETURNING credits_balance INTO v_balance_after;
  INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, reference_id)
    VALUES (p_user, 'topup', p_credits, v_balance_after, 'committed', p_ref);
END; $$;

-- ── Seeds (all editable in admin) ────────────────────────────────────────────
INSERT INTO plans (id, name, price_monthly_cents, monthly_credits, seats, sort_order) VALUES
  ('trial',    'Trial',     0,     100,   1, 0),
  ('core',     'Core',      12900, 4000,  1, 1),
  ('plus',     'Plus',      24900, 10000, 3, 2),
  ('business', 'Business',  49900, 25000, 10, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd) VALUES
  ('transcribe',       'Transcribe ad video',        2,  0.006),
  ('script_generate',  'Generate script',            5,  0.003),
  ('script_duplicate', 'Duplicate script',           5,  0.003),
  ('brand_analysis',   'Brand analysis (URL→brief)', 8,  0.010),
  ('review_mining',    'Review mining (CSV)',        10, 0.020),
  ('image_clone',      'Image clone (4 variations)', 15, 0.140)
ON CONFLICT (action_type) DO NOTHING;

INSERT INTO credit_packs (id, name, credits, price_cents) VALUES
  ('pack_1000', '1,000 credits', 1000, 3900),
  ('pack_3000', '3,000 credits', 3000, 9900),
  ('pack_8000', '8,000 credits', 8000, 22900)
ON CONFLICT (id) DO NOTHING;

-- Give existing users a starting trial balance so the UI isn't empty on first load.
UPDATE user_profiles SET credits_balance = 100, plan_id = COALESCE(plan_id, 'trial'),
  credits_reset_at = COALESCE(credits_reset_at, date_trunc('day', NOW()) + INTERVAL '1 month')
  WHERE credits_balance = 0;
