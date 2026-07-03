-- Notification emails cost 2 credits each (opt-in premium alerts). reserve_credits() prices by
-- action_type, so these rows must exist for the alert/digest workers to charge. Editable later in
-- the admin Credit Pricing page.
insert into credit_pricing (action_type, label, credits, is_active) values
  ('email_alert',  'New-ad email alert',  2, true),
  ('email_digest', 'Weekly digest email', 2, true)
on conflict (action_type) do update set credits = excluded.credits, label = excluded.label, is_active = true;
