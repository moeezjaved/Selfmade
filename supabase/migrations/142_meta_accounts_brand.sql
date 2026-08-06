-- Projects Phase 1 — link each Meta ad account to a brand (the "project"), so picking a brand on the
-- brief shows THAT brand's Facebook numbers instead of always the primary account. Additive; when
-- brand_id is null the account behaves as before (resolved by is_primary). Assigned from the FB card.
alter table public.meta_accounts add column if not exists brand_id uuid;
create index if not exists idx_meta_accounts_brand on public.meta_accounts (user_id, brand_id);
