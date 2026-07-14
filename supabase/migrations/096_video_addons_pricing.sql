-- Video add-on pricing (1 credit = 1¢, post-095). All three are high-margin "blades":
--   video_lang_extra    — extra language output of a faithful clone (transcreate + TTS + remux over
--                         the SAME rendered video ≈ $0.02 of cost) → $2/language.
--   video_endcard       — branded end-card appended (pure ffmpeg compose, ~$0) → $0.50.
--   video_hook_variants — 3 hook variants of a multi-clip render (re-renders ONLY scene/segment 1
--                         twice more ≈ 2 extra fal clips ≈ $4.2) → $8.
INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd, is_active) VALUES
  ('video_lang_extra',    'Video clone · extra language output', 200, 0.02, true),
  ('video_endcard',       'Video clone · branded end-card',       50, 0.00, true),
  ('video_hook_variants', 'Video clone · 3 hook variants',       800, 4.20, true)
ON CONFLICT (action_type) DO UPDATE SET credits=EXCLUDED.credits, label=EXCLUDED.label, est_cost_usd=EXCLUDED.est_cost_usd, is_active=true;
