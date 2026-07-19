-- Cutaway patch pricing: a 5s SILENT product close-up spliced over just the flawed seconds of a
-- finished video (voice untouched). fal cost ≈ $1.05 (5s at the silent rate) → 150 cr ($1.50) ≈ 30%
-- margin. Pure data insert — no schema change, no PostgREST reload.
insert into credit_pricing (action_type, label, credits, est_cost_usd, is_active) values
  ('video_tweak_patch', 'Video fix — patch seconds (cutaway)', 150, 1.05, true)
on conflict (action_type) do update set label = excluded.label, credits = excluded.credits, est_cost_usd = excluded.est_cost_usd, is_active = true;
