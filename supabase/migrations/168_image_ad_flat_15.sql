-- Flatten the price of an image ad to a single, simple number: every image ad = 15 credits
-- ($0.15 @ 1cr=1¢), whichever engine made it. Before this, the AI Ad Studio "original ad"
-- (image_studio_pro) cost 100 while a clone (image_clone_pro) cost 15 — same output to the user,
-- wildly different price. The new media model is: image ad = 15 credits, HD (4K) = 25, full stop.
--
-- This is the authoritative cost — reserve_credits reads credit_pricing, not the app-layer
-- ACTION_COSTS map (which is updated to match in src/lib/plans.ts).

UPDATE credit_pricing SET credits = 15, est_cost_usd = 0.15 WHERE action_type = 'image_studio_pro';
UPDATE credit_pricing SET credits = 25, est_cost_usd = 0.25 WHERE action_type = 'image_studio_4k';
