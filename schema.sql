-- ==============================================================================
-- TELEFLOW AGENT // SUPABASE POSTGRESQL SCHEMA
-- Target: Supabase / PostgreSQL (Self-Hosted or Cloud)
-- ==============================================================================

-- 1. Conversation State Machine Sessions Table
CREATE TABLE IF NOT EXISTS telegram_sessions (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  phase TEXT NOT NULL DEFAULT 'INITIAL' CHECK (phase IN ('INITIAL', 'DISCOVERY', 'QUALIFICATION', 'CONFIRMED')),
  messages_count INTEGER NOT NULL DEFAULT 0,
  lead_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for session activity and LRU cleanups
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_last_active ON telegram_sessions(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_phase ON telegram_sessions(phase);

-- Enable Row Level Security
ALTER TABLE telegram_sessions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access to telegram_sessions"
  ON telegram_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Qualified Leads Table (if not already existing from portfolio)
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  email TEXT,
  contact_method TEXT NOT NULL,
  service_requested TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'DISCUSSING', 'PROPOSAL', 'WON', 'LOST', 'ARCHIVED')),
  is_important BOOLEAN NOT NULL DEFAULT false,
  private_notes TEXT,
  source TEXT DEFAULT 'telegram_agent',
  user_agent TEXT DEFAULT 'telegram_agent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Constraints
ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS chk_inquiries_name_len;
ALTER TABLE inquiries ADD CONSTRAINT chk_inquiries_name_len CHECK (length(trim(name)) >= 1 AND length(name) <= 150);

ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS chk_inquiries_message_len;
ALTER TABLE inquiries ADD CONSTRAINT chk_inquiries_message_len CHECK (length(trim(message)) >= 3 AND length(message) <= 5000);

ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS chk_inquiries_email_format;
ALTER TABLE inquiries ADD CONSTRAINT chk_inquiries_email_format CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS chk_inquiries_service_len;
ALTER TABLE inquiries ADD CONSTRAINT chk_inquiries_service_len CHECK (length(service_requested) <= 150);

CREATE INDEX IF NOT EXISTS idx_inquiries_status_created ON inquiries(status, created_at DESC);

-- Enable RLS
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to inquiries"
  ON inquiries
  FOR ALL
  USING (true)
  WITH CHECK (true);
