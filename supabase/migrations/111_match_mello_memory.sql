-- 111_match_mello_memory.sql — semantic recall over Mello's notebook.
-- Given a query embedding, return the user's most MEANING-RELEVANT memories (cosine), so Mello can
-- answer "what did I say about discounts months ago" by similarity, not recency. Retired rules excluded.
create or replace function match_mello_memory(p_user uuid, p_embedding vector(1536), p_limit int default 8)
returns table(kind text, content text, category text, similarity float)
language sql stable as $$
  select kind, content, category, 1 - (embedding <=> p_embedding) as similarity
  from mello_memory
  where user_id = p_user and embedding is not null and retired_at is null
  order by embedding <=> p_embedding
  limit greatest(1, least(p_limit, 25))
$$;
grant execute on function match_mello_memory(uuid, vector, int) to authenticated, service_role;
