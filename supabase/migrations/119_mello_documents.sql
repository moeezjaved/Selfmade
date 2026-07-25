-- Mello's AI-authored documents — the artifacts Mello "leaves behind": competitor intelligence
-- reports, niche teardowns, strategy memos. Distinct from saved_reports (the perf-suite template+config).
-- A document is generated long-form markdown, grounded in real ad data, tied to the user (+ optional
-- competitor/brand subject) so it can be listed, reopened, and shared.
-- Apply ONLY with crawl+drain paused (a schema-cache reload under load can 503 the API for minutes).

create table if not exists public.mello_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  org_id        uuid,
  kind          text not null default 'competitor_report'
                  check (kind in ('competitor_report','niche_report','strategy_memo')),
  title         text not null,
  subject       text,                        -- competitor / niche the doc is about (free text)
  subject_brand_id uuid references public.brands(id) on delete set null,  -- the reader's brand it's for
  body_md       text not null,               -- the generated markdown
  model         text,                        -- which model authored it (claude-opus / gemini-2.5-pro / gpt-4o)
  meta          jsonb not null default '{}'::jsonb,  -- { adCount, competitorWebsite, ... }
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_mello_documents_user on public.mello_documents (user_id, created_at desc);
create index if not exists idx_mello_documents_subject on public.mello_documents (user_id, lower(subject));

alter table public.mello_documents enable row level security;

-- Service role (the app's admin client) bypasses RLS and does its own user-scoping, matching the rest
-- of the app. New us-east tables need explicit grants + default privileges (dropped defaults gotcha).
grant all on public.mello_documents to service_role;
