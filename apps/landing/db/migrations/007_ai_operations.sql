-- Phase 12 operational visibility for Groq interpreter operations. This table deliberately stores
-- request metadata only: no prompts, form content, provider payloads, credentials, or raw errors.
-- Token fields are nullable because failed calls and older provider responses may omit usage.
CREATE TABLE IF NOT EXISTS ai_operation (
  id text PRIMARY KEY,
  request_id text NOT NULL UNIQUE CHECK (char_length(request_id) BETWEEN 1 AND 80),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  route text NOT NULL CHECK (route IN (
    '/api/forms/interpret', '/api/forms/revise',
    '/api/forms/edit/interpret', '/api/forms/edit/revise'
  )),
  operation text NOT NULL CHECK (operation IN ('form_interpretation', 'form_edit_interpretation')),
  provider text NOT NULL CHECK (provider = 'groq'),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  failure_code text CHECK (failure_code IS NULL OR failure_code IN (
    'model_not_configured', 'model_timeout', 'model_unavailable', 'model_invalid_output'
  )),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  CHECK (completed_at >= started_at),
  CHECK ((status = 'succeeded' AND failure_code IS NULL) OR (status = 'failed' AND failure_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ai_operation_started_idx
  ON ai_operation (started_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_user_started_idx
  ON ai_operation (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_operation_started_idx
  ON ai_operation (operation, started_at DESC);

-- These indexes support the actual admin query paths: date-bounded totals/activity, per-user
-- session/form lookups after pagination, and prefix searches. They avoid adding indexes to
-- credential-bearing or rarely-filtered columns.
CREATE INDEX IF NOT EXISTS user_created_at_idx
  ON "user" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS user_email_prefix_idx
  ON "user" (lower(email) text_pattern_ops);
CREATE INDEX IF NOT EXISTS user_name_prefix_idx
  ON "user" (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS session_updated_at_idx
  ON "session" ("updatedAt" DESC);
CREATE INDEX IF NOT EXISTS session_user_updated_idx
  ON "session" ("userId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS form_created_at_idx
  ON form (created_at DESC);
CREATE INDEX IF NOT EXISTS form_updated_at_idx
  ON form (updated_at DESC);
CREATE INDEX IF NOT EXISTS provider_connection_status_idx
  ON provider_connection (provider, status);
CREATE INDEX IF NOT EXISTS provider_connection_authorized_idx
  ON provider_connection (last_authorized_at DESC);
CREATE INDEX IF NOT EXISTS provider_connection_status_updated_idx
  ON provider_connection (status, updated_at DESC);
