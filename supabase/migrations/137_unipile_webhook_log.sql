-- TEMP diagnostic: capture raw inbound Unipile webhook payloads so we can see the real message shape
-- (why a live Instagram DM isn't landing in the inbox). Safe to drop once inbound is verified.
create table if not exists public.unipile_webhook_log (
  id         uuid primary key default gen_random_uuid(),
  kind       text,                 -- 'messaging' | 'mail'
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_unipile_webhook_log_created on public.unipile_webhook_log (created_at desc);
grant all on public.unipile_webhook_log to service_role;
