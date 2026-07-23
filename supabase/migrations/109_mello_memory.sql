-- 109_mello_memory.sql — extend Mello's memory into the NOTEBOOK (long-term memory ledger).
-- The table already exists (agent-core: user_id/kind/content, upsert-deduped on (user_id,content),
-- read into the agent's system prompt every turn). The hiring interview + standup now write here too,
-- so everything learned on day one is instantly citable in conversation ("as you told me…").
-- Additive ALTERs only — the agent's existing reads/writes keep working untouched.

alter table mello_memory add column if not exists brand_id   uuid;                                -- which brand the note concerns (null = account-wide)
alter table mello_memory add column if not exists source     text not null default 'chat';        -- chat | interview | standup | correction | system
alter table mello_memory add column if not exists retired_at timestamptz;                         -- a rule the user later reversed (kept, never deleted — memory is honest)

create index if not exists mello_memory_brand_idx on mello_memory (brand_id) where brand_id is not null;

-- (RLS owner policy + service_role grants already exist from the original table; re-assert grants
-- for safety on us-east's dropped default privileges.)
grant select, insert, update, delete on mello_memory to authenticated;
grant all on mello_memory to service_role;

-- drop the duplicate index the first (pre-inspection) run of this migration created
drop index if exists mello_memory_user_idx;
