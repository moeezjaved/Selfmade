-- Assets — user-uploaded media library (spec §10.3), org-shared, storage-capped by plan.assetsGb.
-- Upload surface (step 4). The AI layer (ai_caption + pgvector embedding + semantic search) is step 5.
create table if not exists assets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references organizations(id) not null,
  brand_id     uuid,                       -- optional per-brand grouping (loose ref; no FK)
  uploaded_by  uuid,
  file_url     text not null,              -- public R2 URL
  r2_key       text not null,              -- R2 object key (for HeadObject / delete)
  file_type    text,                       -- image | video | audio
  mime         text,
  file_name    text,
  size_bytes   bigint not null default 0,
  duration_sec numeric,
  width int, height int,
  tags         text[] not null default '{}',
  ai_caption   text,                       -- filled by the step-5 AI job
  status       text not null default 'ready',  -- ready | processing (AI) | error
  created_at   timestamptz not null default now()
);
create index if not exists idx_assets_org on assets(org_id);
create index if not exists idx_assets_org_brand on assets(org_id, brand_id);

grant all on assets to service_role, authenticated;
