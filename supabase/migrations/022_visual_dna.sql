-- 022_visual_dna.sql
-- Visual Creative DNA — vision-model labels for each creative image/first-frame.
-- Powers "UGC vs studio" + visual_style filters and the visual half of Pattern
-- Detection (bathroom selfie / white robe / before-after, etc.). Also extracts
-- on-screen text, which recovers Creative DNA for the ~58% of ads that are
-- text-less in copy (DPA catalog ads + videos).
--
-- All columns are nullable → instant ALTER (no table rewrite, unlike a STORED
-- generated column). Safe to run on the live table.

alter table discovery_ads_index add column if not exists format_style      text;    -- UGC | Studio / Produced | Graphic / Text | Mixed
alter table discovery_ads_index add column if not exists visual_style       text;    -- dominant visual setting (enum, see classifier)
alter table discovery_ads_index add column if not exists visual_scene       text;    -- one short phrase describing the shot
alter table discovery_ads_index add column if not exists on_screen_text     text;    -- prominent text overlaid on the creative (verbatim)
alter table discovery_ads_index add column if not exists visual_classified  boolean default false;

create index if not exists idx_ads_format_style on discovery_ads_index (format_style);
create index if not exists idx_ads_visual_style on discovery_ads_index (visual_style);
