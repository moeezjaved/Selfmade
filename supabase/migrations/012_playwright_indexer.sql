-- Playwright Indexer infrastructure tables.
--
-- Replaces the Meta Graph API path with public-web GraphQL interception.
-- These tables support: raw response archive (debugging/replay),
-- schema versioning (detect Meta breaking changes), creative dedup
-- (avoid re-downloading), and crawler health tracking (anti-burn).

-- ===== Raw GraphQL response archive (24h retention) =====
-- Saved temporarily for debugging schema changes, replay attacks, or
-- catching extraction bugs. Auto-pruned by a daily cron.
CREATE TABLE IF NOT EXISTS crawler_raw_responses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          UUID NOT NULL,
  brand_page_id   TEXT,
  url             TEXT,
  response_type   TEXT,                  -- 'initial_html' / 'graphql_pagination' / 'unknown'
  status_code     INTEGER,
  bytes           INTEGER,
  body_sha256     TEXT,                  -- dedupe identical responses
  body_text       TEXT,                  -- raw response (gzipped externally if huge)
  ad_ids_count    INTEGER,
  cursors         TEXT[],
  schema_version  INTEGER,               -- bump when we know schema changed
  captured_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crawler_raw_responses_age
  ON crawler_raw_responses(captured_at);
CREATE INDEX IF NOT EXISTS idx_crawler_raw_responses_run
  ON crawler_raw_responses(run_id);

-- ===== Schema version tracking =====
-- Records which fields appeared in each crawler response. Compare across
-- runs to detect Meta silently removing/renaming fields (the #1 way
-- scrapers break). Alert when expected field disappears.
CREATE TABLE IF NOT EXISTS crawler_schema_versions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schema_signature  TEXT NOT NULL,        -- hash of sorted field names
  example_fields    TEXT[],               -- list of field paths observed
  ad_object_keys    TEXT[],               -- top-level keys on ad object
  snapshot_keys     TEXT[],               -- keys on snapshot object (where creatives live)
  first_seen_at     TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ DEFAULT NOW(),
  occurrences       INTEGER DEFAULT 1,
  is_current        BOOLEAN DEFAULT TRUE  -- false once a newer signature appears
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawler_schema_signature
  ON crawler_schema_versions(schema_signature);

-- ===== Crawler run metrics =====
-- One row per indexer run (per brand). Tracks success, failures,
-- bandwidth, ads found. Powers /admin/health dashboard + alerts.
CREATE TABLE IF NOT EXISTS crawler_runs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_page_id       TEXT,
  brand_name          TEXT,
  session_id          TEXT,                -- IPRoyal sticky session ID used
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  ads_discovered      INTEGER DEFAULT 0,
  ads_new             INTEGER DEFAULT 0,   -- new to discovery_ads_index
  ads_already_seen    INTEGER DEFAULT 0,   -- dedup hits
  bytes_through_proxy INTEGER DEFAULT 0,
  responses_captured  INTEGER DEFAULT 0,
  cursors_seen        INTEGER DEFAULT 0,
  scroll_count        INTEGER DEFAULT 0,
  status              TEXT DEFAULT 'running',  -- running / success / failed / aborted
  error_message       TEXT,
  abort_reason        TEXT                 -- 'low_success_rate' / 'timeout' / 'manual'
);
CREATE INDEX IF NOT EXISTS idx_crawler_runs_started
  ON crawler_runs(started_at DESC);

-- ===== Creative URL dedup (pre-download) =====
-- Hash of the CDN URL itself. Worker checks this before downloading
-- to avoid re-fetching the same image bytes via proxy.
CREATE TABLE IF NOT EXISTS creative_url_seen (
  url_sha256      TEXT PRIMARY KEY,
  first_url       TEXT,                   -- original URL (for debugging)
  asset_type      TEXT,                   -- 'image' / 'video'
  r2_url          TEXT,                   -- if downloaded, where it lives
  bytes           INTEGER,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  hit_count       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_creative_url_r2
  ON creative_url_seen(r2_url) WHERE r2_url IS NOT NULL;
