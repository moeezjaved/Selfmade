-- 115: PLAYBOOKS — the library becomes a workflow (Watch → Understand → Remake).
-- Curated, continuously-updated walls of winning ads ("Beauty Playbook · 100 winning
-- beauty ads"), each an SEO entrance that funnels into Remake. Curation is both
-- manual (admin panel) and AI (auto-fill from the corpus). Moeez's schema, verbatim,
-- plus timestamps. + ad_insights: cached AI "why this ad works" per ad.

create table if not exists playbooks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  slug        text not null unique,
  description text,
  emoji       text,
  cover_image text,
  cover_video text,
  featured    boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists playbook_ads (
  playbook_id uuid not null references playbooks(id) on delete cascade,
  ad_id       text not null,
  position    int not null default 0,
  featured    boolean not null default false,
  added_at    timestamptz not null default now(),
  primary key (playbook_id, ad_id)
);
create index if not exists playbook_ads_order_idx on playbook_ads (playbook_id, position);

-- cached "Understand" analysis — generated on first visit, then permanent
create table if not exists ad_insights (
  ad_id      text primary key,
  headline   text,
  bullets    jsonb not null default '[]'::jsonb,
  model      text,
  created_at timestamptz not null default now()
);

-- all reads/writes go through server (admin client); nothing client-direct
alter table playbooks    enable row level security;
alter table playbook_ads enable row level security;
alter table ad_insights  enable row level security;
revoke all on playbooks, playbook_ads, ad_insights from anon, authenticated;
grant all on playbooks, playbook_ads, ad_insights to service_role;
