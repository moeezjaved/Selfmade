-- Animate (Veo image-to-video) — async video jobs live in creative_generations with a status +
-- operation handle. Videos cost ~$0.80/clip (Veo 3.1 fast ~8s) so video_clone is repriced for margin.
ALTER TABLE creative_generations ALTER COLUMN image_url DROP NOT NULL;
ALTER TABLE creative_generations ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'done';   -- processing|done|failed
ALTER TABLE creative_generations ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image';  -- image|video
ALTER TABLE creative_generations ADD COLUMN IF NOT EXISTS operation  TEXT;   -- Veo long-running op name
ALTER TABLE creative_generations ADD COLUMN IF NOT EXISTS credit_tx  UUID;   -- reserved tx (commit on done / refund on fail)

update credit_pricing set label = 'Video clone (Veo, ~8s)', credits = 80, is_active = true where action_type = 'video_clone';
insert into credit_pricing (action_type, label, credits, is_active)
  values ('video_clone', 'Video clone (Veo, ~8s)', 80, true)
  on conflict (action_type) do update set label = excluded.label, credits = excluded.credits, is_active = true;
