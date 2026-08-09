-- Per-brand notebook. mello_memory (the flat notebook / "what each department knows") never had a
-- brand dimension, so a multi-brand founder saw Aura's facts under Hair ResQ. addMemory() already tries
-- to write brand_id, but with no column the brand-tagged writes silently failed. Add the column + index;
-- reads scope to the active brand (this brand's rows + account-wide null rows). Legacy rows stay null
-- (account-wide) — no backfill, since guessing a brand for an old note is wrong more often than right.
alter table public.mello_memory add column if not exists brand_id uuid;
create index if not exists idx_mello_memory_brand on public.mello_memory (user_id, brand_id);
