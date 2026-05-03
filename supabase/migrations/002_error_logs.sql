-- Error logs table for tracking user-facing errors
CREATE TABLE IF NOT EXISTS error_logs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email       TEXT,
  error_message    TEXT NOT NULL,
  error_stack      TEXT,
  page_url         TEXT,
  component_stack  TEXT,
  extra            JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Users can insert their own errors; nobody can read (admin uses service role)
CREATE POLICY "Users can log their own errors" ON error_logs
  FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
