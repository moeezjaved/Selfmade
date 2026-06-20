-- Mello — embedded AI ad agent (Raya-style).
--
-- A tool-calling chat agent that pulls a user's live Meta ad performance and our own
-- discovery ad-intelligence DB, persists conversations, and runs scheduled automations.
-- There is no workspace concept in Selfmade, so everything is scoped to user_id
-- (the spec's workspace_id collapses to user_id). RLS mirrors the rest of the schema
-- (auth.uid() = user_id); API routes use the service-role admin client and filter by
-- user_id in code, so RLS is belt-and-suspenders.

-- ── Conversations ────────────────────────────────────────────
create table if not exists agent_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,                              -- auto-generated from first message
  channel     text not null default 'web',       -- 'web' | 'automation'
  status      text not null default 'active',    -- 'active' | 'completed' | 'error'
  automation_id uuid,                             -- set when created by an automation run
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_agent_conversations_user on agent_conversations(user_id, updated_at desc);

-- ── Messages ─────────────────────────────────────────────────
create table if not exists agent_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references agent_conversations(id) on delete cascade,
  role             text not null,                -- 'user' | 'assistant'
  content          text,                         -- final text content
  tool_calls       jsonb,                        -- [{tool,label,status,sub_item}] for display
  thinking_steps   jsonb,                        -- [{duration_ms}]
  interactive_widget jsonb,                      -- {widget_id,widget_type,question,options,allow_skip}
  is_helpful       boolean,                      -- thumbs up/down feedback
  created_at       timestamptz default now()
);
create index if not exists idx_agent_messages_conv on agent_messages(conversation_id, created_at);

-- ── Automations (scheduled recurring agent tasks) ────────────
create table if not exists agent_automations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  prompt          text not null,
  schedule_cron   text not null,                 -- standard 5-field cron, e.g. '0 9 * * 1'
  schedule_label  text,                          -- human label, e.g. 'Weekly, Mondays 9am'
  delivery_channel text default 'in_app',        -- 'in_app' (Slack/email deferred)
  is_active       boolean default true,
  last_run_at     timestamptz,
  next_run_at     timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_agent_automations_due on agent_automations(next_run_at) where is_active;
create index if not exists idx_agent_automations_user on agent_automations(user_id, created_at desc);

-- ── Automation run history ───────────────────────────────────
create table if not exists automation_runs (
  id              uuid primary key default gen_random_uuid(),
  automation_id   uuid not null references agent_automations(id) on delete cascade,
  conversation_id uuid references agent_conversations(id) on delete set null,
  status          text,                          -- 'success' | 'error'
  started_at      timestamptz default now(),
  completed_at    timestamptz,
  error_message   text
);
create index if not exists idx_automation_runs_automation on automation_runs(automation_id, started_at desc);

-- ── updated_at triggers (reuse the shared function from migration 001) ──
drop trigger if exists update_agent_conversations_updated_at on agent_conversations;
create trigger update_agent_conversations_updated_at before update on agent_conversations
  for each row execute function update_updated_at_column();
drop trigger if exists update_agent_automations_updated_at on agent_automations;
create trigger update_agent_automations_updated_at before update on agent_automations
  for each row execute function update_updated_at_column();

-- ── RLS ──────────────────────────────────────────────────────
alter table agent_conversations enable row level security;
alter table agent_messages      enable row level security;
alter table agent_automations   enable row level security;
alter table automation_runs     enable row level security;

drop policy if exists own_conversations on agent_conversations;
create policy own_conversations on agent_conversations for all using (auth.uid() = user_id);

drop policy if exists own_messages on agent_messages;
create policy own_messages on agent_messages for all using (
  exists (select 1 from agent_conversations c where c.id = agent_messages.conversation_id and c.user_id = auth.uid())
);

drop policy if exists own_automations on agent_automations;
create policy own_automations on agent_automations for all using (auth.uid() = user_id);

drop policy if exists own_automation_runs on automation_runs;
create policy own_automation_runs on automation_runs for all using (
  exists (select 1 from agent_automations a where a.id = automation_runs.automation_id and a.user_id = auth.uid())
);
