-- 144: PayPal orders — the pending-payment ledger the PayPal webhook (and top-up capture) reconcile
-- against. Mirrors payfast_orders (127) but in USD, and keyed by BASKET_ID which we send PayPal as
-- custom_id and read back on the webhook. Subscriptions grant on BILLING.SUBSCRIPTION.ACTIVATED;
-- top-ups grant on capture. Both are idempotent via status='paid'.
-- Apply in the Supabase SQL editor (small DDL — instant, no lock risk).

create table if not exists public.paypal_orders (
  basket_id        text primary key,
  user_id          uuid not null,
  kind             text not null check (kind in ('topup','subscription')),
  ref              text,                       -- pack id (topup) or plan id (subscription)
  credits          integer,                    -- topup: credits to grant
  plan             text,                       -- subscription: plan id
  billing_cycle    text default 'monthly',
  amount           numeric(12,2) not null,     -- charged amount (USD)
  currency         text not null default 'USD',
  status           text not null default 'pending' check (status in ('pending','paid','failed')),
  paypal_order_id       text,                  -- Orders API id (top-ups)
  paypal_subscription_id text,                 -- Subscriptions API id (I-xxxx)
  transaction_id   text,                       -- capture id / sale id from the webhook
  err_code         text,
  raw              jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);

create index if not exists idx_paypal_orders_user on public.paypal_orders (user_id, created_at desc);
create index if not exists idx_paypal_orders_sub  on public.paypal_orders (paypal_subscription_id);

-- Store the PayPal subscription id on the subscription row so renewals/cancellations can be matched.
-- Nullable → existing Stripe/PayFast rows are untouched. provider already exists (migration 127).
alter table public.subscriptions add column if not exists paypal_subscription_id text;

-- Service-role only (the checkout route + webhook both run as service_role). No client access.
alter table public.paypal_orders enable row level security;
grant all on public.paypal_orders to service_role;
alter default privileges in schema public grant all on tables to service_role;
