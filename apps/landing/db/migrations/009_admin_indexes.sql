-- Phase 12/13 — indexes for the read-only admin projections over the current Phase 11 schema.
-- AI usage and credit accounting share ai_operation from 007_ai_credits.sql; this migration adds
-- only query indexes and never creates a competing ai_operation schema.

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

CREATE INDEX IF NOT EXISTS ai_operation_created_at_idx
  ON ai_operation (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_operation_created_idx
  ON ai_operation (operation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_outcome_created_idx
  ON ai_operation (outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_model_created_idx
  ON ai_operation (model, created_at DESC);
