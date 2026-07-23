-- 112_match_mello_memory_dates.sql — recall now returns created_at + source so Mello can CITE when/how
-- it learned each memory ("as you told me on Jul 2 via the hiring interview"). Replaces the 111 signature
-- (return type changed → must drop first).
drop function if exists match_mello_memory(uuid, vector, int);
create or replace function match_mello_memory(p_user uuid, p_embedding vector(1536), p_limit int default 8)
returns table(kind text, content text, category text, created_at timestamptz, source text, similarity float)
language sql stable as $$
  select kind, content, category, created_at, source, 1 - (embedding <=> p_embedding) as similarity
  from mello_memory
  where user_id = p_user and embedding is not null and retired_at is null
  order by embedding <=> p_embedding
  limit greatest(1, least(p_limit, 25))
$$;
grant execute on function match_mello_memory(uuid, vector, int) to authenticated, service_role;
