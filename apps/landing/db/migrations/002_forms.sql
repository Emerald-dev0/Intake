-- Forms Intake created in a connected provider account.
-- The provider stays the source of truth for the form and for every response to it. This table
-- records which Intake user owns the form, which external account it lives in, and the specification
-- that produced it. It never stores respondent data or provider credentials.
-- Run after 001 so the quoted "user" table exists. Apply with `npm run db:migrate:intake`.

CREATE TABLE IF NOT EXISTS form (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  -- The provider account the form was created in (Google `sub`). Completes the ownership chain:
  -- Intake user -> provider connection -> external account -> form.
  external_account_id text NOT NULL CHECK (char_length(external_account_id) BETWEEN 1 AND 255),
  provider_form_id text NOT NULL CHECK (char_length(provider_form_id) BETWEEN 1 AND 255),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  -- created: built and published. incomplete: exists in the provider account but creation stopped
  -- part way; it is unpublished and failure_stage says where it stopped.
  status text NOT NULL CHECK (status IN ('created', 'incomplete')),
  edit_url text CHECK (edit_url IS NULL OR char_length(edit_url) <= 2048),
  responder_url text CHECK (responder_url IS NULL OR char_length(responder_url) <= 2048),
  failure_stage text CHECK (failure_stage IS NULL OR failure_stage IN ('add_questions', 'configure_logic', 'publish')),
  -- Trace id shown to the user and written on every log line for the attempt.
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 80),
  specification jsonb NOT NULL,
  specification_version integer NOT NULL DEFAULT 1 CHECK (specification_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_form_id),
  CHECK ((status = 'created' AND failure_stage IS NULL) OR (status = 'incomplete' AND failure_stage IS NOT NULL AND responder_url IS NULL))
);

CREATE INDEX IF NOT EXISTS form_user_created_idx
  ON form (user_id, created_at DESC);
