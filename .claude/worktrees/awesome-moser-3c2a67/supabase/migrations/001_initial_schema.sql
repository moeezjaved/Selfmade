-- ============================================================
-- SELFMADE DATABASE SCHEMA
-- Run: supabase db push
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USER PROFILES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name               TEXT,
  business_type           TEXT CHECK (business_type IN ('ecommerce','saas','leadgen','service','solo','other')),
  niche                   TEXT,
  monthly_ad_spend        TEXT,
  experience_level        TEXT CHECK (experience_level IN ('beginner','intermediate','advanced','expert')) DEFAULT 'beginner',
  onboarding_completed    BOOLEAN DEFAULT FALSE,
  -- Stripe
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT,
  subscription_status     TEXT DEFAULT 'trialing' CHECK (subscription_status IN ('trialing','active','canceled','past_due','incomplete')),
  trial_ends_at           TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  -- Prefs
  timezone                TEXT DEFAULT 'America/New_York',
  currency                TEXT DEFAULT 'USD',
  notification_prefs      JSONB DEFAULT '{"email_recommendations":true,"email_digest":true,"email_alerts":true,"inapp_recommendations":true}',
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── META ACCOUNTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id      TEXT NOT NULL,        -- act_xxxxx
  account_name    TEXT NOT NULL,
  access_token    TEXT NOT NULL,        -- AES-256 encrypted
  token_expires_at TIMESTAMPTZ,
  page_id         TEXT,                 -- Facebook Page ID for ad creatives
  currency        TEXT DEFAULT 'USD',
  timezone        TEXT DEFAULT 'America/New_York',
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','disconnected','error')),
  is_primary      BOOLEAN DEFAULT TRUE,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account_id)
);

-- ── CAMPAIGNS (cached from Meta) ──────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_account_id     UUID NOT NULL REFERENCES meta_accounts(id) ON DELETE CASCADE,
  meta_campaign_id    TEXT NOT NULL,
  name                TEXT NOT NULL,
  objective           TEXT,
  status              TEXT DEFAULT 'ACTIVE',
  daily_budget        DECIMAL(12,2),
  lifetime_budget     DECIMAL(12,2),
  start_time          TIMESTAMPTZ,
  stop_time           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meta_account_id, meta_campaign_id)
);

-- ── AD SETS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_sets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id         UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  meta_adset_id       TEXT NOT NULL,
  name                TEXT NOT NULL,
  status              TEXT DEFAULT 'ACTIVE',
  daily_budget        DECIMAL(12,2),
  targeting           JSONB DEFAULT '{}',
  optimization_goal   TEXT,
  billing_event       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, meta_adset_id)
);

-- ── ADS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ad_set_id       UUID NOT NULL REFERENCES ad_sets(id) ON DELETE CASCADE,
  meta_ad_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  status          TEXT DEFAULT 'ACTIVE',
  creative        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ad_set_id, meta_ad_id)
);

-- ── CAMPAIGN INSIGHTS (time-series) ───────────────────────────
CREATE TABLE IF NOT EXISTS campaign_insights (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id         UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date_start          DATE NOT NULL,
  date_stop           DATE NOT NULL,
  spend               DECIMAL(12,2) DEFAULT 0,
  impressions         INTEGER DEFAULT 0,
  clicks              INTEGER DEFAULT 0,
  ctr                 DECIMAL(8,4) DEFAULT 0,
  cpm                 DECIMAL(10,2) DEFAULT 0,
  cpc                 DECIMAL(10,2) DEFAULT 0,
  conversions         INTEGER DEFAULT 0,
  conversion_value    DECIMAL(12,2) DEFAULT 0,
  roas                DECIMAL(8,4) DEFAULT 0,
  cpa                 DECIMAL(10,2) DEFAULT 0,
  reach               INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, date_start, date_stop)
);

-- ── RECOMMENDATIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_account_id     UUID REFERENCES meta_accounts(id),
  campaign_id         UUID REFERENCES campaigns(id),
  ad_set_id           UUID REFERENCES ad_sets(id),
  ad_id               UUID REFERENCES ads(id),
  type                TEXT NOT NULL,
  title               TEXT NOT NULL,
  reasoning           TEXT NOT NULL,
  impact_estimate     TEXT,
  confidence_score    INTEGER DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
  status              TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXECUTED','FAILED')),
  meta_action         JSONB,             -- payload to send to Meta API
  executed_at         TIMESTAMPTZ,
  execution_result    JSONB,
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── ACTIVITY LOG ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_account_id     UUID REFERENCES meta_accounts(id),
  action_type         TEXT NOT NULL,
  entity_type         TEXT,
  entity_id           TEXT,
  entity_name         TEXT,
  description         TEXT NOT NULL,
  meta_api_response   JSONB,
  performed_by        TEXT DEFAULT 'user' CHECK (performed_by IN ('user','system')),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── CAMPAIGN DRAFTS (Ad Engine) ────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_drafts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_account_id     UUID REFERENCES meta_accounts(id),
  user_type           TEXT CHECK (user_type IN ('first_timer','experienced')),
  objective           TEXT,
  campaign_name       TEXT,
  landing_url         TEXT,
  targeting           JSONB DEFAULT '{}',
  budget              JSONB DEFAULT '{}',
  placements          TEXT[] DEFAULT '{}',
  creative            JSONB DEFAULT '{}',
  ai_strategy         JSONB,
  status              TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','launched','failed')),
  meta_campaign_id    TEXT,
  meta_adset_id       TEXT,
  meta_ad_id          TEXT,
  launched_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── CREATIVE ANALYSES (Creative Studio) ───────────────────────
CREATE TABLE IF NOT EXISTS creative_analyses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_ad_id          TEXT,
  product             TEXT,
  winning_analysis    JSONB NOT NULL,
  competitor_analysis JSONB NOT NULL,
  strategy            JSONB NOT NULL,
  variations          JSONB NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id  TEXT UNIQUE NOT NULL,
  stripe_price_id         TEXT NOT NULL,
  status                  TEXT NOT NULL,
  plan                    TEXT CHECK (plan IN ('monthly','annual')) DEFAULT 'monthly',
  amount                  INTEGER NOT NULL,
  currency                TEXT DEFAULT 'usd',
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN DEFAULT FALSE,
  trial_start             TIMESTAMPTZ,
  trial_end               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_recommendations_user_status ON recommendations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_recommendations_created ON recommendations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_campaign ON campaign_insights(campaign_id, date_start DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON campaign_drafts(user_id, created_at DESC);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────
ALTER TABLE user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_sets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads                ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_insights  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_drafts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_analyses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions      ENABLE ROW LEVEL SECURITY;

-- Policies: users can only see their own data
CREATE POLICY "Users own their profiles" ON user_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their meta accounts" ON meta_accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their campaigns" ON campaigns FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their recommendations" ON recommendations FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their activity" ON activity_logs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their drafts" ON campaign_drafts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their creative analyses" ON creative_analyses FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their subscriptions" ON subscriptions FOR ALL USING (auth.uid() = user_id);

-- Ad sets: access through campaigns
CREATE POLICY "Users own ad sets via campaigns" ON ad_sets FOR ALL USING (
  EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = ad_sets.campaign_id AND campaigns.user_id = auth.uid())
);

-- Insights: access through campaigns
CREATE POLICY "Users own insights via campaigns" ON campaign_insights FOR ALL USING (
  EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_insights.campaign_id AND campaigns.user_id = auth.uid())
);

-- ── TRIGGERS ──────────────────────────────────────────────────
-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_meta_accounts_updated_at BEFORE UPDATE ON meta_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recommendations_updated_at BEFORE UPDATE ON recommendations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_drafts_updated_at BEFORE UPDATE ON campaign_drafts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
