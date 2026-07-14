-- Atria-grade keyword search: rank IN THE DATABASE, before the limit.
--
-- WHY: PostgREST's single-query model kept forcing a bad trade for searches on the 4.4M-row index —
--   • ORDER BY (last_seen/perf_score) + a selective OR → the planner walks the sort index row-by-row
--     ("nike" timeout, and the 10-15s "hair fall" the user hit), so we removed all DB ordering for
--     searches… which meant the 120-row candidate window was ARBITRARY rows out of ~100K matches.
--     In-process ranking could only re-order that arbitrary window → novels-above-hair-brands.
--   • phraseto_tsquery in the WHERE was accurate but heap-rechecked 44K stem matches (7.2s).
--
-- THE FIX: a function = full control over the plan. MATERIALIZED CTE forces: (1) fast GIN BitmapOr
-- grabs up to 1,500 candidates with NO ordering (measured ~240ms); (2) rank ONLY those 1,500 —
-- phrase-match recheck on 1,500 rows is microseconds; (3) page from the ranked set. Every page is
-- the true best-of-1500, novels sink below tag-matched brands, and it's index-fast regardless of
-- how common the words are.
--
-- Ranking: phrase-in-copy (3) > AI-tag match (2) > stems-anywhere (1), then the caller's sort
-- (recent/newest/longest/most_used/latest_added epoch keys), then performance_score, then ad_id
-- (stable pagination).
CREATE OR REPLACE FUNCTION search_ads_v2(
  p_q text,
  p_tags text[],
  p_sort text DEFAULT 'recommended',
  p_lim int DEFAULT 120,
  p_off int DEFAULT 0
) RETURNS SETOF discovery_ads_index
LANGUAGE sql STABLE AS $$
  WITH cand AS MATERIALIZED (
    SELECT *
    FROM discovery_ads_index
    WHERE has_creative
      AND (
        search_vector @@ plainto_tsquery('english', p_q)
        OR topics && p_tags
        OR brand_categories && p_tags
        OR industries && p_tags
      )
    LIMIT 1500
  )
  SELECT * FROM cand
  ORDER BY
    (CASE WHEN search_vector @@ phraseto_tsquery('english', p_q) THEN 3
          WHEN topics && p_tags OR brand_categories && p_tags OR industries && p_tags THEN 2
          ELSE 1 END) DESC,
    (CASE p_sort
       WHEN 'recent'       THEN extract(epoch FROM last_seen)
       WHEN 'newest'       THEN extract(epoch FROM start_date)
       WHEN 'oldest'       THEN -extract(epoch FROM start_date)
       WHEN 'longest'      THEN days_running::numeric
       WHEN 'most_used'    THEN creative_reuse_count::numeric
       WHEN 'latest_added' THEN extract(epoch FROM indexed_at)
       WHEN 'oldest_added' THEN -extract(epoch FROM indexed_at)
       ELSE 0 END) DESC NULLS LAST,
    performance_score DESC NULLS LAST,
    ad_id
  OFFSET p_off LIMIT p_lim;
$$;
