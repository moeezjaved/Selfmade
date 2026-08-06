-- Projects Phase 2 — scope the customer inbox to a brand, and remember which brand a connected customer
-- channel serves. A message that arrives on Aura's Instagram becomes an Aura thread; the inbox filters by
-- brand; replies ground on that brand's memory. Additive; null = unassigned (behaves account-wide).
alter table public.customer_threads   add column if not exists brand_id uuid;
alter table public.channel_identities  add column if not exists brand_id uuid;
create index if not exists idx_customer_threads_brand on public.customer_threads (user_id, brand_id);
create index if not exists idx_channel_identities_brand on public.channel_identities (user_id, brand_id);
