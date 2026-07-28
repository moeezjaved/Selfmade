-- 126: extend Mello's task kinds with Meta ACTIONS (the approve→act loop of the Company Brain
-- architecture). meta_pause / meta_scale tasks are SUGGESTED by the nightly Meta audit; clicking
-- Start in the brief is the founder's approval; tasks/run executes via the MetaClient.
-- Apply via Supabase SQL editor (per the pause-before-DDL rule, tables this small are instant).

alter table public.mello_tasks drop constraint if exists mello_tasks_kind_check;
alter table public.mello_tasks add constraint mello_tasks_kind_check
  check (kind in ('research','creative','video','meta_pause','meta_scale'));
