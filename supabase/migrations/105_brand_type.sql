-- 2026-07-18: brand_type — a brand is either a PHYSICAL product (default, today's flow) or a
-- SERVICE / app / website (the creator talks about it; no physical product is ever rendered).
-- Set once when the brand is created; the remake wizards read it to pick the generation path.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS brand_type text NOT NULL DEFAULT 'physical'
  CHECK (brand_type IN ('physical', 'service'));
