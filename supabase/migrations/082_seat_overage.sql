-- Paid seat overage (Seats Stage 2, final piece).
-- Extra seats bought beyond the plan's included count. The seat add-on is its OWN Stripe subscription
-- (a per-seat recurring price, quantity = extra_seats) so it's independent of the base plan.
--   effective seat limit = includedSeats(plan) + extra_seats
alter table subscriptions add column if not exists extra_seats int not null default 0;
alter table subscriptions add column if not exists seats_subscription_id text;
