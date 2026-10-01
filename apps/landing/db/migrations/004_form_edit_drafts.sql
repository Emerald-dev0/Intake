-- Server-owned review/confirmation state for edits to an existing Google Form.
-- The snapshot is normalized form structure and provider IDs only; no raw API payloads, responses, tokens, or chat transcript.
-- Status 'applying' is an atomic one-shot claim. A crash cannot trigger a blind replay of non-idempotent createItem requests.
CREATE TABLE IF NOT EXISTS form_edit_draft (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'google'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'applying', 'applied', 'blocked', 'stale')),
  provider_form_id text NOT NULL CHECK (char_length(provider_form_id) BETWEEN 8 AND 256),
  form_record_id text REFERENCES form(id) ON DELETE SET NULL,
  external_account_id text NOT NULL CHECK (char_length(external_account_id) BETWEEN 1 AND 255),
  current_form jsonb NOT NULL CHECK (jsonb_typeof(current_form) = 'object'),
  edit_plan jsonb NOT NULL CHECK (jsonb_typeof(edit_plan) = 'object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('applied', 'blocked', 'stale') AND result IS NOT NULL) OR status IN ('ready', 'applying')),
  CHECK (current_form->>'providerFormId' = provider_form_id),
  CHECK (edit_plan->>'formId' = provider_form_id)
);
CREATE INDEX IF NOT EXISTS form_edit_draft_user_created_idx ON form_edit_draft (user_id, created_at DESC);
