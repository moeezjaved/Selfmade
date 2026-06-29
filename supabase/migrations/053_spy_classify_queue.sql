-- Auto-classify-on-spy queue.
-- When a user opens Brand Spy for a brand whose AI-DNA panels (Personas/USPs/Desires/
-- Emotions/Themes) are empty, the web app enqueues that brand here. The droplet
-- `spy-classify-worker` polls this table and runs the existing per-copy-signature
-- classifier scoped to that ONE brand (CLASSIFY_PAGE_ID), so the DNA fills within
-- minutes instead of waiting on the global classify backlog. One brand at a time →
-- tiny DB load, safe alongside live serving.

create table if not exists spy_classify_queue (
  page_id      text primary key,
  status       text not null default 'pending',   -- pending | processing | done | error
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  applied      int,
  attempts     int not null default 0,
  error        text
);

-- Worker scans pending oldest-first.
create index if not exists spy_classify_queue_pending
  on spy_classify_queue (requested_at) where status = 'pending';

-- Only the service-role (admin) client touches this; lock it from the public API.
alter table spy_classify_queue enable row level security;

-- Idempotent enqueue: insert a fresh request, OR re-queue a brand that previously
-- finished/errored (it may have new unclassified ads) — but NEVER disturb a row that's
-- already pending/processing (avoids resetting an in-flight job).
create or replace function enqueue_spy_classify(p_page_id text)
returns void language sql as $$
  insert into spy_classify_queue (page_id, status, requested_at)
  values (p_page_id, 'pending', now())
  on conflict (page_id) do update
    set status = 'pending', requested_at = now(), started_at = null,
        finished_at = null, error = null
    where spy_classify_queue.status in ('done', 'error');
$$;

grant execute on function enqueue_spy_classify(text) to service_role;
