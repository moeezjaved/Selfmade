-- Followed brands — powers the "Following" feed (ads from brands the user follows).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS followed_brands (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id    TEXT NOT NULL,
  brand_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_followed_brands_user ON followed_brands (user_id);
