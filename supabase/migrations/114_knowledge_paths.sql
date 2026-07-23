-- 114: knowledge_paths — the INVISIBLE Trail.
-- Records how readers actually traverse the knowledge graph (Edition → object → object)
-- so the visible Trail UI ships only when measured depth proves people browse deep.
-- One row per browsing session, upserted on every hop. Service-role only.

create table if not exists knowledge_paths (
  session_key text primary key,
  user_id     uuid,                                -- null = anonymous public reader
  path        jsonb not null default '[]'::jsonb,  -- e.g. ["edition","brand:263814699291","ad:123..."]
  depth       int not null default 0,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists knowledge_paths_depth_idx on knowledge_paths (depth desc, updated_at desc);
create index if not exists knowledge_paths_user_idx  on knowledge_paths (user_id) where user_id is not null;

alter table knowledge_paths enable row level security;   -- no policies: service-role only
revoke all on knowledge_paths from anon, authenticated;
grant all on knowledge_paths to service_role;
