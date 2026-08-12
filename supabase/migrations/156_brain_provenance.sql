-- Company Brain provenance + confirmation (addresses the 4 remaining risks). All additive; safe to run
-- after 154/155. Guards so it's idempotent and won't fail if a table/column is missing.

-- #2 · ID-level provenance: which memory rows an answer actually used.
do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'mello_answer_log') then
    alter table mello_answer_log add column if not exists memory_ids text[] default '{}';
  end if;
end $$;

-- #4 · ceo_preferences provenance + history (was overwrite-on-upsert with no source/when).
alter table ceo_preferences add column if not exists source text default 'inferred';       -- founder | inferred
alter table ceo_preferences add column if not exists confidence integer default 60;
alter table ceo_preferences add column if not exists created_at timestamptz default now();

create table if not exists ceo_preference_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         text not null,
  value       jsonb,
  source      text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ceo_pref_history_user_key on ceo_preference_history (user_id, key, created_at desc);
alter table ceo_preference_history enable row level security;

-- #5 · fact confirmation: extracted facts land as a status. 'active' = trusted (founder-stated),
-- 'proposed' = needs confirmation (observed/customer-derived), 'confirmed' = founder approved,
-- 'superseded' = replaced. NULL (legacy rows) is treated as active.
alter table mello_memory add column if not exists status text default 'active';
create index if not exists idx_mello_memory_status on mello_memory (user_id, status);
