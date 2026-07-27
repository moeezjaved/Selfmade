-- One-time "your spy is loaded" email marker. When a user adds a competitor to watch, the archive
-- crawl is async; the alert-worker emails them the moment that brand has ads in the index, then flips
-- this flag so it never re-sends. Default false so every existing + new follow is eligible once.
-- Apply with crawl + drain paused (a schema-cache reload under load can 503 the API for minutes).

alter table public.followed_brands add column if not exists load_emailed boolean not null default false;
