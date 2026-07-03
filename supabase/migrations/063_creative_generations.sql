-- Every AI creative the user makes — clones, edits, and research-generated ("inspired") ads — is
-- persisted here so "My Creatives" can show a gallery they can revisit, re-edit, and download.
-- The generated image is stored in R2 (image_url); edits point at their source via parent_id.
CREATE TABLE IF NOT EXISTS creative_generations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id     UUID REFERENCES brands(id) ON DELETE SET NULL,
  source_ad_id TEXT,                                  -- discovery ad this was cloned from
  parent_id    UUID REFERENCES creative_generations(id) ON DELETE SET NULL,  -- edit lineage
  type         TEXT NOT NULL DEFAULT 'clone',         -- 'clone' | 'edit' | 'inspired'
  tier         TEXT NOT NULL DEFAULT 'default',       -- 'default' | 'pro'
  prompt       TEXT,                                  -- headline / edit instruction / brief
  image_url    TEXT NOT NULL,                         -- public R2 URL
  width        INT,
  height       INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creative_generations_user_idx ON creative_generations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_generations_brand_idx ON creative_generations (brand_id) WHERE brand_id IS NOT NULL;

ALTER TABLE creative_generations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS creative_generations_owner ON creative_generations;
CREATE POLICY creative_generations_owner ON creative_generations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
