-- Single-row status written by the nightly rollup (worker/src/nightly-rollup.mjs).
-- The /admin/health page reads it to surface "did the nightly run, and was it clean?"
-- as a PULL signal — no external webhook needed. The webhook (ALERT_WEBHOOK_URL)
-- stays an optional push-on-failure on top of this.
create table if not exists discovery_rollup_status (
  id          int primary key default 1,
  ran_at      timestamptz not null,
  total_rows  int,
  winners     int,         -- total performance_tier='winning' after the run
  bad_winners int,         -- winners with days_running < 14 (regression: gate leaked)
  fail_chunks int,         -- apply_perf chunks that never wrote after retries
  wrote       int,         -- rows successfully written
  fetch_s     numeric,     -- fetch + recompute seconds (grows with corpus)
  write_s     numeric,     -- apply_perf write seconds (crawler paused this long)
  total_s     numeric,
  constraint discovery_rollup_status_single check (id = 1)
);
-- service_role (admin client + droplet REST) bypasses RLS, so no policy needed.
