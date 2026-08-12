-- Mello observability: one row per answer so we can always reconstruct "why did Mello say this?".
-- Written best-effort by src/lib/mello/observe.ts (fire-and-forget; the product never depends on it).
create table if not exists mello_answer_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  brand_id    uuid,
  surface     text,                         -- brief | mello | slack | whatsapp | studio
  question    text,
  intent      text,                         -- product_help | ads_metric | competitor | company_memory | creative | general
  path        text,                         -- grounded:<intent> | agent | item_reflect
  sources     text[] default '{}',          -- e.g. {"Meta Ads audit"} | {"Company Brain"}
  ms          integer,
  created_at  timestamptz not null default now()
);

create index if not exists idx_mello_answer_log_user_time on mello_answer_log (user_id, created_at desc);

alter table mello_answer_log enable row level security;
-- Service-role only (server writes via admin client); no client policies needed.
