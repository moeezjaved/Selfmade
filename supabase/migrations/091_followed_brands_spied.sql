-- 091_followed_brands_spied.sql — split "Spied" from "Followed".
--
-- Problem: followed_brands is written by BOTH the Brand Spy "Spy" button and the discovery
-- ❤️ Follow button, so the Brand Spy list showed every followed brand as if it were spied.
--
-- Fix: add a `spied` flag. Brand Spy lists spied=true only; ❤️ Follow leaves it false; the
-- alert-worker keeps using the whole table (a spied brand is still followed for alerts).
--
-- Backfill: mark ALL existing rows spied=true so nobody's current Brand Spy list shrinks on
-- deploy (they were all showing there already). Going forward the two sources diverge.
-- Safe to apply live: additive column + one bounded UPDATE, no lock on hot paths.

alter table followed_brands add column if not exists spied boolean not null default false;

-- Existing follows were all surfacing in Brand Spy → preserve that (treat them as spies).
update followed_brands set spied = true where spied = false;

-- Brand Spy list query is `user_id in (...) and spied = true` → keep it fast.
create index if not exists idx_followed_brands_user_spied on followed_brands (user_id, spied);

grant all on table public.followed_brands to anon, authenticated, service_role;
