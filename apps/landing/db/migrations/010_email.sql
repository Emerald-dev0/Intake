-- Phase 17 — transactional email infrastructure.
--
-- Additive and non-destructive. Four tables, each with an operational job:
--
--   email_delivery       the traceability chain (Intake event → provider id → webhook outcome)
--   email_suppression    addresses Calder identified as permanently invalid or complaining
--   email_webhook_event  replay protection for delivery webhooks
--   user_sign_in_marker  coarse "new sign-in" detection for security notices
--
-- Deliberately NOT here: OTP codes (only a keyed HMAC with a per-challenge salt is stored, in
-- Better Auth's `verification` table) and password-reset tokens (owned by Better Auth, single-use
-- and consumed on success). Raw codes, tokens and API keys are never persisted anywhere.

CREATE TABLE IF NOT EXISTS email_delivery (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  email_type text NOT NULL CHECK (char_length(email_type) BETWEEN 2 AND 64),
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  recipient text NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 320),
  subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 500),
  status text NOT NULL CHECK (status IN (
    'pending', 'accepted', 'skipped', 'failed',
    'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed_remote'
  )),
  provider text CHECK (provider IS NULL OR char_length(provider) BETWEEN 2 AND 40),
  provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 120),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 4 AND 255),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 100),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 64),
  latency_ms integer CHECK (latency_ms IS NULL OR (latency_ms >= 0 AND latency_ms <= 600000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_delivery_created_idx ON email_delivery (created_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_type_created_idx ON email_delivery (email_type, created_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_user_idx ON email_delivery (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_provider_message_idx ON email_delivery (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_suppression (
  email text PRIMARY KEY CHECK (char_length(email) BETWEEN 3 AND 320),
  reason text NOT NULL CHECK (reason IN ('bounce', 'complaint', 'manual')),
  source text NOT NULL DEFAULT 'calder' CHECK (char_length(source) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_suppression_created_idx ON email_suppression (created_at DESC);

CREATE TABLE IF NOT EXISTS email_webhook_event (
  event_id text PRIMARY KEY CHECK (char_length(event_id) BETWEEN 4 AND 120),
  event_type text NOT NULL CHECK (char_length(event_type) <= 64),
  provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 120),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_webhook_event_received_idx ON email_webhook_event (received_at DESC);

-- Network subjects are keyed HMACs, never raw addresses: this table cannot leak an IP even if read.
CREATE TABLE IF NOT EXISTS user_sign_in_marker (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  network_hash text NOT NULL CHECK (network_hash ~ '^[0-9a-f]{64}$'),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
