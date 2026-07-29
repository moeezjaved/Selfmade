-- 128: track PayFast subscription renewal reminders so the cron doesn't email the same user daily.
-- Additive + nullable — existing rows untouched. Apply in Supabase SQL editor (instant).
alter table public.subscriptions add column if not exists payfast_renewal_notified_at timestamptz;
