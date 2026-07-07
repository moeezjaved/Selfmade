-- 088_video_clone.sql — "Clone this ad as a video" feature.
--
-- Reuses the existing creative_generations async-job table (same pattern as the animate feature):
-- a row with type='video_clone', status='processing' is picked up by the droplet video-clone-worker,
-- which runs the pipeline (Gemini analyses the competitor video → gpt-4o writes a Seedance prompt +
-- script → fal.ai Seedance 2.0 reference-to-video generates → R2 → row marked done). We only add the
-- two columns that table doesn't already have, plus the billable action in credit_pricing.
--
-- Apply off-peak (schema reload → PostgREST) per the pause-before-DDL rule; crawl/E tolerate it but
-- keep the window short.

-- ── New columns on creative_generations ──────────────────────────────────────
-- source_video_url : the COMPETITOR ad's video (discovery_creatives.r2_url) fed to Seedance as the
--                    motion/pacing reference (video_urls[0]).
-- clone_meta       : everything the pipeline produces + needs, as JSON, so we don't sprout columns:
--                    { product_image_urls:[], beat_sheet:{}, transcript:'', seedance_prompt:'',
--                      script:'', fal_request_id:'', resolution:'720p', duration:10, aspect:'9:16',
--                      tier:'premium'|'fast', stage:'analyzing'|'generating' }
ALTER TABLE creative_generations ADD COLUMN IF NOT EXISTS source_video_url TEXT;
ALTER TABLE creative_generations ADD COLUMN IF NOT EXISTS clone_meta JSONB;

-- Worker poll index: the pipeline claims type='video_clone' + status='processing' rows oldest-first.
CREATE INDEX IF NOT EXISTS idx_cg_video_clone_queue
  ON creative_generations (created_at)
  WHERE type = 'video_clone' AND status = 'processing';

-- ── Billable action ──────────────────────────────────────────────────────────
-- Video clone is FAR more expensive than the other actions (real fal $ per generation: ~$2.70 for a
-- 15s 720p premium reference-to-video with the video-input discount, vs a near-free ffmpeg animate).
-- Price MUST cover that with margin. 150 is a PLACEHOLDER — tune it to the real credit→$ ratio + the
-- desired markup before launch (see [[project_business_strategy]] pricing).
INSERT INTO credit_pricing (action_type, label, credits, is_active) VALUES
  ('video_clone',      'Video clone — Seedance premium (competitor ad → your product)', 150, true),
  ('video_clone_fast', 'Video clone — Seedance fast (cheaper, quicker)',                90,  true)
ON CONFLICT (action_type) DO UPDATE
  SET label = excluded.label, credits = excluded.credits, is_active = true;

-- ── Grants (us-east lost default privileges on migrate — new columns are fine on an existing table,
-- but re-assert so PostgREST/service_role definitely sees them) ───────────────
GRANT ALL ON TABLE public.creative_generations TO anon, authenticated, service_role;
