-- Worker batch metrics — tracks IPRoyal bandwidth used by the worker
-- (which downloads creatives) separately from the indexer (which crawls
-- listing pages).
--
-- Before this table, the dashboard only showed crawler_runs.bytes_through_proxy
-- = indexer bandwidth. Worker bandwidth (the bigger bucket — image downloads
-- via residential proxy) was logged to stdout but lost. Result: dashboard
-- said "2.9 MB used today" while IPRoyal said "200 MB used today".
--
-- This table fixes that by recording per-batch bandwidth so the health API
-- can sum it.

CREATE TABLE IF NOT EXISTS worker_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_id       TEXT,                          -- which worker container
  hostname        TEXT,                          -- droplet hostname
  batch_size      INTEGER,                       -- ads attempted in this batch
  ads_ok          INTEGER,                       -- successful ads
  ads_failed      INTEGER,                       -- marked-failed ads
  images_saved    INTEGER,                       -- total images uploaded to R2
  videos_saved    INTEGER,                       -- total videos uploaded to R2
  deduped_count   INTEGER,                       -- assets that hit hash dedup
  bytes_proxy     BIGINT,                        -- bytes through IPRoyal residential proxy (paid)
  bytes_droplet   BIGINT,                        -- bytes downloaded direct from droplet (free, DigitalOcean bandwidth)
  duration_ms     INTEGER,                       -- batch wall-clock time
  finished_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_runs_finished
  ON worker_runs(finished_at DESC);

COMMENT ON TABLE worker_runs IS
  'Per-batch worker metrics. Health dashboard sums bytes_proxy from this table + crawler_runs to show total IPRoyal bandwidth used. bytes_droplet is FREE (covered by DigitalOcean bandwidth) and shown separately.';
