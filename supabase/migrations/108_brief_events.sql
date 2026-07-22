-- 108_brief_events.sql — the Morning Brief spine ("one notification spine" from the retention plan).
-- Every pipeline that learns something a user should hear about writes ONE row here (competitor ad
-- drops, autopilot creatives ready, trend deltas, perf alerts once Meta is back). The Morning Brief
-- page/API is just `select … order by importance desc` rendered in Mello's voice; the daily digest
-- email becomes a second rendering of the same rows. Additive; nothing existing changes.

create table if not exists brief_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,                 -- who this item is FOR
  brand_id    uuid,                          -- the user's brand it concerns (nullable: account-wide)
  kind        text not null,                 -- 'competitor_ads' | 'creative_ready' | 'trend' | 'insight' | 'perf_alert' | 'system'
  importance  int  not null default 50,      -- 0-100; Mello decides what deserves attention first
  title       text not null,                 -- one-line, Mello-voiced ("Gymshark launched 5 new ads")
  body        text,                          -- optional detail paragraph
  payload     jsonb not null default '{}',   -- receipts: ad ids, page ids, urls, counts, deltas
  cta_label   text,                          -- e.g. 'Review the ads' / 'Approve'
  cta_href    text,                          -- in-app link the CTA opens
  surfaced_at timestamptz,                   -- when the Brief actually showed it (null = not yet)
  acted_on    boolean not null default false,-- user clicked/approved/dismissed
  created_at  timestamptz not null default now()
);

-- The Brief reads "this user's recent items, heaviest first" — one composite index serves it.
create index if not exists brief_events_user_idx on brief_events (user_id, created_at desc);
create index if not exists brief_events_rank_idx on brief_events (user_id, importance desc, created_at desc);
-- Writers dedupe per day per kind/brand (e.g. don't re-announce the same competitor drop twice).
create index if not exists brief_events_dedupe_idx on brief_events (user_id, kind, ((payload->>'dedupe_key')));

alter table brief_events enable row level security;
drop policy if exists brief_events_owner on brief_events;
create policy brief_events_owner on brief_events
  for select using (auth.uid() = user_id);
-- updates (acted_on) go through the API with the user's session; inserts come from service_role writers.
drop policy if exists brief_events_owner_update on brief_events;
create policy brief_events_owner_update on brief_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- us-east dropped default privileges: grant explicitly (authenticated reads/updates via RLS; workers insert).
grant select, update on brief_events to authenticated;
grant all on brief_events to service_role;
