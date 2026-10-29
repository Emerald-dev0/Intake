-- Phase: submissions to a hosted developer form.
--
-- A submission records the answers, the version of the form they were accepted under, when they
-- arrived, and where they came from. It does not record an IP address: the source metadata kept is
-- the referrer and the user agent, truncated, because those answer "how did people find this form"
-- without keeping a list of who visited.
--
-- The form version is not optional and does not change: an answer is always checked against, and
-- read beside, the definition that was live when it was accepted. If the form is edited tomorrow,
-- yesterday's answers still make sense.
--
-- Idempotency: a client may send a key with a submission. The same key on the same form is the
-- same submission, so a retry — a double tap, a dropped connection, a queue redelivering — never
-- creates a second row.
--
-- Rollback: DROP TABLE dev_submission; — no other table depends on it.

CREATE TABLE IF NOT EXISTS dev_submission (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  form_id text NOT NULL REFERENCES dev_form(id) ON DELETE CASCADE,
  -- The published version the answers were validated against.
  form_version_id text NOT NULL REFERENCES dev_form_version(id),
  project_id text NOT NULL REFERENCES dev_project(id) ON DELETE CASCADE,
  -- { fieldId: value }, where the value is a string, a number, a boolean or a list of strings.
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { referrer, userAgent } — truncated, and deliberately no address.
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 200),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_submission_form_idx
  ON dev_submission (form_id, submitted_at DESC);

-- One key, one submission, on one form.
CREATE UNIQUE INDEX IF NOT EXISTS dev_submission_idempotency_idx
  ON dev_submission (form_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- The project is carried on the row so an owner can read a project's responses without joining
-- through the form, and so the ownership check is a single predicate.
CREATE INDEX IF NOT EXISTS dev_submission_project_idx
  ON dev_submission (project_id, submitted_at DESC);
