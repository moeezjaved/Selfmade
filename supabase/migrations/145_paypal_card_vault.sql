-- 145: PayPal Advanced Card Payments (ACDC) — store the vaulted card so we can auto-charge the
-- subscription each month (card-only recurring, no PayPal account needed). The card itself is never
-- stored here or anywhere on our side — only PayPal's vault token + display bits (brand + last4).
-- Apply in the Supabase SQL editor (small DDL — instant).

alter table public.subscriptions add column if not exists paypal_vault_id text;        -- saved-card token
alter table public.subscriptions add column if not exists paypal_customer_id text;      -- PayPal vault customer id
alter table public.subscriptions add column if not exists card_brand text;              -- VISA / MASTERCARD (display)
alter table public.subscriptions add column if not exists card_last4 text;              -- last 4 digits (display)

alter table public.paypal_orders add column if not exists paypal_vault_id text;
alter table public.paypal_orders add column if not exists card_brand text;
alter table public.paypal_orders add column if not exists card_last4 text;

-- The daily renewal cron finds card subscriptions to auto-charge via this index.
create index if not exists idx_subscriptions_paypal_vault on public.subscriptions (paypal_vault_id) where paypal_vault_id is not null;
