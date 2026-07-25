-- ─────────────────────────────────────────────────────────────────────────────
-- 118 · Accent-insensitive, relevance-ranked brand search (#5 — the "Fum" miss).
--
-- WHY
--   The brand picker searched `name ILIKE '%q%'` — case-insensitive but ACCENT-sensitive,
--   ordered by ad count. So "fum" never matched "Füm — The Good Habit" (ü ≠ u), while it DID
--   match the substring in "par·fum" / "per·fume" — which, having more ads, buried the real brand.
--   A founder searching their actual competitor got a wall of perfume brands and not the one they meant.
--
-- WHAT THIS DOES
--   1. unaccent + pg_trgm extensions.
--   2. An IMMUTABLE unaccent wrapper (the 1-arg unaccent is only STABLE, so it can't be indexed).
--   3. A trigram GIN index on immutable_unaccent(lower(name)) → accent-insensitive `%q%` stays fast
--      on 611K rows (no seq-scan — the perf trap this codebase keeps hitting).
--   4. search_brand_directory(q, industry, limit): matches on the normalized name and RANKS
--      exact → prefix → word-start → (then) ad count. So "fum" → "Füm — The Good Habit" first,
--      perfume brands after.
--
-- ⚠️ RUNBOOK — DDL + a PostgREST schema reload (to expose the RPC). Per the standing rule, a reload
--   under crawl load once 503'd the API ~4 min. Apply in a paused window:
--     1. Pause crawl+drain (system_flags 'crawl_paused', or stop the scheduler container)
--     2. Apply this file  (the CREATE INDEX on 611K rows takes a bit — CONCURRENTLY not usable inside
--        a txn, so a brief lock; fine while paused)
--     3. Resume crawl
--   The app already calls the RPC with a graceful fallback to the old ILIKE, so nothing breaks
--   before this is applied — search just stays accent-sensitive until then.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- 1-arg unaccent() is STABLE (not indexable); the 2-arg form with an explicit dictionary is
-- IMMUTABLE. Wrap it so we can build a functional index.
create or replace function immutable_unaccent(text)
  returns text language sql immutable parallel safe
  as $$ select unaccent('unaccent'::regdictionary, $1) $$;

-- Fast accent-insensitive substring search at 611K rows.
create index if not exists idx_brand_directory_name_unaccent_trgm
  on brand_directory using gin (immutable_unaccent(lower(name)) gin_trgm_ops);

-- Relevance-ranked, accent-insensitive search. STABLE + read-only.
create or replace function search_brand_directory(p_q text, p_industry text default null, p_limit int default 50)
  returns table (page_id text, name text, avatar_url text, industry text, source_ad_count int, country text)
  language sql stable as $$
    with nq as (select immutable_unaccent(lower(trim(coalesce(p_q, '')))) as q)
    select b.page_id, b.name, b.avatar_url, b.industry, b.source_ad_count, b.country
    from brand_directory b, nq
    where nq.q <> ''
      and immutable_unaccent(lower(b.name)) like '%' || nq.q || '%'
      and (p_industry is null or b.industry = p_industry)
    order by
      (immutable_unaccent(lower(b.name)) = nq.q) desc,                     -- exact name
      (immutable_unaccent(lower(b.name)) like nq.q || '%') desc,           -- starts with query
      (immutable_unaccent(lower(b.name)) like '% ' || nq.q || '%') desc,   -- query starts a word
      b.source_ad_count desc nulls last,                                   -- then by ad volume
      b.page_id
    limit greatest(1, least(coalesce(p_limit, 50), 100));
  $$;

-- us-east grants gotcha: new functions need execute re-stated for the app roles.
grant execute on function immutable_unaccent(text) to anon, authenticated, service_role;
grant execute on function search_brand_directory(text, text, int) to anon, authenticated, service_role;
