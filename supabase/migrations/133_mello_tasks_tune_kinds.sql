-- Extend the mello_tasks kind whitelist with the two "duplicate-and-tune" moves so the nightly audit
-- can suggest them and the founder can approve from Slack/WhatsApp (approve → run-task → applyTune).
--   meta_audience  — "Target them": duplicate the winner, focus the copy on the best segment.
--   meta_placement — "Review placements": duplicate the winner, restrict the copy to the best placement.
-- Both DUPLICATE (original never edited, no learning-phase reset) — same safety as meta_scale via /copies.
-- Low-risk constraint swap on a small table, but it triggers a schema reload — apply during a quiet
-- window (pause crawl/drain) per the standing pause-before-DDL rule.
alter table public.mello_tasks drop constraint if exists mello_tasks_kind_check;
alter table public.mello_tasks add constraint mello_tasks_kind_check
  check (kind in ('research','creative','video','meta_pause','meta_scale','meta_audience','meta_placement'));
