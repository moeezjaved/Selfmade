-- Per-member ad-account scoping (Seats Stage 2).
-- Which of the ORG's connected Meta ad accounts each member may see in Insights/Reports/Campaigns.
--
-- Default-ALL model: a member with ZERO rows here sees EVERY account in the org pool (non-breaking).
-- As soon as an owner/admin assigns specific accounts, the member is restricted to exactly those.
-- Owner + admins always see all accounts regardless of rows.
create table if not exists org_member_ad_accounts (
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null,
  account_id  text not null,               -- meta_accounts.account_id (Meta act_ id)
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id, account_id)
);

create index if not exists idx_omaa_member on org_member_ad_accounts (org_id, user_id);

-- us-east grants gotcha: new tables have no privileges until granted (migration dropped defaults).
grant all on org_member_ad_accounts to service_role;
grant all on org_member_ad_accounts to authenticated;
