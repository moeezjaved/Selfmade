-- Iterative ad edit — after cloning, each "make the headline bigger / change bg to white / brighter"
-- tweak re-runs Nano Banana on the current image and costs credits. Cheaper than a full clone since
-- it edits one image (no product compositing). Editable in the admin Credit Pricing page.
insert into credit_pricing (action_type, label, credits, is_active) values
  ('image_edit',     'AI ad edit (standard)', 2, true),
  ('image_edit_pro', 'AI ad edit (Pro)',      4, true)
on conflict (action_type) do update set label = excluded.label, is_active = true;
