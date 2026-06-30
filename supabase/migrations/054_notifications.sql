-- Brand-tracking + new-ad alerts: the notification spine.
--
-- "New ad" = an ad INSERTED into discovery_ads_index after a user followed the brand. The crawler
-- upserts onConflict ad_id, so we can't use a plain DEFAULT (it'd reset on every re-crawl). Instead a
-- BEFORE INSERT trigger stamps created_at only on the INSERT path (re-crawl updates don't fire it),
-- giving a true "first time we saw this ad" timestamp.

-- ── new-ad detection signal on discovery_ads_index ──
-- ADD COLUMN nullable (no volatile default) → instant metadata change, no table rewrite.
alter table discovery_ads_index add column if not exists created_at timestamptz;

create or replace function stamp_dai_created_at() returns trigger language plpgsql as $$
begin
  if new.created_at is null then new.created_at := now(); end if;
  return new;
end $$;

drop trigger if exists trg_dai_created_at on discovery_ads_index;
create trigger trg_dai_created_at before insert on discovery_ads_index
  for each row execute function stamp_dai_created_at();

-- Partial index is EMPTY at creation (all rows null) → instant build, no lock pain. Grows as new ads
-- arrive. Powers the alert worker's "ads on followed brands since watermark" query.
create index if not exists dai_created_at_idx on discovery_ads_index (page_id, created_at)
  where created_at is not null;

-- ── per-follow alert watermark ──
-- Default now() so existing follows don't fire for the whole backlog — only ads seen AFTER this.
alter table followed_brands add column if not exists last_notified_at timestamptz default now();

-- ── notifications (the event log the bell + feed read) ──
create table if not exists notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  type        text not null default 'new_ad',   -- new_ad | winner | digest
  page_id     text,
  brand_name  text,
  ad_count    int default 1,                    -- # of NEW concepts (post copy-sig dedup)
  sample_ad_id text,                            -- representative ad for the thumbnail/link
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx   on notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on notifications (user_id) where read_at is null;

-- ── per-user delivery prefs ──
create table if not exists notification_prefs (
  user_id          uuid primary key,
  in_app           boolean default true,
  instant_email    boolean default false,        -- debounced per-brand email (Phase 2 / Resend)
  digest_frequency text default 'weekly'          -- weekly | daily | off
);

-- Service-role (admin client) only — lock from the public API, grant the worker + API access.
alter table notifications     enable row level security;
alter table notification_prefs enable row level security;
grant select, insert, update, delete on notifications      to service_role;
grant select, insert, update, delete on notification_prefs to service_role;
