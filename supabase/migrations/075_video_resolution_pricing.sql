-- Animate resolutions the user selects (Veo 3.1 fast): 1080p (~$0.96/clip) and 4K (~$2.40/clip).
-- Priced to keep the same cost→credit ratio as image clones (2K image 15cr / $0.13 ≈ 115 cr/$1).
update credit_pricing set label = 'Video clone (1080p, ~8s)', credits = 100, is_active = true where action_type = 'video_clone';
insert into credit_pricing (action_type, label, credits, is_active) values
  ('video_clone',    'Video clone (1080p, ~8s)', 100, true),
  ('video_clone_4k', 'Video clone (4K, ~8s)',    240, true)
on conflict (action_type) do update set label = excluded.label, credits = excluded.credits, is_active = true;
