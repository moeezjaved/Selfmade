-- Faithful/Cinematic video-clone pricing: scene-by-scene clone + stitch, priced by scene count
-- (2-4 scenes). Pure data — reserve_credits() prices by action_type at runtime; the approve route
-- picks video_clone_x{n}[_fast] when mode='faithful'. Editable in the admin Credit Pricing page.
INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd) VALUES
  ('video_clone_x2',      'Video clone · faithful · 2 scenes', 750,  2.50),
  ('video_clone_x3',      'Video clone · faithful · 3 scenes', 1100, 3.75),
  ('video_clone_x4',      'Video clone · faithful · 4 scenes', 1450, 5.00),
  ('video_clone_x2_fast', 'Video clone · faithful fast · 2 scenes', 475, 1.25),
  ('video_clone_x3_fast', 'Video clone · faithful fast · 3 scenes', 690, 1.90),
  ('video_clone_x4_fast', 'Video clone · faithful fast · 4 scenes', 900, 2.50)
ON CONFLICT (action_type) DO UPDATE SET label = EXCLUDED.label;
