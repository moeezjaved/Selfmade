-- Copy-signature classification key + classifiability gate (Postgres-owned).
--
-- WHY copy_sig (not image_hash):
--   The classifier reads ONLY ad copy (page_name/title/body) — never pixels.
--   So classification is a pure function of the copy. Keying dedup on image_hash
--   was wrong: a brand runs one image with different captions, so one caption's
--   tags would smear onto every variant — poisoning `topics`, the field search
--   depends on. The copy signature is provably correct: identical copy ⟹
--   identical classification. We key on page_id (stable) not page_name, which
--   drifts across partnership display names (Grüns→"Chelsea Handler").
--
-- WHY generated STORED columns (not app-computed):
--   Postgres owns the key, so BOTH ingest paths (Vercel /api/indexer and the
--   droplet playwright-indexer) get it for free — no drift, no separate backfill
--   job. Adding a STORED generated column backfills every existing row at ALTER
--   time. digest()/regexp_replace() are immutable, so they're legal here.
--
-- ⚠️ RUN THIS NOW, WHILE THE TABLE IS SMALL. Adding a STORED generated column
--    rewrites the whole table under an ACCESS EXCLUSIVE lock (seconds at ~20k
--    rows; a multi-minute write-lock / crawl-insert outage at 1M).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Stable per-advertiser signature of the normalized copy (sha256 hex).
-- normalize = lowercase, collapse all whitespace to single spaces, trim.
ALTER TABLE discovery_ads_index
  ADD COLUMN IF NOT EXISTS copy_sig TEXT
  GENERATED ALWAYS AS (
    encode(digest(
      btrim(regexp_replace(
        lower(
          coalesce(page_id::text, '') || chr(10) ||
          coalesce(title, '')        || chr(10) ||
          coalesce(body, '')
        ),
        '\s+', ' ', 'g')),
      'sha256'), 'hex')
  ) STORED;

-- Classifiable = has real copy after stripping Shopify-style {{template}} tokens.
-- Blank/template-only bodies ("{{product.brand}}") classify to garbage — skip them
-- (future vision-pass candidates).
ALTER TABLE discovery_ads_index
  ADD COLUMN IF NOT EXISTS is_classifiable BOOLEAN
  GENERATED ALWAYS AS (
    length(btrim(regexp_replace(coalesce(body, ''), '\{\{[^}]*\}\}', '', 'g'))) >= 12
  ) STORED;

-- Group-by key for the classifier; partial so it only indexes work-eligible rows.
CREATE INDEX IF NOT EXISTS idx_ads_copy_sig
  ON discovery_ads_index (copy_sig)
  WHERE is_classifiable;

-- ── One-time corrective reset ──────────────────────────────────────────────
-- The earlier per-creative drain keyed on image_hash and stamped `topics` under
-- the wrong key (correct for exact-dups, wrong for copy-variants). Discard those
-- tags so the copy_sig pass re-keys everything cleanly. The self-healing gate
-- (ai_classified IS NOT TRUE OR topics IS NULL) then re-picks every row, and the
-- run terminates normally as rows get re-stamped by copy_sig.
UPDATE discovery_ads_index
  SET ai_classified = FALSE, topics = NULL
  WHERE ai_classified = TRUE;
