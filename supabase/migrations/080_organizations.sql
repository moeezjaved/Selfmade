-- Team seats — organizations, members, invites. One shared workspace per org.
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Team',
  owner_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',        -- owner | admin | member
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  token text unique not null,
  invited_by uuid,
  status text not null default 'pending',      -- pending | accepted | revoked
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists org_members_user_idx on org_members (user_id);
create index if not exists org_members_org_idx on org_members (org_id);
create index if not exists org_invites_token_idx on org_invites (token) where status = 'pending';
create index if not exists org_invites_email_idx on org_invites (lower(email)) where status = 'pending';

-- us-east grants gotcha: grant the app role (default privileges also covers future tables now)
grant all on organizations, org_members, org_invites to service_role;
