-- Mello persistent memory (agent-core rebuild, stage 1). Facts Mello learns about the user/brand/
-- goals so it carries context across conversations instead of starting cold each chat.
create table if not exists mello_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null default 'fact',   -- fact | preference | goal | brand
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_mello_memory_user on mello_memory (user_id, created_at desc);
-- one row per identical fact per user (the remember tool upserts)
create unique index if not exists uq_mello_memory on mello_memory (user_id, content);

grant all on mello_memory to service_role, authenticated;
