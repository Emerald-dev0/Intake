-- Extensions for Intake Form Library and lifecycle management.
-- Preserves the provider as the authoritative source for form content and responses.
-- Run after 004. Apply with `npm run db:migrate:intake`.

ALTER TABLE form ADD COLUMN IF NOT EXISTS description text CHECK (description IS NULL OR char_length(description) <= 3000);
ALTER TABLE form ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'created' CHECK (source IN ('created', 'imported'));
ALTER TABLE form ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE form ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE form ALTER COLUMN specification DROP NOT NULL;

CREATE INDEX IF NOT EXISTS form_user_library_idx
  ON form (user_id, archived_at, created_at DESC);
