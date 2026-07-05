-- Assets AI layer (spec §10.3, step 5): semantic/visual search over uploaded assets.
create extension if not exists vector;
alter table assets add column if not exists embedding vector(1536);

-- Cosine nearest-neighbour search scoped to an org. (Plain order-by-distance — fine for per-org
-- asset counts; add an ivfflat index if a single org's library ever gets huge.)
create or replace function search_assets(p_org uuid, p_query vector(1536), p_limit int default 60)
returns setof assets language sql stable as $$
  select * from assets
  where org_id = p_org and embedding is not null
  order by embedding <=> p_query
  limit p_limit;
$$;

grant execute on function search_assets(uuid, vector, int) to service_role;
