-- "Just animation" via droplet FFmpeg (Ken Burns zoom / shine sweep) — short MP4s that keep the ad
-- exact. Near-zero compute cost, so priced low. The animate-worker on the droplet renders jobs.
ALTER TABLE creative_generations ADD COLUMN IF NOT EXISTS source_image_url TEXT;

insert into credit_pricing (action_type, label, credits, is_active) values
  ('animate_motion',    'Animate (motion, 1080p)', 15, true),
  ('animate_motion_4k', 'Animate (motion, 4K)',    25, true)
on conflict (action_type) do update set label = excluded.label, credits = excluded.credits, is_active = true;

-- Retire the Veo video_clone actions from the UI (kept in table, deactivated).
update credit_pricing set is_active = false where action_type in ('video_clone', 'video_clone_4k');
