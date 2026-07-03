-- AI Ad Studio — the curated "inspiration library" that every generated ad draws its
-- aesthetic from, plus the two new credit actions for Studio generation.
--
-- ad_inspirations: hand-picked breathtaking ad designs (uploaded via /admin/inspirations),
-- each auto-tagged once by Nano Banana Pro vision so we can retrieve the right references
-- per user industry/format at generation time. These are the aesthetic ground truth.

create table if not exists ad_inspirations (
  id           uuid primary key default gen_random_uuid(),
  r2_url       text not null,
  niche        text,                         -- coarse niche (matches discovery_ads_index.niche)
  format       text,                         -- 'image' | 'story' | 'carousel'
  aspect       text,                         -- e.g. '1:1' | '4:5' | '9:16'
  palette      text[] default '{}',          -- dominant hex colors
  style_tags   text[] default '{}',          -- e.g. 'minimal','bold-type','editorial','gradient'
  layout_type  text,                         -- e.g. 'hero-product','before-after','testimonial','stat'
  note         text,                         -- optional admin note / source
  tagged       boolean not null default false, -- auto-tagging completed?
  active       boolean not null default true,
  created_at   timestamptz default now()
);
create index if not exists idx_ad_inspirations_niche  on ad_inspirations (niche) where active;
create index if not exists idx_ad_inspirations_active on ad_inspirations (active, created_at desc);

grant all on table ad_inspirations to anon, authenticated, service_role;

-- Studio generation pricing — mirrors Clone (2K default / 4K HD).
insert into credit_pricing (action_type, label, credits, is_active) values
  ('image_studio_pro', 'AI Ad Studio — 2K original ad', 15, true),
  ('image_studio_4k',  'AI Ad Studio — 4K HD original ad', 25, true)
on conflict (action_type) do update set label = excluded.label, credits = excluded.credits, is_active = true;
