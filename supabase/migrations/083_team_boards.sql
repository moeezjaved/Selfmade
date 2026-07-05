-- Team Boards (spec §10.2). Org-share discovery_boards + saved ads; add sub-boards + author.
-- Default-personal & backfilled so nothing existing changes visibility.

-- ── discovery_boards: org scope + visibility + sub-boards + author ──
alter table discovery_boards add column if not exists org_id uuid references organizations(id);
alter table discovery_boards add column if not exists visibility text not null default 'personal'
  check (visibility in ('personal','team'));
alter table discovery_boards add column if not exists parent_board_id uuid references discovery_boards(id) on delete cascade;
alter table discovery_boards add column if not exists created_by uuid;

update discovery_boards set created_by = user_id where created_by is null;
update discovery_boards b set org_id = o.id
  from org_members m join organizations o on o.id = m.org_id
  where b.org_id is null and m.user_id = b.user_id;

create index if not exists idx_boards_org on discovery_boards(org_id, visibility);
create index if not exists idx_boards_parent on discovery_boards(parent_board_id);

-- ── discovery_saved_ads: org scope so team boards surface teammates' saves ──
alter table discovery_saved_ads add column if not exists org_id uuid;
update discovery_saved_ads s set org_id = o.id
  from org_members m join organizations o on o.id = m.org_id
  where s.org_id is null and m.user_id = s.user_id;
create index if not exists idx_saved_org_board on discovery_saved_ads(org_id, board_id);

-- ── Tags (Atria depth) — cross-cutting labels on individual saved ads ──
create table if not exists saved_ad_tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  saved_ad_id uuid references discovery_saved_ads(id) on delete cascade,
  tag text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (saved_ad_id, tag)
);
create index if not exists idx_tags_org on saved_ad_tags(org_id);

-- us-east grants gotcha: grant on new tables/cols
grant all on discovery_boards to service_role;
grant all on discovery_saved_ads to service_role;
grant all on saved_ad_tags to service_role, authenticated;
