-- Atria-grade keyword search: rank IN THE DATABASE, before the limit.
--
-- WHY: PostgREST's single-query model kept forcing a bad trade for searches on the 4.4M-row index —
--   • ORDER BY (last_seen/perf_score) + a selective OR → the planner walks the sort index row-by-row
--     ("nike" timeout, and the 10-15s "hair fall" the user hit), so we removed all DB ordering for
--     searches… which meant the 120-row candidate window was ARBITRARY rows out of ~100K matches.
--     In-process ranking could only re-order that arbitrary window → novels-above-hair-brands.
--   • phraseto_tsquery in the WHERE was accurate but heap-rechecked 44K stem matches (7.2s).
--
-- THE FIX (v4 — every step PROVEN with EXPLAIN ANALYZE):
--   1. Candidates from THREE UNION ALL arms (copy / topics / categories+industries), each with its
--      OWN LIMIT — one combined OR built a single giant BitmapOr (common tag 'health' ≈ 1M rows →
--      lossy bitmap → 60s). Measured per-arm: 169ms + 36ms + 28ms.
--   2. Each arm computes its RANK COLUMNS INLINE while the heap row is already in memory:
--      the copy arm evaluates the phrase-tier there (3 = adjacent phrase, 1 = stems only); the tag
--      arms are tier 2 by definition. v2 materialized 1,500 FULL rows (~10MB w/ embeddings → 7-11s);
--      v3 ranked via a second pass over the table (1,500 random I/Os → still seconds). v4 does NO
--      second pass: sort 1,500 tiny (ad_id, tier, sk, perf) tuples, then fetch full rows for ONLY
--      the final page (~120 PK lookups).
--   3. Rank: phrase-in-copy (3) > AI-tag match (2) > stems-anywhere (1), then the caller's sort key,
--      then performance_score, then ad_id (stable pagination). DISTINCT ON keeps the best tier when
--      an ad appears in multiple arms.
--
-- CALLER CONTRACT: p_tags = SPECIFIC tags only (query phrase, compound, concept-map expansions like
-- 'hair loss'/'testosterone') — never generic single words ('men', 'health'): a common word's index
-- arm is a million-row bitmap, exactly the blow-up the arms exist to avoid.
CREATE OR REPLACE FUNCTION search_ads_v2(
  p_q text,
  p_tags text[],
  p_sort text DEFAULT 'recommended',
  p_lim int DEFAULT 120,
  p_off int DEFAULT 0
) RETURNS SETOF discovery_ads_index
LANGUAGE sql STABLE
-- Function-scoped planner pins (do NOT affect anything else): with parameters the planner uses a
-- GENERIC plan — it can't see the constants, over-estimates the arms, flips to seq scans and JIT-
-- compiles the plan → the same body that runs 230ms with literals took 14-16s in the function.
-- Every access path here is index-driven by design, so seqscan off is strictly correct, and jit
-- off kills the per-call compile tax on the over-estimated plan.
SET enable_seqscan = off
SET jit = off
AS $$
  WITH allc AS MATERIALIZED (
    (SELECT ad_id,
       CASE WHEN search_vector @@ phraseto_tsquery('english', p_q) THEN 3 ELSE 1 END AS tier,
       CASE p_sort
         WHEN 'recent'       THEN extract(epoch FROM last_seen)
         WHEN 'newest'       THEN extract(epoch FROM start_date)
         WHEN 'oldest'       THEN -extract(epoch FROM start_date)
         WHEN 'longest'      THEN days_running::numeric
         WHEN 'most_used'    THEN creative_reuse_count::numeric
         WHEN 'latest_added' THEN extract(epoch FROM indexed_at)
         WHEN 'oldest_added' THEN -extract(epoch FROM indexed_at)
         ELSE 0 END AS sk,
       performance_score AS perf
     FROM discovery_ads_index
     WHERE has_creative AND search_vector @@ plainto_tsquery('english', p_q)
     LIMIT 900)
    UNION ALL
    (SELECT ad_id, 2,
       CASE p_sort
         WHEN 'recent'       THEN extract(epoch FROM last_seen)
         WHEN 'newest'       THEN extract(epoch FROM start_date)
         WHEN 'oldest'       THEN -extract(epoch FROM start_date)
         WHEN 'longest'      THEN days_running::numeric
         WHEN 'most_used'    THEN creative_reuse_count::numeric
         WHEN 'latest_added' THEN extract(epoch FROM indexed_at)
         WHEN 'oldest_added' THEN -extract(epoch FROM indexed_at)
         ELSE 0 END,
       performance_score
     FROM discovery_ads_index
     WHERE has_creative AND topics && p_tags
     LIMIT 400)
    UNION ALL
    (SELECT ad_id, 2,
       CASE p_sort
         WHEN 'recent'       THEN extract(epoch FROM last_seen)
         WHEN 'newest'       THEN extract(epoch FROM start_date)
         WHEN 'oldest'       THEN -extract(epoch FROM start_date)
         WHEN 'longest'      THEN days_running::numeric
         WHEN 'most_used'    THEN creative_reuse_count::numeric
         WHEN 'latest_added' THEN extract(epoch FROM indexed_at)
         WHEN 'oldest_added' THEN -extract(epoch FROM indexed_at)
         ELSE 0 END,
       performance_score
     FROM discovery_ads_index
     WHERE has_creative AND (brand_categories && p_tags OR industries && p_tags)
     LIMIT 200)
  ),
  uniq AS (
    SELECT DISTINCT ON (ad_id) ad_id, tier, sk, perf
    FROM allc
    ORDER BY ad_id, tier DESC
  ),
  page AS (
    SELECT ad_id, tier, sk, perf FROM uniq
    ORDER BY tier DESC, sk DESC NULLS LAST, perf DESC NULLS LAST, ad_id
    OFFSET p_off LIMIT p_lim
  )
  SELECT d.* FROM discovery_ads_index d
  JOIN page p USING (ad_id)
  ORDER BY p.tier DESC, p.sk DESC NULLS LAST, p.perf DESC NULLS LAST, d.ad_id;
$$;

-- us-east dropped default privileges, so a NEW function isn't executable by the API roles and
-- PostgREST won't even see it until its schema cache reloads — without these the app's admin.rpc()
-- silently fails and falls back to the slow path ([[project_useast_grants_gotcha]]).
GRANT EXECUTE ON FUNCTION search_ads_v2(text, text[], text, int, int) TO service_role, anon, authenticated;
NOTIFY pgrst, 'reload schema';
