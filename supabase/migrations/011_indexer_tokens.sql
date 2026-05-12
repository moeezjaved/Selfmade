-- Indexer Token Pool (Crawler Infrastructure)
--
-- ARCHITECTURE NOTE: This table is intentionally SEPARATE from meta_accounts.
-- meta_accounts holds tokens for paying users to manage their own ads. This
-- table holds tokens used solely by our internal crawler/indexer infrastructure.
-- They never cross paths in code:
--   - User-facing routes query meta_accounts (filtered by user_id)
--   - Indexer queries indexer_tokens
--
-- Tokens are added manually by admin via /admin/tokens UI (paste a token from
-- Facebook Graph API Explorer). No OAuth flow involvement, so this never
-- touches user authentication code.

CREATE TABLE IF NOT EXISTS indexer_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Human label so admin can tell tokens apart ("Tahir's FB", "My alt account")
  label           TEXT NOT NULL,
  -- AES-256 encrypted long-lived (60-day) Meta user access token
  access_token    TEXT NOT NULL,
  -- Optional metadata captured from /me on token validation
  fb_user_id      TEXT,
  fb_user_name    TEXT,
  -- When the FB token expires (typically now() + 60 days). Admin UI warns when close.
  expires_at      TIMESTAMPTZ,
  -- Set when Meta returns #613. While now() < cooldown_until, picker skips this row.
  cooldown_until  TIMESTAMPTZ,
  -- Updated on every successful API call. Picker uses oldest first → round-robin.
  last_used_at    TIMESTAMPTZ,
  -- Lifetime call counter (informational).
  total_calls     BIGINT DEFAULT 0,
  -- Soft-disable without deleting (e.g., token compromised, paused, etc.)
  is_active       BOOLEAN DEFAULT TRUE,
  -- Audit trail
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Picker query: WHERE is_active=true AND (cooldown_until IS NULL OR cooldown_until<now())
-- ORDER BY last_used_at ASC NULLS FIRST LIMIT 1
CREATE INDEX IF NOT EXISTS idx_indexer_tokens_picker
  ON indexer_tokens(is_active, cooldown_until, last_used_at)
  WHERE is_active = TRUE;
