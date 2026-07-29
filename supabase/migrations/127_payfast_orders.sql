-- 127: PayFast (Pakistan) orders — the pending-payment ledger the IPN callback reconciles against.
-- One row per checkout attempt, keyed by BASKET_ID (what we send PayFast and what comes back on the
-- IPN). The callback verifies the validation hash, then grants credits (topup) or the plan
-- (subscription) exactly once. instrument_token stores the recurring token for monthly re-charges.
-- Apply in the Supabase SQL editor (small DDL — instant).

create table if not exists public.payfast_orders (
  basket_id        text primary key,
  user_id          uuid not null,
  kind             text not null check (kind in ('topup','subscription')),
  ref              text,                       -- pack id (topup) or plan id (subscription)
  credits          integer,                    -- topup: credits to grant
  plan             text,                       -- subscription: plan id
  billing_cycle    text default 'monthly',
  amount           numeric(12,2) not null,     -- charged amount (PKR)
  currency         text not null default 'PKR',
  status           text not null default 'pending' check (status in ('pending','paid','failed')),
  transaction_id   text,                       -- PayFast transaction id (from IPN)
  instrument_token text,                       -- recurring token for future monthly charges
  err_code         text,
  raw              jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);

create index if not exists idx_payfast_orders_user on public.payfast_orders (user_id, created_at desc);

-- Subscriptions gains a provider + the PayFast recurring token (so a billing worker can re-charge
-- monthly). Nullable + defaulted → existing Stripe rows are untouched.
alter table public.subscriptions add column if not exists provider text default 'stripe';
alter table public.subscriptions add column if not exists payfast_instrument_token text;

-- Service-role only (the checkout route + IPN callback both run as service_role). No client access.
alter table public.payfast_orders enable row level security;
grant all on public.payfast_orders to service_role;
alter default privileges in schema public grant all on tables to service_role;
