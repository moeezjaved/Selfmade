-- Customer Employee — the founder's unified, priority-sorted inbox. Every message a customer sends on a
-- connected channel becomes a thread; Mello triages it (priority + intent) and DRAFTS a reply grounded
-- in the brand. Nothing sends on its own — the founder approves. This is the "ears + mouth" wedge: the
-- brain runs on the existing spine now, and lights up end-to-end once Unipile carries real IG/WhatsApp.
-- Apply ONLY with crawl+drain paused (a schema-cache reload under load can 503 the API for minutes).

create table if not exists public.customer_threads (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  brand_id         uuid references public.brands(id) on delete set null,
  channel          text not null default 'simulated',   -- whatsapp | instagram | messenger | email | simulated
  contact_ref      text,                                 -- the customer's handle / number / chat id
  contact_name     text,
  priority         text not null default 'low' check (priority in ('high','med','low')),
  intent           text,                                 -- shipping | refund | price | complaint | question | other
  status           text not null default 'open' check (status in ('open','replied','closed','skipped')),
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create table if not exists public.customer_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references public.customer_threads(id) on delete cascade,
  user_id          uuid not null,
  direction        text not null check (direction in ('in','out')),
  body             text not null,
  intent           text,
  priority         text,
  suggested_reply  text,                                 -- Mello's draft (inbound only) — never auto-sent
  status           text not null default 'pending'       -- pending | approved | sent | skipped (inbound); sent (outbound)
                     check (status in ('pending','approved','sent','skipped')),
  created_at       timestamptz not null default now()
);

create index if not exists idx_cthreads_user on public.customer_threads (user_id, priority, last_message_at desc);
create index if not exists idx_cmsgs_thread on public.customer_messages (thread_id, created_at);

alter table public.customer_threads enable row level security;
alter table public.customer_messages enable row level security;

-- Service role (app admin client) bypasses RLS + does its own user-scoping, like the rest of the app.
grant all on public.customer_threads to service_role;
grant all on public.customer_messages to service_role;
