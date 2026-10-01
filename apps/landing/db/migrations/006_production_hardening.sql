-- Phase 9 production hardening. Additive and non-destructive.
-- Rate-limit subjects are keyed SHA-256 HMACs; no raw user id, IP address, request body, or credential is stored.
CREATE TABLE IF NOT EXISTS api_rate_limit (
  scope text NOT NULL CHECK (char_length(scope) BETWEEN 2 AND 80),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, subject_hash, window_start),
  CHECK (expires_at > window_start)
);

CREATE INDEX IF NOT EXISTS api_rate_limit_expiry_idx ON api_rate_limit (expires_at);

-- The form id is already globally unique. This redundant composite constraint permits a database-level
-- ownership foreign key from edit drafts, preventing a future bug from associating one user's draft
-- with another user's form record.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'form_user_id_id_unique' AND conrelid = 'form'::regclass
  ) THEN
    ALTER TABLE form ADD CONSTRAINT form_user_id_id_unique UNIQUE (user_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'form_edit_draft_owned_form_fk' AND conrelid = 'form_edit_draft'::regclass
  ) THEN
    -- Validation intentionally fails deployment if historical rows violate ownership. Operators can
    -- inspect those rows without this migration deleting or rewriting any application data.
    ALTER TABLE form_edit_draft
      ADD CONSTRAINT form_edit_draft_owned_form_fk
      FOREIGN KEY (user_id, form_record_id)
      REFERENCES form (user_id, id)
      ON DELETE SET NULL (form_record_id);
  END IF;
END $$;
