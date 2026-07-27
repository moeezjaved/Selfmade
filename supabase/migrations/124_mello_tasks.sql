-- Mello Tasks — the "CEO desk": decisions Mello already made, waiting for one click. Each row is a
-- task Mello proposes (RESEARCH / CREATIVE / VIDEO), that the user runs (→ executes the matching
-- engine: competitor report / ad gen / video remake) and gets emailed when done. This turns the brief
-- from an analytics dashboard into "here's the one thing to do today — click and I'll do it."
-- Apply ONLY with crawl+drain paused (a schema-cache reload under load can 503 the API for minutes).

create table if not exists public.mello_tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  brand_id      uuid references public.brands(id) on delete set null,   -- the reader's brand this is for
  kind          text not null check (kind in ('research','creative','video')),
  title         text not null,                    -- the ACTION, phrased as a command ("Produce the Bug MD report")
  why           text,                             -- the JUDGMENT (why it matters today)
  evidence      jsonb not null default '{}'::jsonb, -- the OBSERVATION ({ adCount, pageId, competitor, hook, offer, adId, ... })
  status        text not null default 'suggested'
                  check (status in ('suggested','running','done','failed','dismissed')),
  suggested_key text,                             -- dedupe: e.g. 'research:113911:2026-W31' — a done/dismissed task never re-suggests
  credits       integer,                          -- cost on run (null = free, e.g. video → free storyboard first)
  result        jsonb not null default '{}'::jsonb, -- { docId, url, jobId, ... } once executed
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_mello_tasks_user on public.mello_tasks (user_id, created_at desc);
-- Each distinct suggestion persists at most once per user (so a run/dismissed task isn't re-proposed).
create unique index if not exists uq_mello_tasks_key on public.mello_tasks (user_id, suggested_key) where suggested_key is not null;

alter table public.mello_tasks enable row level security;

-- Service role (app admin client) bypasses RLS + does its own user-scoping, like the rest of the app.
-- New us-east tables need explicit grants + default privileges (the dropped-defaults gotcha).
grant all on public.mello_tasks to service_role;
