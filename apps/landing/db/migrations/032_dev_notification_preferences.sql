-- Phase: notification preferences for the developer workspace.
--
-- One row per project, per account. The default is off: nobody is told anything about their
-- answers until they ask to be told. There is no per-submission email, ever — a respondent is
-- never written to from this table.
--
-- Two ways to be told: a threshold (every N new answers) or a digest (at most once a day). Both
-- are opt-in and both are explicit.
--
-- The counter is on the row, so the "since the last notice" count survives a restart and cannot
-- be double-counted by two workers.
--
-- Rollback: DROP TABLE dev_notification_preference; — the preferences go, and no email history
-- changes, because the delivery log lives in the email tables.

CREATE TABLE IF NOT EXISTS dev_notification_preference (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES dev_project(id) ON DELETE CASCADE,
  -- 'off' by default. Nobody is told anything until they choose to be.
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'threshold', 'digest')),
  -- How many new answers before a note, when the mode is 'threshold'.
  threshold integer NOT NULL DEFAULT 10 CHECK (threshold >= 1 AND threshold <= 1000),
  -- How many answers have arrived since the last notice. This is the counter the threshold is
  -- measured against, and it is what makes a repeated trigger one notice rather than two.
  pending integer NOT NULL DEFAULT 0 CHECK (pending >= 0),
  -- When the last notice went out, so a digest can be at most one a day.
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS dev_notification_preference_project_idx
  ON dev_notification_preference (project_id);
