-- ─────────────────────────────────────────────────────────────────────────────
-- 117 · Competitors belong to a BRAND, not just to the account.
--
-- WHY
--   followed_brands is keyed (user_id, page_id), so every competitor a founder
--   watches lands in one shared pool. With nine brands on one account, watching
--   Bug MD for Bug Shield and CeraVe for Hair ResQ produces a single
--   undifferentiated list — which is why the brief can only say "14 competitors"
--   instead of "Hair ResQ: 6 · Bug Shield: 3", and why per-brand scoping,
--   a brand switcher, and the agency portfolio view are all impossible today.
--
-- WHAT THIS DOES
--   Adds a NULLABLE brand_id. Nothing existing breaks:
--     brand_id IS NULL  → watched at account level (all legacy rows; still works
--                         exactly as before, shows in every brand's view)
--     brand_id IS SET   → watched for that specific brand
--   No backfill. Guessing that existing follows belong to the user's first brand
--   would be wrong more often than right — leave them account-level and let the
--   app assign as founders use the new "Watch competitors" flow per brand.
--
-- KNOWN LIMIT (deliberate, keeps this change small)
--   The existing UNIQUE (user_id, page_id) is left alone, so one competitor can
--   be assigned to at most ONE brand per account. Watching the same rival for two
--   brands needs UNIQUE (user_id, page_id, brand_id) — but NULLs are never equal
--   in Postgres, so that variant silently permits duplicate account-level rows and
--   needs a partial index to be safe. Deferred until the product actually asks.
--
-- ⚠️ RUNBOOK — do NOT apply casually. Per the standing rule, a schema reload under
--   crawl load once 503'd the API for ~4 minutes:
--     1. Pause the crawl + drain  (system_flags 'crawl_paused', or stop the
--        scheduler container on the droplet)
--     2. Confirm writers are idle
--     3. Apply this migration
--     4. Resume the crawl
--   ADD COLUMN with no default and no backfill is metadata-only in modern
--   Postgres, so the lock is brief — but the PostgREST schema reload is the part
--   that hurts under load.
--
-- FOLLOW-UP CODE (not included here — ship after the column exists)
--   · POST /api/follows            → accept + persist brandId
--   · AddCompetitors.tsx           → send brandId (it already receives one, and
--                                    currently records the link in the notebook
--                                    as a stopgap)
--   · lib/brief/assemble.ts        → group/scope competitors by brand
--   · BriefScan Competitors column → label or filter per brand
-- ─────────────────────────────────────────────────────────────────────────────

alter table followed_brands
  add column if not exists brand_id uuid references brands(id) on delete set null;

comment on column followed_brands.brand_id is
  'Which of the user''s brands this competitor is watched FOR. NULL = account-level (legacy/unassigned).';

-- Scoping a brief to one brand is the hot path: "this brand''s competitors".
create index if not exists idx_followed_brands_user_brand
  on followed_brands (user_id, brand_id);

-- us-east gotcha: NEW columns/objects need grants re-stated or service_role hits
-- "permission denied" (default privileges were dropped in the region move).
grant all on followed_brands to service_role;
