-- Server-owned proposed specifications. No conversation transcript, OAuth grant, or respondent data.
-- A single compare-and-swap claim on (user_id, id, version, status) prevents a confirmed
-- draft from being created twice even across API processes or after an ambiguous timeout.
-- A draft stuck at 'creating' after a crash is deliberately NOT released automatically.
CREATE TABLE IF NOT EXISTS form_draft (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'google'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'creating', 'created', 'blocked')),
  specification jsonb NOT NULL CHECK (jsonb_typeof(specification) = 'object'),
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assumptions) = 'array'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  -- Only the public creation result, or the public failure when an attempt has finished.
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('created', 'blocked') AND result IS NOT NULL) OR status IN ('ready', 'creating'))
);
CREATE INDEX IF NOT EXISTS form_draft_user_created_idx ON form_draft (user_id, created_at DESC);
