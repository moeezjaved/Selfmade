-- Double opt-in + lifecycle-email bookkeeping.
--  email_confirmed_at   → set when the user clicks "Confirm your email" (marketing emails gate on this)
--  email_confirm_token  → the per-user token embedded in the confirm link
--  first_brand_email_at / first_ad_email_at → claim-once stamps so lifecycle emails send exactly once
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_confirmed_at   TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_confirm_token  TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS first_brand_email_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS first_ad_email_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS user_profiles_confirm_token_idx
  ON user_profiles (email_confirm_token) WHERE email_confirm_token IS NOT NULL;
