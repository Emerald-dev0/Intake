-- Phase: admin-composed mail ("write a note, choose who gets it, send it one by one").
--
-- Additive and non-destructive. One table, and it deliberately does not contain the message body:
-- the copy that went out already sits in each recipient's mailbox, and an archive of personal
-- correspondence inside the admin database would be a liability rather than a feature.
--
-- Per-recipient traceability is not duplicated here either. Each delivery is an ordinary row in
-- `email_delivery` with email_type = 'admin_message', so it appears on the Email page, carries its
-- own idempotency key (`intake:admin-message:<send id>:<user id>`) and can be reconciled against
-- provider webhooks like every other email Intake sends.

CREATE TABLE IF NOT EXISTS admin_mail_send (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  admin_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  selection_kind text NOT NULL CHECK (selection_kind IN ('segment', 'ids')),
  selection_label text NOT NULL CHECK (char_length(selection_label) BETWEEN 1 AND 120),
  recipients integer NOT NULL CHECK (recipients >= 0 AND recipients <= 1000),
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0 AND sent <= 1000),
  skipped integer NOT NULL DEFAULT 0 CHECK (skipped >= 0 AND skipped <= 1000),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0 AND failed <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_mail_send_created_idx ON admin_mail_send (created_at DESC);
