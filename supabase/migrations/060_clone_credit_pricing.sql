-- AI ad clone pricing. Standard = Nano Banana 2, Pro = Nano Banana Pro (premium quality → more
-- credits). Editable in the admin Credit Pricing page. reserve_credits() prices by action_type.
insert into credit_pricing (action_type, label, credits, is_active) values
  ('image_clone',     'AI ad clone (standard)', 5,  true),
  ('image_clone_pro', 'AI ad clone (Pro)',      10, true)
on conflict (action_type) do update set label = excluded.label, is_active = true;
