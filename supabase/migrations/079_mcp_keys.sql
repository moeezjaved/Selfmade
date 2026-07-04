-- MCP access keys — bearer tokens that let external AI clients (Claude, Cursor, ChatGPT) query the
-- Selfmade ad library via the read-only MCP server at /api/mcp.
create table if not exists mcp_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  label text,
  token text unique not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false
);
create index if not exists mcp_keys_token_idx on mcp_keys (token) where not revoked;
