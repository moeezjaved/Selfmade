-- Pricing v2: video ads are a clean $6 per 15 seconds — no stitching surcharge. A 30s (2-segment)
-- video is exactly 2× a 15s, 60s (4-segment) is 4×. Was 100 + 600·n (x2=1300/$13, x4=2500/$25);
-- now 600·n (x2=1200/$12, x3=1800/$18, x4=2400/$24). Matches CloneVideoModal's faithfulCost() formula.
-- These rows price BOTH UGC length buckets (15/30/60 → x1/x2/x4) and faithful per-scene clones.
UPDATE credit_pricing SET credits = 1200, est_cost_usd = 6.30  WHERE action_type = 'video_clone_x2';
UPDATE credit_pricing SET credits = 1800, est_cost_usd = 9.45  WHERE action_type = 'video_clone_x3';
UPDATE credit_pricing SET credits = 2400, est_cost_usd = 12.60 WHERE action_type = 'video_clone_x4';
