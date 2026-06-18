-- 023_text_dna_extend.sql
-- Phase B — extend Creative DNA with problem / mechanism / offer / cta_style.
-- Filled two ways (same columns):
--   • copy-driven ads → the existing copy_sig classifier (classify-core, extended schema)
--   • text-less ads (DPA/video) → a creative-hash pass over recovered `on_screen_text`
-- All nullable text = instant ALTER, no rewrite.

alter table discovery_ads_index add column if not exists problem    text;   -- core problem the ad targets
alter table discovery_ads_index add column if not exists mechanism  text;   -- the "how it works" (e.g. micro infusion)
alter table discovery_ads_index add column if not exists offer      text;   -- the deal (e.g. starter kit, 50% off)
alter table discovery_ads_index add column if not exists cta_style  text;   -- soft | hard | none

create index if not exists idx_ads_cta_style on discovery_ads_index (cta_style);
