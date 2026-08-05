-- Brand Guardian — remember each spied rival's last-seen price + offer so the next scan can flag a CHANGE
-- (a price drop or a new "free shipping" banner). Small additive table; the ad + Reddit watchers stay
-- stateless. No LLM, no paid API.
create table if not exists public.guardian_site_snapshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id text not null,
  website text,
  last_price text,
  last_offer text,
  updated_at timestamptz not null default now(),
  unique (user_id, page_id)
);
create index if not exists idx_guardian_site_user on public.guardian_site_snapshot (user_id);

alter table public.guardian_site_snapshot enable row level security;
drop policy if exists guardian_site_own on public.guardian_site_snapshot;
create policy guardian_site_own on public.guardian_site_snapshot for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.guardian_site_snapshot to service_role;
grant select, insert, update, delete on public.guardian_site_snapshot to authenticated;
