-- Multi-IP proxy pool for Meta crawl traffic.
--
-- Why: a single static residential IP (Proxy-Cheap) gets soft-throttled by
-- Meta after ~60 requests/session. Rotating across multiple IPs distributes
-- the load and keeps every brand on the fast lane.
--
-- Why DB-backed (not env vars):
--   1. Admin UI can add/disable/swap IPs without redeploying
--   2. Per-IP metrics get a natural FK to live in proxy_pool_events
--   3. The "Swap IP" button on /admin/health can flip enabled=false in 1 click
--
-- IPRoyal stays as fallback:
--   - Worker code falls through to startProxyChain() if pool returns nothing
--     OR if USE_PROXY_POOL=false (the safe default during rollout)

CREATE TABLE IF NOT EXISTS proxy_pool (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label            TEXT NOT NULL,                          -- human name e.g. "PC-comcast-1"
  provider         TEXT NOT NULL DEFAULT 'proxycheap',     -- 'proxycheap' | 'iproyal' | other
  host             TEXT NOT NULL,
  port             INTEGER NOT NULL,
  username         TEXT NOT NULL,
  password         TEXT NOT NULL,
  country          TEXT,                                   -- 'US' / 'GB' / etc (informational)
  isp              TEXT,                                   -- 'Comcast' / 'Spectrum' / etc (informational)
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_at      TIMESTAMPTZ,
  disabled_reason  TEXT,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ,
  notes            TEXT,
  CONSTRAINT proxy_pool_host_port_uniq UNIQUE (host, port)
);

CREATE INDEX IF NOT EXISTS idx_proxy_pool_enabled ON proxy_pool(enabled) WHERE enabled = TRUE;

COMMENT ON TABLE proxy_pool IS
  'Pool of upstream proxies the worker round-robins across. Admin UI can add/disable rows without redeploying. Worker code falls back to IPRoyal env vars if the pool is empty or USE_PROXY_POOL=false.';

-- Per-request event log. One row per GraphQL POST or asset download.
-- Used by admin to compute per-IP latency, error rate, and crawl volume.
CREATE TABLE IF NOT EXISTS proxy_pool_events (
  id               BIGSERIAL PRIMARY KEY,
  proxy_pool_id    UUID NOT NULL REFERENCES proxy_pool(id) ON DELETE CASCADE,
  ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind             TEXT NOT NULL,                          -- 'crawl' | 'asset' | 'error' | 'disabled'
  latency_ms       INTEGER,
  http_status      INTEGER,
  bytes            BIGINT,                                 -- response body size (optional)
  brand_page_id    TEXT,
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_proxy_pool_events_proxy_ts
  ON proxy_pool_events(proxy_pool_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_pool_events_ts
  ON proxy_pool_events(ts DESC);

COMMENT ON TABLE proxy_pool_events IS
  'Per-request observability for proxy pool. Health dashboard aggregates this to compute p50/p95 latency, error rate, and request count per IP — driving the "add more IPs" alert.';
