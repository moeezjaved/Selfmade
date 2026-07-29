-- 129: brand spy = 50 credits ($0.50). The credit_pricing row existed at 1000 ($10) but the route
-- never charged it (count-cap only). We now reserve/commit it in the brand-spy route, so correct the
-- price to $0.50 per Moeez. Also ensures the row exists + is active. Apply in Supabase SQL editor.
insert into public.credit_pricing (action_type, credits, is_active)
values ('brand_spy', 50, true)
on conflict (action_type) do update set credits = 50, is_active = true;
